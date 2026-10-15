import { useEditorStore } from '../../store/editorStore'
import { Switch } from '../ui/switch'
import { Section } from '../ui/section'
import { ToggleRow } from '../ui/toggle-row'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Moon, Sun } from 'tabler-icons-react'
import { ICON_SIZE, ICON_STROKE } from '../ui/icons'
import { PanelHeader } from '../editor/PanelHeader'
import { useShallow } from 'zustand/react/shallow'

const AUTO_SAVE_INTERVALS = [
  { value: '15', label: 'Every 15 seconds' },
  { value: '30', label: 'Every 30 seconds' },
  { value: '60', label: 'Every minute' },
  { value: '300', label: 'Every 5 minutes' },
]

export function GeneralTab() {
  const { mode, toggleMode, autoSaveEnabled, autoSaveIntervalSec, setAutoSaveEnabled, setAutoSaveIntervalSec } =
    useEditorStore(
      useShallow((state) => ({
        mode: state.mode,
        toggleMode: state.toggleMode,
        autoSaveEnabled: state.autoSaveEnabled,
        autoSaveIntervalSec: state.autoSaveIntervalSec,
        setAutoSaveEnabled: state.setAutoSaveEnabled,
        setAutoSaveIntervalSec: state.setAutoSaveIntervalSec,
      })),
    )

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="General" subtitle="Appearance" />
      <div className="min-h-0 flex-1 overflow-y-auto stable-scrollbar">
        <Section first label="Appearance">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-ui text-fg">Theme</div>
              <p className="text-sm text-muted">Switch between light and dark mode.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Sun size={ICON_SIZE} strokeWidth={ICON_STROKE} className="text-muted" />
              <Switch checked={mode === 'dark'} onCheckedChange={toggleMode} />
              <Moon size={ICON_SIZE} strokeWidth={ICON_STROKE} className="text-muted" />
            </div>
          </div>
        </Section>

        <Section label="Auto-save">
          <div className="space-y-3.5">
            <ToggleRow
              id="auto-save-enabled"
              label="Auto-save while editing"
              description="Saves in the background. Unsaved projects are written to a recovery copy."
              checked={autoSaveEnabled}
              onCheckedChange={setAutoSaveEnabled}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-ui text-fg">Interval</div>
                <p className="text-sm text-muted">How often to save while there are unsaved changes.</p>
              </div>
              <Select
                value={String(autoSaveIntervalSec)}
                onValueChange={(value) => setAutoSaveIntervalSec(Number(value))}
                disabled={!autoSaveEnabled}
              >
                <SelectTrigger variant="minimal" className="w-[170px]" aria-label="Auto-save interval">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {AUTO_SAVE_INTERVALS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}
