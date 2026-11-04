import { useEffect, useState } from 'react'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useShortcutKeyDetails } from '@/hooks/useShortcutLabel'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { Check, Clipboard, Copy, Square, X } from 'lucide-react'
import { dispatchDictationControl } from './dictation-control-events'
import { DictationGrapes } from './DictationGrapes'
import { useDictationMeter } from './dictation-meter-store'
import { copyTextToClipboard, formatTranscriptPreview } from './dictation-rescue'

export function DictationIndicator() {
  const dictationState = useAppStore((state) => state.dictationState)
  const partialTranscript = useAppStore((state) => state.partialTranscript)
  const rescuedTranscript = useAppStore((state) => state.rescuedTranscript)
  const dismissDictationRescue = useAppStore((state) => state.dismissDictationRescue)
  const autoHideDelay = useAppStore(
    (state) => state.settings?.voice?.dictationRescueAutoHideDelayMs ?? 0
  )
  const isAutoCopied = useAppStore((state) =>
    Boolean(state.settings?.voice?.dictationAutoCopyToClipboard)
  )
  const dictationMeter = useDictationMeter()
  const isHoldMode = useAppStore((state) => state.settings?.voice?.dictationMode === 'hold')
  const shortcut = useShortcutKeyDetails('voice.dictation')
  const [copied, setCopied] = useState(false)

  const isVisible = ['listening', 'starting', 'stopping', 'ready-to-copy'].includes(dictationState)

  const isReadyToCopy = dictationState === 'ready-to-copy'

  useEffect(() => {
    if (dictationState !== 'ready-to-copy') {
      setCopied(false)
      return
    }
    if (isAutoCopied) {
      setCopied(true)
    }
    if (autoHideDelay <= 0) {
      return
    }
    const timer = setTimeout(() => {
      dismissDictationRescue()
    }, autoHideDelay)
    return () => clearTimeout(timer)
  }, [dictationState, autoHideDelay, isAutoCopied, dismissDictationRescue])

  if (!isVisible) {
    return null
  }

  const isListening = dictationState === 'listening'
  const isClipping = isListening && dictationMeter.isClipping
  const isSpeaking = isListening && dictationMeter.isSpeaking && !isClipping
  const lifecycleLabel =
    dictationState === 'starting'
      ? translate('auto.components.dictation.DictationIndicator.7f3660a7ba', 'Starting mic…')
      : dictationState === 'stopping'
        ? translate('auto.components.dictation.DictationIndicator.f082d0cb9d', 'Processing…')
        : translate('auto.components.dictation.DictationIndicator.3de5a129e7', 'Listening')
  const label = isClipping
    ? translate('auto.components.dictation.DictationIndicator.4977162383', 'Too loud')
    : isSpeaking
      ? translate('auto.components.dictation.DictationIndicator.25f2b7a6a5', 'Speaking')
      : lifecycleLabel
  const announcedLabel = isClipping ? label : lifecycleLabel
  const canStop = dictationState !== 'stopping'
  const showShortcut = !isHoldMode && shortcut.keys.length > 0
  const transcript = (isReadyToCopy ? (rescuedTranscript ?? '') : partialTranscript).trim()
  const previewWords = formatTranscriptPreview(transcript, 6)
  const stopLabel = translate(
    'auto.components.dictation.DictationIndicator.335e1bc6cb',
    'Stop dictation'
  )

  const handleCopy = async (): Promise<void> => {
    if (!transcript) {
      return
    }
    await copyTextToClipboard(transcript)
    setCopied(true)
  }

  const handleDismiss = (): void => {
    dismissDictationRescue()
  }

  return (
    <div
      data-testid="dictation-indicator"
      className={cn(
        'fixed bottom-12 left-1/2 z-50 -translate-x-1/2 overflow-hidden',
        'border border-border bg-popover/95 text-sm text-popover-foreground shadow-floating backdrop-blur',
        'transition-[width,border-radius,opacity] duration-200 ease-out motion-reduce:transition-none',
        transcript
          ? 'w-[min(28rem,calc(100vw-2rem))] rounded-xl'
          : 'max-w-[min(28rem,calc(100vw-2rem))] rounded-full',
        isClipping && 'border-destructive/40 text-destructive'
      )}
    >
      <div className="flex h-10 items-center gap-2 px-2">
        {isReadyToCopy ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Clipboard className="size-3.5 shrink-0" style={{ color: '#60a5fa' }} />
            <span aria-hidden className="min-w-0 truncate text-xs">
              <span className="font-semibold text-muted-foreground mr-1">
                {translate('dictation.readyToCopy', 'Ready to Copy')}:
              </span>
              <span className="text-foreground">
                {translate('dictation.quotedPreview', '“{{preview}}”', {
                  preview: previewWords
                })}
              </span>
            </span>
            <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
              {translate('dictation.readyToCopy', 'Ready to Copy')}: {previewWords}
            </span>
          </div>
        ) : (
          <>
            <DictationGrapes
              level={dictationMeter.level}
              active={dictationState !== 'stopping'}
              transitioning={dictationState !== 'listening'}
            />
            <span aria-hidden className="min-w-0 truncate font-medium">
              {label}
            </span>
            <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
              {announcedLabel}
            </span>
          </>
        )}
        {isReadyToCopy ? (
          <div className="flex shrink-0 items-center gap-1">
            <span aria-hidden className="h-4 w-px shrink-0 bg-border mr-0.5" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={
                    copied
                      ? translate('dictation.copied', 'Copied')
                      : translate('dictation.copyTranscript', 'Copy transcript')
                  }
                  className="shrink-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void handleCopy()}
                >
                  {copied ? (
                    <Check className="size-3.5" style={{ color: '#22c55e' }} />
                  ) : (
                    <Copy className="size-3.5" style={{ color: '#ffffff' }} />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                {copied
                  ? translate('dictation.copied', 'Copied')
                  : translate('dictation.copyTranscript', 'Copy transcript')}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={translate('common.close', 'Close')}
                  className="shrink-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={handleDismiss}
                >
                  <X className="size-3.5" style={{ color: '#9ca3af' }} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                {translate('common.close', 'Close')}
              </TooltipContent>
            </Tooltip>
          </div>
        ) : canStop ? (
          <>
            <span aria-hidden className="ml-0.5 h-4 w-px shrink-0 bg-border" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={stopLabel}
                  className="shrink-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => dispatchDictationControl('stop')}
                >
                  <Square className="size-3 fill-current" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6} className="flex items-center gap-1.5">
                {stopLabel}
                {showShortcut ? (
                  <ShortcutKeyCombo keys={shortcut.keys} doubleTap={shortcut.doubleTap} />
                ) : null}
              </TooltipContent>
            </Tooltip>
          </>
        ) : null}
      </div>
      {transcript ? (
        <p
          className="truncate border-t border-border px-3 py-2 text-xs text-muted-foreground select-all"
          title={transcript}
        >
          {transcript}
        </p>
      ) : null}
    </div>
  )
}
