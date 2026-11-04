// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemorySnapshot } from '../../../../shared/process-stats-types'
import { useAppStore } from '../../store'
import { createEmptyMemorySnapshot } from '../../web/preload-api/web-memory-api'
import {
  ACTIVE_POLL_MS,
  BACKGROUND_POLL_MS,
  hasResourceBadgeSummaryChanged,
  useResourceMemorySnapshot
} from './use-resource-memory-snapshot'

vi.mock('../../store', () => ({ useAppStore: { setState: vi.fn() } }))

const snapshot = (collectedAt: number, overrides?: Partial<MemorySnapshot>): MemorySnapshot => ({
  ...createEmptyMemorySnapshot(),
  collectedAt,
  ...overrides
})
const getSnapshot = vi.fn<() => Promise<MemorySnapshot>>()
const flush = () => act(async () => {})
const setup = (active = true, windowVisible?: boolean) =>
  renderHook(({ active, windowVisible }) => useResourceMemorySnapshot(active, windowVisible), {
    initialProps: { active, windowVisible }
  })

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(useAppStore.setState).mockClear()
  getSnapshot.mockReset().mockResolvedValue(snapshot(1))
  vi.stubGlobal('api', { memory: { getSnapshot } })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Resource Manager memory observation', () => {
  it('coalesces concurrent refreshes and only polls while active', async () => {
    const pending = Promise.withResolvers<MemorySnapshot>()
    getSnapshot.mockReturnValueOnce(pending.promise)
    const { result, rerender } = setup(false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(getSnapshot).not.toHaveBeenCalled()
    rerender({ active: true, windowVisible: true })
    act(() => {
      void result.current()
      void result.current()
    })
    expect(getSnapshot).toHaveBeenCalledExactlyOnceWith({ resourceManagerView: true })
    await act(async () => {
      pending.resolve(snapshot(10))
    })
    expect(useAppStore.setState).toHaveBeenCalledExactlyOnceWith({
      memorySnapshot: snapshot(10),
      memorySnapshotError: null
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(getSnapshot).toHaveBeenCalledTimes(2)
    rerender({ active: false, windowVisible: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(getSnapshot).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('discards hidden results and reconciles one new epoch without overlapping requests', async () => {
    const old = Promise.withResolvers<MemorySnapshot>()
    const current = Promise.withResolvers<MemorySnapshot>()
    getSnapshot.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const { result, rerender } = setup()
    rerender({ active: false, windowVisible: false })
    rerender({ active: true, windowVisible: true })
    act(() => {
      void result.current()
      void result.current()
    })
    expect(getSnapshot).toHaveBeenCalledOnce()
    await act(async () => {
      old.resolve(snapshot(10))
    })
    expect(useAppStore.setState).not.toHaveBeenCalled()
    expect(getSnapshot).toHaveBeenCalledTimes(2)
    await act(async () => {
      current.resolve(snapshot(20))
    })
    expect(useAppStore.setState).toHaveBeenCalledExactlyOnceWith({
      memorySnapshot: snapshot(20),
      memorySnapshotError: null
    })
  })

  it('does not let an old native visibility veto cancel a newly visible epoch', async () => {
    const old = Promise.withResolvers<MemorySnapshot>()
    getSnapshot.mockReturnValueOnce(old.promise)
    const { rerender } = setup()
    rerender({ active: false, windowVisible: false })
    rerender({ active: true, windowVisible: true })
    await act(async () => {
      old.reject(new Error('view_not_visible'))
    })
    expect(getSnapshot).toHaveBeenCalledTimes(2)
    expect(useAppStore.setState).toHaveBeenCalledExactlyOnceWith({
      memorySnapshot: snapshot(1),
      memorySnapshotError: null
    })
  })

  it('retains the last observation after a read failure and allows an explicit retry', async () => {
    const { result } = setup()
    await flush()
    getSnapshot.mockRejectedValueOnce(new Error('unavailable'))
    await act(async () => {
      await result.current()
    })
    expect(useAppStore.setState).toHaveBeenLastCalledWith({
      memorySnapshotError: 'Error: unavailable'
    })
    await act(async () => {
      await result.current()
    })
    expect(useAppStore.setState).toHaveBeenLastCalledWith({
      memorySnapshot: snapshot(1),
      memorySnapshotError: null
    })
  })

  it('permits refresh after a native veto without requiring a different visibility prop', async () => {
    getSnapshot.mockRejectedValueOnce(new Error('view_not_visible'))
    const { result } = setup()
    await flush()
    expect(useAppStore.setState).not.toHaveBeenCalled()
    await act(async () => {
      await result.current()
    })
    expect(getSnapshot).toHaveBeenCalledTimes(2)
    expect(useAppStore.setState).toHaveBeenCalledExactlyOnceWith({
      memorySnapshot: snapshot(1),
      memorySnapshotError: null
    })
  })

  it('polls on the background interval while popover is closed and window is visible', async () => {
    setup(false, true)
    await flush()
    expect(getSnapshot).toHaveBeenCalledExactlyOnceWith({ resourceManagerView: true })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BACKGROUND_POLL_MS - 1)
    })
    expect(getSnapshot).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(getSnapshot).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BACKGROUND_POLL_MS)
    })
    expect(getSnapshot).toHaveBeenCalledTimes(3)
  })

  it('uses fast 2s interval while popover is open', async () => {
    setup(true, true)
    await flush()
    expect(getSnapshot).toHaveBeenCalledExactlyOnceWith({ resourceManagerView: true })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_POLL_MS - 1)
    })
    expect(getSnapshot).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(getSnapshot).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_POLL_MS)
    })
    expect(getSnapshot).toHaveBeenCalledTimes(3)
  })

  it('triggers an immediate snapshot refresh when window regains visibility', async () => {
    const { rerender } = setup(false, false)
    await flush()
    expect(getSnapshot).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(getSnapshot).not.toHaveBeenCalled()

    // Window becomes visible
    rerender({ active: false, windowVisible: true })
    await flush()
    expect(getSnapshot).toHaveBeenCalledExactlyOnceWith({ resourceManagerView: true })
    expect(vi.getTimerCount()).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BACKGROUND_POLL_MS)
    })
    expect(getSnapshot).toHaveBeenCalledTimes(2)
  })

  it('pauses polling completely (0 background polls and 0 timers) when windowVisible is false', async () => {
    const { rerender } = setup(false, true)
    await flush()
    expect(getSnapshot).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BACKGROUND_POLL_MS)
    })
    expect(getSnapshot).toHaveBeenCalledTimes(2)

    // Window becomes hidden
    rerender({ active: false, windowVisible: false })
    expect(vi.getTimerCount()).toBe(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(getSnapshot).toHaveBeenCalledTimes(2)
  })

  it('avoids unnecessary state updates when badge summary values are unchanged while closed', async () => {
    const initial = snapshot(1, { totalMemory: 100_000_000 })
    getSnapshot.mockResolvedValueOnce(initial)

    setup(false, true)
    await flush()
    expect(useAppStore.setState).toHaveBeenCalledExactlyOnceWith({
      memorySnapshot: initial,
      memorySnapshotError: null
    })
    vi.mocked(useAppStore.setState).mockClear()

    // 100_000_000 bytes = 95.4 MB; 100_010_000 bytes is also 95.4 MB with unchanged commit tone/metric
    const unchangedSummary = snapshot(2, { totalMemory: 100_010_000 })
    getSnapshot.mockResolvedValueOnce(unchangedSummary)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BACKGROUND_POLL_MS)
    })
    expect(getSnapshot).toHaveBeenCalledTimes(2)
    // No state update should have been triggered
    expect(useAppStore.setState).not.toHaveBeenCalled()

    // Now memory changes enough to change the badge display (150 MB = 143.1 MB)
    const changedSummary = snapshot(3, { totalMemory: 150_000_000 })
    getSnapshot.mockResolvedValueOnce(changedSummary)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BACKGROUND_POLL_MS)
    })
    expect(getSnapshot).toHaveBeenCalledTimes(3)
    expect(useAppStore.setState).toHaveBeenCalledExactlyOnceWith({
      memorySnapshot: changedSummary,
      memorySnapshotError: null
    })
  })

  it('always updates state on every poll while popover is open even if summary is unchanged', async () => {
    const initial = snapshot(1, { totalMemory: 100_000_000 })
    getSnapshot.mockResolvedValueOnce(initial)

    setup(true, true)
    await flush()
    expect(useAppStore.setState).toHaveBeenCalledExactlyOnceWith({
      memorySnapshot: initial,
      memorySnapshotError: null
    })
    vi.mocked(useAppStore.setState).mockClear()

    // Same memory bytes, but popover is open so detailed view needs updates
    const unchangedSummary = snapshot(2, { totalMemory: 100_000_000 })
    getSnapshot.mockResolvedValueOnce(unchangedSummary)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_POLL_MS)
    })
    expect(getSnapshot).toHaveBeenCalledTimes(2)
    expect(useAppStore.setState).toHaveBeenCalledExactlyOnceWith({
      memorySnapshot: unchangedSummary,
      memorySnapshotError: null
    })
  })

  it('transitions between background and active polling cadences seamlessly', async () => {
    const { rerender } = setup(false, true)
    await flush()
    expect(getSnapshot).toHaveBeenCalledTimes(1)

    // Background interval is 10s: advancing 2s should NOT poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_POLL_MS)
    })
    expect(getSnapshot).toHaveBeenCalledTimes(1)

    // User opens the popover
    rerender({ active: true, windowVisible: true })
    await flush()
    // Opening triggers an immediate refresh
    expect(getSnapshot).toHaveBeenCalledTimes(2)

    // Now active: advancing 2s polls again
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_POLL_MS)
    })
    expect(getSnapshot).toHaveBeenCalledTimes(3)

    // User closes the popover
    rerender({ active: false, windowVisible: true })
    await flush()

    // Advancing 2s should NOT poll now that it is back to background interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_POLL_MS)
    })
    expect(getSnapshot).toHaveBeenCalledTimes(3)

    // Advancing the remainder of 10s polls on background interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BACKGROUND_POLL_MS - ACTIVE_POLL_MS)
    })
    expect(getSnapshot).toHaveBeenCalledTimes(4)
  })
})

