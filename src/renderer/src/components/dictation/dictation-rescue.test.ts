// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  copyTextToClipboard,
  formatTranscriptPreview,
  handleDictationRescue
} from './dictation-rescue'

describe('dictation-rescue', () => {
  describe('formatTranscriptPreview', () => {
    it('returns empty string for empty or whitespace input', () => {
      expect(formatTranscriptPreview('')).toBe('')
      expect(formatTranscriptPreview('   \n\t  ')).toBe('')
    })

    it('returns the full transcript if word count is within limit', () => {
      expect(formatTranscriptPreview('Hello world')).toBe('Hello world')
      expect(formatTranscriptPreview('One two three four five six', 6)).toBe(
        'One two three four five six'
      )
    })

    it('returns truncated preview with ellipsis when words exceed limit', () => {
      const input = 'The quick brown fox jumps over the lazy dog'
      expect(formatTranscriptPreview(input, 5)).toBe('The quick brown fox jumps…')
      expect(formatTranscriptPreview(input, 6)).toBe('The quick brown fox jumps over…')
    })
  })

  describe('copyTextToClipboard', () => {
    const originalNavigator = globalThis.navigator

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('does nothing for empty text', async () => {
      const writeText = vi.fn()
      Object.assign(window, { api: { ui: { writeClipboardText: writeText } } })
      await copyTextToClipboard('')
      expect(writeText).not.toHaveBeenCalled()
    })

    it('prefers window.api.ui.writeClipboardText when available', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(window, { api: { ui: { writeClipboardText: writeText } } })
      await copyTextToClipboard('sample transcript')
      expect(writeText).toHaveBeenCalledWith('sample transcript')
    })

    it('falls back to navigator.clipboard.writeText if desktop bridge fails or is absent', async () => {
      const navWriteText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { ...originalNavigator, clipboard: { writeText: navWriteText } }
      })
      Object.assign(window, { api: {} })

      await copyTextToClipboard('fallback transcript')
      expect(navWriteText).toHaveBeenCalledWith('fallback transcript')
    })
  })

  describe('handleDictationRescue (#26712)', () => {
    const setRescuedTranscript = vi.fn()
    const setDictationState = vi.fn()

    beforeEach(() => {
      setRescuedTranscript.mockClear()
      setDictationState.mockClear()
    })

    it('does not rescue when cancellation was intentional', () => {
      const result = handleDictationRescue({
        text: 'Hello world',
        insertedText: '',
        intentionalCancellation: true,
        autoCopy: false,
        setRescuedTranscript,
        setDictationState
      })

      expect(result).toBeNull()
      expect(setRescuedTranscript).not.toHaveBeenCalled()
      expect(setDictationState).not.toHaveBeenCalled()
    })

    it('does not rescue when text is empty', () => {
      const result = handleDictationRescue({
        text: '   ',
        insertedText: '',
        intentionalCancellation: false,
        autoCopy: false,
        setRescuedTranscript,
        setDictationState
      })

      expect(result).toBeNull()
      expect(setRescuedTranscript).not.toHaveBeenCalled()
      expect(setDictationState).not.toHaveBeenCalled()
    })

    it('rescues uninserted transcript and transitions to ready-to-copy without clobbering clipboard', () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(window, { api: { ui: { writeClipboardText: writeText } } })

      const result = handleDictationRescue({
        text: 'rescued speech while outside input',
        insertedText: 'initial ',
        intentionalCancellation: false,
        autoCopy: false,
        setRescuedTranscript,
        setDictationState
      })

      expect(result).toBe('initial rescued speech while outside input')
      expect(setRescuedTranscript).toHaveBeenCalledWith(
        'initial rescued speech while outside input'
      )
      expect(setDictationState).toHaveBeenCalledWith('ready-to-copy')
      // Clipboard must not be touched when autoCopy is false
      expect(writeText).not.toHaveBeenCalled()
    })

    it('copies to clipboard automatically when autoCopy is true', () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(window, { api: { ui: { writeClipboardText: writeText } } })

      const result = handleDictationRescue({
        text: 'auto copy speech',
        insertedText: '',
        intentionalCancellation: false,
        autoCopy: true,
        setRescuedTranscript,
        setDictationState
      })

      expect(result).toBe('auto copy speech')
      expect(writeText).toHaveBeenCalledWith('auto copy speech')
    })
  })
})
