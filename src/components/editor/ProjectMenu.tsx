// The editor header's project menu: open, recent, save and reveal, behind one
// trigger that carries the project name (DESIGN_SPEC §5).
//
// §3 of the brief replaces the wordmark with this trigger, so "DemoThat" no
// longer appears in the header.

import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ChevronDown, Clock, Folder, Video } from 'tabler-icons-react'
import { useEditorStore } from '../../store/editorStore'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuFooter,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { formatRelativeTime } from '../../lib/auto-save'
import { projectNameFromPath } from '../../lib/recent-projects'
import { ICON_STROKE } from '../ui/icons'

export interface ProjectMenuProps {
  onOpenProject: () => void
  onOpenRecent: (path: string) => void
  onSave: () => void
  onShowInFolder: () => void
  onNewRecording: () => void
}

export function ProjectMenu({ onOpenProject, onOpenRecent, onSave, onShowInFolder, onNewRecording }: ProjectMenuProps) {
  const { currentProjectPath, recentProjects, autoSaveEnabled, lastSavedAt, lastRecoveryAt, platform } = useEditorStore(
    useShallow((state) => ({
      currentProjectPath: state.currentProjectPath,
      recentProjects: state.recentProjects,
      autoSaveEnabled: state.autoSaveEnabled,
      lastSavedAt: state.lastSavedAt,
      lastRecoveryAt: state.lastRecoveryAt,
      platform: state.platform,
    })),
  )
  const clearRecentProjects = useEditorStore((state) => state.clearRecentProjects)

  const [isOpen, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  // The footer is a live relative time while the menu is open.
  useEffect(() => {
    if (!isOpen) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isOpen])

  const isTitled = !!currentProjectPath
  const name = isTitled ? projectNameFromPath(currentProjectPath) : 'Untitled project'
  const modKey = platform === 'darwin' ? '⌘' : 'Ctrl+'

  const savedClock = formatRelativeTime(lastSavedAt, now)
  const recoveryClock = formatRelativeTime(lastRecoveryAt, now)
  const footer = isTitled
    ? savedClock
      ? `Autosaved ${savedClock}`
      : 'Not saved yet'
    : recoveryClock
      ? `Recovery copy saved ${recoveryClock}`
      : 'Not saved yet'

  return (
    <DropdownMenu open={isOpen} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Project menu"
          className="pointer-events-auto flex max-w-[220px] items-center gap-1 rounded-ctl px-2 py-1 text-ui text-fg outline-none hover:bg-ctl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-[state=open]:bg-ctl-hover"
          style={{ WebkitAppRegion: 'no-drag' }}
        >
          <span className="truncate">{name}</span>
          <ChevronDown size={14} strokeWidth={ICON_STROKE} className="shrink-0 text-muted" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" style={{ WebkitAppRegion: 'no-drag' }}>
        <DropdownMenuItem onSelect={onOpenProject} trailing={`${modKey}O`}>
          <Folder size={16} strokeWidth={ICON_STROKE} className="text-muted" />
          Open project…
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={recentProjects.length === 0}>
            <span className="flex items-center gap-2">
              <Clock size={16} strokeWidth={ICON_STROKE} className="text-muted" />
              Open recent
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {recentProjects.map((project) => (
              <DropdownMenuItem key={project.path} onSelect={() => onOpenRecent(project.path)}>
                <span className="truncate" title={project.path}>
                  {project.name}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={recentProjects.length === 0} onSelect={() => clearRecentProjects()}>
              Clear recent
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem onSelect={onNewRecording}>
          <Video size={16} strokeWidth={ICON_STROKE} className="text-muted" />
          New recording
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {isTitled ? (
          // With autosave on, saving is automatic — the item only appears when
          // the user has turned it off.
          !autoSaveEnabled && (
            <DropdownMenuItem onSelect={onSave} trailing={`${modKey}S`}>
              Save
            </DropdownMenuItem>
          )
        ) : (
          // An untitled project has nowhere to save to: this always asks.
          <DropdownMenuItem onSelect={onSave} trailing={`${modKey}S`}>
            Save project…
          </DropdownMenuItem>
        )}

        {isTitled && (
          <DropdownMenuItem onSelect={onShowInFolder}>
            <Folder size={16} strokeWidth={ICON_STROKE} className="text-muted" />
            Show in folder
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuFooter>{footer}</DropdownMenuFooter>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
