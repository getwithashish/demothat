import { useEditorStore } from '../../store/editorStore'
import { Switch } from '../ui/switch'
import { Section } from '../ui/section'
import { Moon, Sun } from 'tabler-icons-react'
import { ICON_SIZE, ICON_STROKE } from '../ui/icons'
import { PanelHeader } from '../editor/PanelHeader'
import { useShallow } from 'zustand/react/shallow'

export function GeneralTab() {
  const { mode, toggleMode } = useEditorStore(
    useShallow((state) => ({
      mode: state.mode,
      toggleMode: state.toggleMode,
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
      </div>
    </div>
  )
}
