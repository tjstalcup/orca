import type { VoiceSettings } from '../../../../../shared/speech-types'
import { Label } from '../../ui/label'
import { Separator } from '../../ui/separator'
import { Switch } from '../../ui/switch'
import { useShortcutLabel } from '@/hooks/useShortcutLabel'
import { translate } from '@/i18n/i18n'
import { VoiceMicrophoneSetting } from './VoiceMicrophoneSetting'

type VoiceDictationSettingsSectionProps = {
  voiceSettings: VoiceSettings
  permissionPending: boolean
  onToggleVoiceDictation: () => void
  onUpdateVoiceSettings: (updates: Partial<VoiceSettings>) => void
}

export function VoiceDictationSettingsSection({
  voiceSettings,
  permissionPending,
  onToggleVoiceDictation,
  onUpdateVoiceSettings
}: VoiceDictationSettingsSectionProps): React.JSX.Element {
  const shortcutLabel = useShortcutLabel('voice.dictation')

  return (
    <>
      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label>
            {translate('auto.components.settings.VoicePane.0121960365', 'Enable Voice Dictation')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.VoicePane.dictationShortcutDescription',
              'Press {{shortcut}} to dictate text into any focused pane.',
              { shortcut: shortcutLabel }
            )}
          </p>
        </div>
        <Switch
          checked={voiceSettings.enabled}
          aria-label={translate(
            'auto.components.settings.VoicePane.0121960365',
            'Enable Voice Dictation'
          )}
          aria-busy={permissionPending}
          disabled={permissionPending}
          onCheckedChange={() => void onToggleVoiceDictation()}
          className="disabled:cursor-wait disabled:opacity-70"
        />
      </div>

      <Separator />

      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label>
            {translate('auto.components.settings.VoicePane.ba4a900d1d', 'Dictation Mode')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.VoicePane.dictationModesDescription',
              'Toggle: press {{shortcut}} once to start, again to stop. Hold: dictate while {{shortcut}} is held.',
              { shortcut: shortcutLabel }
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center rounded-md border border-border/60 bg-background/50 p-0.5">
          {(['toggle', 'hold'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onUpdateVoiceSettings({ dictationMode: mode })}
              disabled={!voiceSettings.enabled}
              className={`rounded-sm px-3 py-1 text-sm transition-colors ${
                voiceSettings.dictationMode === mode
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              } ${!voiceSettings.enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {mode === 'toggle'
                ? translate('auto.components.settings.VoicePane.118b3c2dee', 'Toggle')
                : translate('auto.components.settings.VoicePane.174da92062', 'Hold')}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      <VoiceMicrophoneSetting
        voiceSettings={voiceSettings}
        onUpdateVoiceSettings={onUpdateVoiceSettings}
      />

      <Separator />

      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label>
            {translate(
              'components.settings.VoicePane.autoCopyTranscript',
              'Auto-copy Uninserted Transcript'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'components.settings.VoicePane.autoCopyTranscriptDescription',
              'Automatically copy transcript to clipboard if no text field was focused or available.'
            )}
          </p>
        </div>
        <Switch
          checked={voiceSettings.dictationAutoCopyToClipboard ?? false}
          aria-label={translate(
            'components.settings.VoicePane.autoCopyTranscript',
            'Auto-copy Uninserted Transcript'
          )}
          disabled={!voiceSettings.enabled}
          onCheckedChange={(checked) =>
            onUpdateVoiceSettings({ dictationAutoCopyToClipboard: checked })
          }
        />
      </div>

      <Separator />

      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label>
            {translate('components.settings.VoicePane.rescueAutoHide', 'Transcript Pill Dismissal')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'components.settings.VoicePane.rescueAutoHideDescription',
              'Choose how long the ready-to-copy transcript pill stays visible.'
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center rounded-md border border-border/60 bg-background/50 p-0.5">
          {[
            {
              label: translate('components.settings.VoicePane.rescueStayOpen', 'Stay open'),
              value: 0
            },
            {
              label: translate('components.settings.VoicePane.rescue5s', '5s'),
              value: 5000
            },
            {
              label: translate('components.settings.VoicePane.rescue10s', '10s'),
              value: 10000
            },
            {
              label: translate('components.settings.VoicePane.rescue30s', '30s'),
              value: 30000
            }
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() =>
                onUpdateVoiceSettings({ dictationRescueAutoHideDelayMs: option.value })
              }
              disabled={!voiceSettings.enabled}
              className={`rounded-sm px-2.5 py-1 text-xs transition-colors ${
                (voiceSettings.dictationRescueAutoHideDelayMs ?? 0) === option.value
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              } ${!voiceSettings.enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <Separator />
    </>
  )
}
