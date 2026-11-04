import type { DictationState } from '../../../../shared/speech-types'

/**
 * Format a truncated preview of the first few words of a dictation transcript.
 */
export function formatTranscriptPreview(transcript: string, maxWords = 6): string {
  const trimmed = transcript.trim()
  if (!trimmed) {
    return ''
  }
  const words = trimmed.split(/\s+/)
  if (words.length <= maxWords) {
    return trimmed
  }
  return `${words.slice(0, maxWords).join(' ')}…`
}

/**
 * Copy text to clipboard via the desktop bridge if present, falling back to navigator.clipboard.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (!text) {
    return
  }
  if (typeof window !== 'undefined' && window.api?.ui?.writeClipboardText) {
    try {
      await window.api.ui.writeClipboardText(text)
      return
    } catch {
      // Fall through to navigator.clipboard
    }
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
  }
}

export type DictationRescueOptions = {
  text: string
  insertedText: string
  intentionalCancellation: boolean
  autoCopy: boolean
  setRescuedTranscript: (text: string | null) => void
  setDictationState: (state: DictationState) => void
}

export function handleDictationRescue({
  text,
  insertedText,
  intentionalCancellation,
  autoCopy,
  setRescuedTranscript,
  setDictationState
}: DictationRescueOptions): string | null {
  if (intentionalCancellation) {
    return null
  }
  const fullTranscript = (insertedText + text).trim()
  if (!fullTranscript) {
    return null
  }
  setRescuedTranscript(fullTranscript)
  setDictationState('ready-to-copy')
  if (autoCopy) {
    void copyTextToClipboard(fullTranscript)
  }
  return fullTranscript
}
