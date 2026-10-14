import { useState } from 'react'
import { cn } from '../../lib/utils'
import { Settings, InfoCircle, Keyboard } from 'tabler-icons-react'
import { ICON_SIZE, ICON_STROKE } from '../ui/icons'
import { GeneralTab } from './GeneralTab'
import { AboutTab } from './AboutTab'
import { ShortcutsTab } from './ShortcutsTab'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

type SettingsTab = 'general' | 'shortcuts' | 'about'

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <Settings size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
  { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
  { id: 'about', label: 'About', icon: <InfoCircle size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
]

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  if (!isOpen) return null

  const renderContent = () => {
    switch (activeTab) {
      case 'general':
        return <GeneralTab />
      case 'shortcuts':
        return <ShortcutsTab />
      case 'about':
        return <AboutTab />
      default:
        return null
    }
  }

  return (
    <div className="modal-backdrop flex items-center justify-center" onClick={onClose}>
      <div
        className="card-clean m-4 flex h-[60vh] max-h-[500px] w-full max-w-3xl flex-row overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Tabs */}
        <div className="flex w-44 flex-shrink-0 flex-col border-r border-line p-3">
          <h2 className="mb-2.5 px-2 text-title font-semibold text-fg">Settings</h2>
          <div role="tablist" aria-label="Settings sections" aria-orientation="vertical" className="flex flex-col gap-0.5">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-ctl border-l-2 py-1.5 pl-2 pr-2 text-left text-ui transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  activeTab === tab.id
                    ? 'border-accent bg-ctl text-fg'
                    : 'border-transparent text-muted hover:bg-ctl hover:text-fg',
                )}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="relative min-w-0 flex-1 overflow-y-auto stable-scrollbar">{renderContent()}</div>
      </div>
    </div>
  )
}