describe('hasResourceBadgeSummaryChanged', () => {
  it('returns true when prev is null', () => {
    expect(hasResourceBadgeSummaryChanged(null, snapshot(1))).toBe(true)
  })

  it('returns false when both are null', () => {
    expect(hasResourceBadgeSummaryChanged(null, null)).toBe(false)
  })

  it('returns true when only one is null', () => {
    expect(hasResourceBadgeSummaryChanged(snapshot(1), null)).toBe(true)
  })

  it('returns false when summary values, metrics, and tones match', () => {
    const prev = snapshot(1, { totalMemory: 100_000_000 })
    const next = snapshot(2, { totalMemory: 100_010_000 })
    expect(hasResourceBadgeSummaryChanged(prev, next)).toBe(false)
  })

  it('returns true when totalMemory formatted string changes', () => {
    const prev = snapshot(1, { totalMemory: 100_000_000 })
    const next = snapshot(2, { totalMemory: 150_000_000 })
    expect(hasResourceBadgeSummaryChanged(prev, next)).toBe(true)
  })

  it('returns true when commit pressure tone changes', () => {
    const host = { ...snapshot(1).host, totalMemory: 1_000_000_000 }
    const prev = snapshot(1, { host, totalPrivateMemory: 100_000_000 })
    // High pressure tone threshold
    const next = snapshot(2, { host, totalPrivateMemory: 950_000_000 })
    expect(hasResourceBadgeSummaryChanged(prev, next)).toBe(true)
  })

  it('returns true when commit metric label changes', () => {
    const prev = snapshot(1, {
      processCommitMetric: 'private-bytes',
      totalPrivateMemory: 100_000_000
    })
    const next = snapshot(2, {
      processCommitMetric: 'private-bytes',
      totalPrivateMemory: 500_000_000
    })
    expect(hasResourceBadgeSummaryChanged(prev, next)).toBe(true)
  })

  it('returns true when processMemoryMetric changes', () => {
    const prev = snapshot(1, { processMemoryMetric: 'rss' })
    const next = snapshot(2, { processMemoryMetric: 'footprint' })
    expect(hasResourceBadgeSummaryChanged(prev, next)).toBe(true)
  })

  it('returns true when processCommitMetric changes', () => {
    const prev = snapshot(1, { processCommitMetric: undefined })
    const next = snapshot(2, { processCommitMetric: 'private-bytes' })
    expect(hasResourceBadgeSummaryChanged(prev, next)).toBe(true)
  })
})
