import { useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '@/store'
import { useAudioCapture } from '@/hooks/use-audio-capture'
import { toast } from 'sonner'
import { DictationIndicator } from './DictationIndicator'
import {
  captureInsertionTarget,
  insertText,
  type DictationInsertionTarget
} from './dictation-insertion-target'
import { formatFinalTranscriptSegment } from '../../../../shared/dictation-transcript-spacing'
import { recordStoppedSession, waitForStoppedSession } from './dictation-stopped-sessions'
import { translate } from '@/i18n/i18n'
import {
  showDictationNoModelToast,
  showDictationStartErrorToast
} from './dictation-start-error-toast'
import { useHoldDictationGesture } from './use-hold-dictation-gesture'
import { useDictationControlEvents } from './use-dictation-control-events'
import { publishDictationMeter } from './dictation-meter-store'
import { handleDictationRescue } from './dictation-rescue'

export function DictationController() {
  const dictationState = useAppStore((s) => s.dictationState)
  const setDictationState = useAppStore((s) => s.setDictationState)
  const setPartialTranscript = useAppStore((s) => s.setPartialTranscript)
  const setRescuedTranscript = useAppStore((s) => s.setRescuedTranscript)
  const dismissDictationRescue = useAppStore((s) => s.dismissDictationRescue)
  const recordFeatureInteraction = useAppStore((s) => s.recordFeatureInteraction)
  const settings = useAppStore((s) => s.settings)
  const keybindings = useAppStore((s) => s.keybindings)
  const {
    start: startCapture,
    stop: stopCapture,
    flushBufferedAudio,
    discardBufferedAudio,
    getCapturedChunkCount
  } = useAudioCapture(publishDictationMeter)

  const dictationStateRef = useRef(dictationState)
  dictationStateRef.current = dictationState
  const dictationRunRef = useRef(0)
  const holdGestureActiveRef = useRef(false)
  const insertionTargetRef = useRef<DictationInsertionTarget | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const stoppedSessionIdsRef = useRef(new Set<string>())
  const stoppedResolversRef = useRef(new Map<string, () => void>())
  const stopRequestedDuringStartRef = useRef(false)
  const finalTranscriptReceivedRef = useRef(false)
  const erroredSessionIdsRef = useRef(new Set<string>())
  const intentionalTargetCancellationRef = useRef(false)
  const insertedFinalTranscriptRef = useRef('')
  // Push-to-talk restarts per utterance; report a missing preferred microphone once per preference.
  const micFallbackNotifiedForRef = useRef<string | null>(null)
  const stopDictationRef = useRef<(() => void) | null>(null)

  const drainStoppedSession = useCallback((sessionId: string) => {
    void waitForStoppedSession(sessionId, stoppedSessionIdsRef, stoppedResolversRef)
  }, [])

  const finishDictationSession = useCallback(
    async (sessionId: string) => {
      dictationStateRef.current = 'stopping'
      setDictationState('stopping')
      stopCapture()
      try {
        await window.api.speech.stopDictation(sessionId)
      } catch {
        // Swallow stop errors — the worker may already be torn down.
      }
      // Main stop completion can precede renderer final-text IPC; wait for this session’s stopped event before accepting the next run.
      await waitForStoppedSession(sessionId, stoppedSessionIdsRef, stoppedResolversRef)
      const sessionErrored = erroredSessionIdsRef.current.delete(sessionId)
      if (!sessionErrored && !finalTranscriptReceivedRef.current && getCapturedChunkCount() > 0) {
        toast.message(
          translate(
            'auto.components.dictation.DictationController.5d2c3e7ae3',
            'No speech detected.'
          )
        )
      }
      insertionTargetRef.current = null
      finalTranscriptReceivedRef.current = false
      insertedFinalTranscriptRef.current = ''
      intentionalTargetCancellationRef.current = false
      stopRequestedDuringStartRef.current = false
      if (activeSessionIdRef.current === sessionId) {
        activeSessionIdRef.current = null
      }
      if (useAppStore.getState().dictationState !== 'ready-to-copy') {
        dictationStateRef.current = 'idle'
        setDictationState('idle')
      }
      setPartialTranscript('')
    },
    [setDictationState, setPartialTranscript, stopCapture, getCapturedChunkCount]
  )

  const startDictation = useCallback(async () => {
    if (dictationStateRef.current !== 'idle' && dictationStateRef.current !== 'ready-to-copy') {
      return
    }
    dismissDictationRescue()

    const modelId = settings?.voice?.sttModel
    if (!modelId) {
      showDictationNoModelToast()
      return
    }

    if (!settings?.voice?.enabled) {
      toast('Voice dictation is disabled. Enable it in Settings > Voice.')
      return
    }

    const runId = dictationRunRef.current + 1
    const sessionId = String(runId)
    dictationRunRef.current = runId
    activeSessionIdRef.current = sessionId
    insertionTargetRef.current = captureInsertionTarget()
    stopRequestedDuringStartRef.current = false
    finalTranscriptReceivedRef.current = false
    erroredSessionIdsRef.current.clear()
    insertedFinalTranscriptRef.current = ''
    intentionalTargetCancellationRef.current = false
    dictationStateRef.current = 'starting'
    setDictationState('starting')

    let captureStarted = false

    try {
      // Capture and buffer before slow worker startup so speech during Starting is retained.
      const preferredMicrophoneDeviceId = settings?.voice?.microphoneDeviceId ?? null
      const captureResult = await startCapture({
        bufferAudio: true,
        sessionId,
        microphoneDeviceId: preferredMicrophoneDeviceId,
        microphoneDeviceLabel: settings?.voice?.microphoneDeviceLabel ?? null,
        onCaptureLost: () => {
          if (dictationRunRef.current !== runId) {
            return
          }
          toast.message(
            translate(
              'auto.components.dictation.DictationController.micDisconnected',
              'Microphone disconnected. Dictation stopped.'
            )
          )
          stopDictationRef.current?.()
        }
      })
      captureStarted = true
      if (captureResult?.fellBackToDefaultMicrophone) {
        // Suppress fallback notices when a queued stop will tear down this startup capture.
        if (
          !stopRequestedDuringStartRef.current &&
          micFallbackNotifiedForRef.current !== preferredMicrophoneDeviceId
        ) {
          micFallbackNotifiedForRef.current = preferredMicrophoneDeviceId
          toast.message(
            translate(
              'auto.components.dictation.DictationController.micFallback',
              'Selected microphone unavailable. Using system default.'
            )
          )
        }
      } else {
        micFallbackNotifiedForRef.current = null
      }
      if (stopRequestedDuringStartRef.current) {
        stopCapture({ preserveBufferedAudio: true })
      }
      if (dictationRunRef.current !== runId) {
        discardBufferedAudio()
        stopCapture()
        insertionTargetRef.current = null
        return
      }

      await window.api.speech.startDictation(modelId, undefined, sessionId)
      if (dictationRunRef.current !== runId) {
        discardBufferedAudio()
        insertionTargetRef.current = null
        stopCapture()
        await window.api.speech.stopDictation(sessionId).catch(() => undefined)
        drainStoppedSession(sessionId)
        return
      }

      await flushBufferedAudio()
      if (dictationRunRef.current !== runId) {
        discardBufferedAudio()
        insertionTargetRef.current = null
        stopCapture()
        await window.api.speech.stopDictation(sessionId).catch(() => undefined)
        drainStoppedSession(sessionId)
        return
      }
      if (stopRequestedDuringStartRef.current) {
        await finishDictationSession(sessionId)
        return
      }

      dictationStateRef.current = 'listening'
      setDictationState('listening')
      recordFeatureInteraction('voice-dictation')
    } catch (err) {
      if (dictationRunRef.current !== runId) {
        return
      }
      await window.api.speech.stopDictation(sessionId).catch(() => undefined)
      drainStoppedSession(sessionId)
      if (captureStarted) {
        stopCapture()
      }
      discardBufferedAudio()
      const message = String(err)
      insertionTargetRef.current = null
      intentionalTargetCancellationRef.current = false
      stopRequestedDuringStartRef.current = false
      finalTranscriptReceivedRef.current = false
      erroredSessionIdsRef.current.clear()
      insertedFinalTranscriptRef.current = ''
      activeSessionIdRef.current = null
      setPartialTranscript('')
      if (message.includes('dictation_canceled')) {
        dictationStateRef.current = 'idle'
        setDictationState('idle')
        return
      }
      dictationStateRef.current = 'error'
      setDictationState('error')
      showDictationStartErrorToast(message)
      dictationStateRef.current = 'idle'
      setDictationState('idle')
    }
  }, [
    settings,
    setDictationState,
    startCapture,
    flushBufferedAudio,
    discardBufferedAudio,
    stopCapture,
    finishDictationSession,
    drainStoppedSession,
    setPartialTranscript,
    recordFeatureInteraction,
    dismissDictationRescue
  ])

  const stopDictation = useCallback(async () => {
    if (dictationStateRef.current === 'starting') {
      stopRequestedDuringStartRef.current = true
      dictationStateRef.current = 'stopping'
      setDictationState('stopping')
      stopCapture({ preserveBufferedAudio: true })
      return
    }

    if (dictationStateRef.current !== 'listening') {
      return
    }

    const sessionId = activeSessionIdRef.current
    if (!sessionId) {
      return
    }
    await finishDictationSession(sessionId)
  }, [finishDictationSession, setDictationState, stopCapture])

  // Capture opens before stopDictation exists; bridge through a ref to avoid cyclic callback dependencies.
  stopDictationRef.current = () => void stopDictation()

  useDictationControlEvents({
    dictationStateRef,
    settings,
    startDictation,
    stopDictation
  })

  useHoldDictationGesture({
    dictationStateRef,
    holdGestureActiveRef,
    insertionTargetRef,
    intentionalTargetCancellationRef,
    keybindings,
    settings,
    startDictation,
    stopDictation
  })

  useEffect(() => {
    const cleanupPartial = window.api.speech.onPartialTranscript((data) => {
      if (data.sessionId !== activeSessionIdRef.current) {
        return
      }
      setPartialTranscript(data.text)
    })

    const cleanupFinal = window.api.speech.onFinalTranscript((data) => {
      if (data.sessionId !== activeSessionIdRef.current || !data.text) {
        return
      }
      setPartialTranscript('')
      finalTranscriptReceivedRef.current = true
      const target = insertionTargetRef.current
      const textToProcess = data.text
      let inserted = false
      if (target) {
        const textToInsert = formatFinalTranscriptSegment(
          textToProcess,
          insertedFinalTranscriptRef.current
        )
        const result = insertText(textToInsert, target)
        if (result.success) {
          inserted = true
          insertedFinalTranscriptRef.current += textToInsert
        }
      }
      if (!inserted) {
        handleDictationRescue({
          text: textToProcess,
          insertedText: insertedFinalTranscriptRef.current,
          intentionalCancellation: intentionalTargetCancellationRef.current,
          autoCopy: Boolean(settings?.voice?.dictationAutoCopyToClipboard),
          setRescuedTranscript,
          setDictationState
        })
      }
    })

    const cleanupStopped = window.api.speech.onStopped((data) => {
      recordStoppedSession(data.sessionId, stoppedSessionIdsRef, stoppedResolversRef)
    })

    const cleanupError = window.api.speech.onError((data) => {
      if (data.sessionId !== activeSessionIdRef.current) {
        return
      }
      const sessionId = data.sessionId
      erroredSessionIdsRef.current.add(sessionId)
      dictationRunRef.current += 1
      activeSessionIdRef.current = null
      toast.error(
        translate(
          'auto.components.dictation.DictationController.de136f1199',
          'Speech error: {{value0}}',
          { value0: data.error }
        )
      )
      dictationStateRef.current = 'stopping'
      setDictationState('stopping')
      stopCapture()
      discardBufferedAudio()
      void (async () => {
        await window.api.speech.stopDictation(sessionId).catch(() => undefined)
        await waitForStoppedSession(sessionId, stoppedSessionIdsRef, stoppedResolversRef)
        insertionTargetRef.current = null
        intentionalTargetCancellationRef.current = false
        stopRequestedDuringStartRef.current = false
        finalTranscriptReceivedRef.current = false
        insertedFinalTranscriptRef.current = ''
        dictationStateRef.current = 'idle'
        setDictationState('idle')
        setPartialTranscript('')
      })()
    })

    return () => {
      cleanupPartial()
      cleanupFinal()
      cleanupStopped()
      cleanupError()
    }
  }, [
    setPartialTranscript,
    setDictationState,
    setRescuedTranscript,
    stopCapture,
    discardBufferedAudio,
    settings?.voice?.dictationAutoCopyToClipboard
  ])

  return <DictationIndicator />
}
