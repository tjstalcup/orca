import { useEffect, type MutableRefObject } from 'react'
import type { DictationState } from '../../../../shared/speech-types'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { DICTATION_CONTROL_EVENT, type DictationControlAction } from './dictation-control-events'

type DictationControlEventsOptions = {
  dictationStateRef: MutableRefObject<DictationState>
  settings: GlobalSettings | null
  startDictation: () => Promise<void> | void
  stopDictation: () => Promise<void> | void
}

export function useDictationControlEvents({
  dictationStateRef,
  settings,
  startDictation,
  stopDictation
}: DictationControlEventsOptions): void {
  // Toggle mode uses intercepted main IPC so the chord cannot reach xterm or system shortcuts.
  useEffect(() => {
    const mode = settings?.voice?.dictationMode ?? 'toggle'
    if (mode !== 'toggle') {
      return
    }

    const handleKeyDown = (): void => {
      if (!settings?.voice?.enabled || dictationStateRef.current === 'stopping') {
        return
      }
      if (dictationStateRef.current === 'listening' || dictationStateRef.current === 'starting') {
        void stopDictation()
      } else {
        void startDictation()
      }
    }

    const cleanup = window.api.ui.onDictationKeyDown(handleKeyDown)
    return cleanup
  }, [
    dictationStateRef,
    settings?.voice?.dictationMode,
    settings?.voice?.enabled,
    startDictation,
    stopDictation
  ])

  useEffect(() => {
    const canDictate = (): boolean => Boolean(settings?.voice?.enabled)
    const handleControl = (event: Event): void => {
      if (!canDictate() || dictationStateRef.current === 'stopping') {
        return
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: DOM event carries CustomEvent payload from dispatchDictationControl
      const action = (event as CustomEvent<DictationControlAction>).detail
      if (action === 'start') {
        if (dictationStateRef.current === 'idle' || dictationStateRef.current === 'ready-to-copy') {
          void startDictation()
        }
        return
      }
      if (action === 'stop') {
        if (dictationStateRef.current === 'listening' || dictationStateRef.current === 'starting') {
          void stopDictation()
        }
        return
      }
      if (dictationStateRef.current === 'listening' || dictationStateRef.current === 'starting') {
        void stopDictation()
      } else {
        void startDictation()
      }
    }
    document.addEventListener(DICTATION_CONTROL_EVENT, handleControl)
    return () => document.removeEventListener(DICTATION_CONTROL_EVENT, handleControl)
  }, [dictationStateRef, settings?.voice?.enabled, startDictation, stopDictation])
}
