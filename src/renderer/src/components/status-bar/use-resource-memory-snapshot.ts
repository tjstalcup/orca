import { useCallback, useEffect, useRef } from 'react'
import type { MemorySnapshot } from '../../../../shared/process-stats-types'
import { isResourceViewInactive } from '../../../../shared/resource-view-admission'
import { useAppStore } from '../../store'
import { getCommitPressureToneClass } from './resource-memory-metric-copy'
import { formatMemory } from './resource-usage-metrics'

export const ACTIVE_POLL_MS = 2_000
export const BACKGROUND_POLL_MS = 10_000

export type UseResourceMemorySnapshotOptions = {
  active: boolean
  windowVisible?: boolean
}

export function hasResourceBadgeSummaryChanged(
  prev: MemorySnapshot | null,
  next: MemorySnapshot | null
): boolean {
  if (!prev && !next) {
    return false
  }
  if (!prev || !next) {
    return true
  }
  if (formatMemory(prev.totalMemory) !== formatMemory(next.totalMemory)) {
    return true
  }
  const prevCommitTone = getCommitPressureToneClass({
    privateMemory: prev.totalPrivateMemory,
    hostTotalMemory: prev.host?.totalMemory ?? 0
  })
  const nextCommitTone = getCommitPressureToneClass({
    privateMemory: next.totalPrivateMemory,
    hostTotalMemory: next.host?.totalMemory ?? 0
  })
  if (prevCommitTone !== nextCommitTone) {
    return true
  }
  const prevCommitLabel =
    prev.processCommitMetric && prev.totalPrivateMemory !== undefined
      ? formatMemory(prev.totalPrivateMemory)
      : null
  const nextCommitLabel =
    next.processCommitMetric && next.totalPrivateMemory !== undefined
      ? formatMemory(next.totalPrivateMemory)
      : null
  if (prevCommitLabel !== nextCommitLabel) {
    return true
  }
  if (prev.processMemoryMetric !== next.processMemoryMetric) {
    return true
  }
  if (prev.processCommitMetric !== next.processCommitMetric) {
    return true
  }
  return false
}

export function useResourceMemorySnapshot(
  activeOrOptions: boolean | UseResourceMemorySnapshotOptions,
  maybeWindowVisible?: boolean
): () => Promise<void> {
  const active = typeof activeOrOptions === 'object' ? activeOrOptions.active : activeOrOptions
  const windowVisible =
    typeof activeOrOptions === 'object'
      ? (activeOrOptions.windowVisible ?? activeOrOptions.active)
      : (maybeWindowVisible ?? activeOrOptions)

  const lifetime = useRef<{
    active: boolean
    windowVisible: boolean
    epoch: number
    inFlight: { epoch: number; promise: Promise<void> } | null
    latestSnapshot: MemorySnapshot | null
    lastPublishedSnapshot: MemorySnapshot | null
    lastError: string | null
  }>({
    active: false,
    windowVisible: false,
    epoch: 0,
    inFlight: null,
    latestSnapshot: null,
    lastPublishedSnapshot: null,
    lastError: null
  })

  const prevVisibleRef = useRef(false)
  const prevActiveRef = useRef(false)

  const refresh = useCallback(async (): Promise<void> => {
    const current = lifetime.current
    if (!current.windowVisible && !current.active) {
      return
    }
    const epoch = current.epoch
    if (current.inFlight) {
      const dispatched = current.inFlight
      await dispatched.promise
      if (
        (!current.windowVisible && !current.active) ||
        current.epoch !== epoch ||
        dispatched.epoch === epoch ||
        current.inFlight?.epoch === epoch
      ) {
        return
      }
    }
    const request = window.api.memory
      .getSnapshot({ resourceManagerView: true })
      .then((snapshot) => {
        if ((current.windowVisible || current.active) && current.epoch === epoch) {
          current.latestSnapshot = snapshot
          const store = typeof useAppStore.getState === 'function' ? useAppStore.getState() : null
          const prevSnapshot = current.lastPublishedSnapshot ?? store?.memorySnapshot ?? null
          const hadError =
            current.lastError !== null || (store?.memorySnapshotError ?? null) !== null
          if (
            current.active ||
            hadError ||
            hasResourceBadgeSummaryChanged(prevSnapshot, snapshot)
          ) {
            current.lastPublishedSnapshot = snapshot
            current.lastError = null
            useAppStore.setState({ memorySnapshot: snapshot, memorySnapshotError: null })
          }
        }
      })
      .catch((error: unknown) => {
        if (
          (current.windowVisible || current.active) &&
          current.epoch === epoch &&
          !isResourceViewInactive(error)
        ) {
          const errorString = String(error)
          current.lastError = errorString
          useAppStore.setState({ memorySnapshotError: errorString })
        }
      })
    current.inFlight = { epoch, promise: request }
    await request
    if (current.inFlight?.promise === request) {
      current.inFlight = null
    }
  }, [])

  useEffect(() => {
    const current = lifetime.current
    current.active = active
    current.windowVisible = windowVisible
    current.epoch++

    const isVisible = windowVisible || active
    if (!isVisible) {
      prevVisibleRef.current = false
      prevActiveRef.current = active
      return
    }

    const becameVisible = !prevVisibleRef.current && isVisible
    const becameActive = !prevActiveRef.current && active
    prevVisibleRef.current = isVisible
    prevActiveRef.current = active

    if (becameActive && current.latestSnapshot) {
      if (current.lastPublishedSnapshot !== current.latestSnapshot) {
        current.lastPublishedSnapshot = current.latestSnapshot
        current.lastError = null
        useAppStore.setState({ memorySnapshot: current.latestSnapshot, memorySnapshotError: null })
      }
    }

    if (becameVisible || becameActive) {
      void refresh()
    }

    const intervalMs = active ? ACTIVE_POLL_MS : BACKGROUND_POLL_MS
    const timer = window.setInterval(() => {
      void refresh()
    }, intervalMs)

    return () => {
      current.epoch++
      window.clearInterval(timer)
    }
  }, [active, windowVisible, refresh])

  useEffect(() => {
    return () => {
      const current = lifetime.current
      current.active = false
      current.windowVisible = false
    }
  }, [])

  return refresh
}
