// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DictationState } from '../../../../shared/speech-types'
import { DICTATION_CONTROL_EVENT, type DictationControlAction } from './dictation-control-events'

type MockStoreState = {
  dictationState: DictationState
  partialTranscript: string
  rescuedTranscript: string | null
  dismissDictationRescue: ReturnType<typeof vi.fn>
  dictationMeter: {
    level: number
    isSpeaking: boolean
    isClipping: boolean
  }
  settings: {
    voice?: {
      dictationMode?: 'toggle' | 'hold'
      dictationAutoCopyToClipboard?: boolean
      dictationRescueAutoHideDelayMs?: number
    }
  } | null
}

const storeState: MockStoreState = {
  dictationState: 'listening',
  partialTranscript: '',
  rescuedTranscript: null,
  dismissDictationRescue: vi.fn(),
  dictationMeter: {
    level: 0,
    isSpeaking: false,
    isClipping: false
  },
  settings: {
    voice: {
      dictationMode: 'toggle',
      dictationAutoCopyToClipboard: false,
      dictationRescueAutoHideDelayMs: 0
    }
  }
}

vi.mock('@/store', () => {
  const useAppStore = (selector: (value: typeof storeState) => unknown) => selector(storeState)
  return { useAppStore }
})

vi.mock('./dictation-meter-store', () => ({
  useDictationMeter: () => storeState.dictationMeter
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, string>) => {
    if (!options) {
      return fallback
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (_, k: string) => options[k] ?? '')
  }
}))

// Portal tooltip content like the real primitive so chip-absence assertions cannot pass through mock containment.
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) =>
    createPortal(<div data-testid="tooltip-content">{children}</div>, document.body)
}))

import { DictationIndicator } from './DictationIndicator'

function setUserAgent(userAgent: string): void {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: userAgent })
}

const originalUserAgent = navigator.userAgent

beforeEach(() => {
  storeState.dictationState = 'listening'
  storeState.partialTranscript = ''
  storeState.rescuedTranscript = null
  storeState.dismissDictationRescue.mockReset()
  storeState.dictationMeter = {
    level: 0,
    isSpeaking: false,
    isClipping: false
  }
  storeState.settings = { voice: { dictationMode: 'toggle' } }
  setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
})

afterEach(() => {
  cleanup()
  setUserAgent(originalUserAgent)
})

describe('DictationIndicator', () => {
  it('stops dictation when the stop button is clicked', () => {
    const actions: DictationControlAction[] = []
    const listener = (event: Event): void => {
      actions.push((event as CustomEvent<DictationControlAction>).detail)
    }
    document.addEventListener(DICTATION_CONTROL_EVENT, listener)

    render(<DictationIndicator />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop dictation' }))

    document.removeEventListener(DICTATION_CONTROL_EVENT, listener)
    expect(actions).toEqual(['stop'])
  })

  it('renders Ready-to-Copy state with preview, Copy button, and Close button (#26712)', () => {
    storeState.dictationState = 'ready-to-copy'
    storeState.rescuedTranscript = 'The quick brown fox jumps over the lazy dog'

    render(<DictationIndicator />)

    expect(screen.getByTestId('dictation-indicator')).toBeTruthy()
    expect(screen.getByText('Ready to Copy:')).toBeTruthy()
    expect(screen.getByText('“The quick brown fox jumps over…”')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy transcript' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop dictation' })).toBeNull()
  })

  it('clicking Copy button copies the full transcript to clipboard (#26712)', async () => {
    storeState.dictationState = 'ready-to-copy'
    storeState.rescuedTranscript = 'The quick brown fox jumps over the lazy dog'

    const writeClipboardText = vi.fn().mockResolvedValue(undefined)
    Object.assign(window, {
      api: {
        ui: { writeClipboardText }
      }
    })

    render(<DictationIndicator />)
    const copyButton = screen.getByRole('button', { name: 'Copy transcript' })
    fireEvent.click(copyButton)

    expect(writeClipboardText).toHaveBeenCalledWith('The quick brown fox jumps over the lazy dog')
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()
  })

  it('clicking Close button dismisses the rescued transcript pill (#26712)', () => {
    storeState.dictationState = 'ready-to-copy'
    storeState.rescuedTranscript = 'Uninserted text'

    render(<DictationIndicator />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(storeState.dismissDictationRescue).toHaveBeenCalled()
  })

  it('auto-dismisses after configured delay when dictationRescueAutoHideDelayMs is set (#26712)', () => {
    vi.useFakeTimers()
    storeState.dictationState = 'ready-to-copy'
    storeState.rescuedTranscript = 'Auto dismiss test'
    storeState.settings = {
      voice: {
        dictationMode: 'toggle',
        dictationRescueAutoHideDelayMs: 5000
      }
    }

    render(<DictationIndicator />)
    expect(storeState.dismissDictationRescue).not.toHaveBeenCalled()

    vi.advanceTimersByTime(5000)
    expect(storeState.dismissDictationRescue).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
