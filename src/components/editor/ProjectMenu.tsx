// The editor header's project menu: open, recent, save, copy, rename and
// reveal, behind one trigger that carries the project name (DESIGN_SPEC §5).
//
// §3 of the brief replaces the wordmark with this trigger, so "DemoThat" no
// longer appears in the header.

import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ChevronDown, Clock, Copy, Folder, Pencil, Video } from 'tabler-icons-react'
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
import { projectNameFromPath, validateProjectName } from '../../lib/recent-projects'
import { ICON_STROKE } from '../ui/icons'
import { cn } from '../../lib/utils'

export interface RenameResult {
  ok: boolean
  path?: string
  error?: string
}

export interface ProjectMenuProps {
  onOpenProject: () => void
  onOpenRecent: (path: string) => void
  onSave: () => void
  onSaveCopy: () => void
  /** Renames the file on disk; resolves with the outcome for inline display. */
  onRename: (newName: string) => Promise<RenameResult>
  /** Opens the rolling crash-recovery copy as an unsaved project. */
  onOpenRecovery: () => void
  onShowInFolder: () => void
  onNewRecording: () => void
}

export function ProjectMenu({
  onOpenProject,
  onOpenRecent,
  onSave,
  onSaveCopy,
  onRename,
  onOpenRecovery,
  onShowInFolder,
  onNewRecording,
}: ProjectMenuProps) {
  const { currentProjectPath, recentProjects, autoSaveEnabled, lastSavedAt, lastRecoveryAt, platform, recoveryCopy } =
    useEditorStore(
      useShallow((state) => ({
        currentProjectPath: state.currentProjectPath,
        recentProjects: state.recentProjects,
        autoSaveEnabled: state.autoSaveEnabled,
        lastSavedAt: state.lastSavedAt,
        lastRecoveryAt: state.lastRecoveryAt,
        platform: state.platform,
        recoveryCopy: state.recoveryCopy,
      })),
    )
  const clearRecentProjects = useEditorStore((state) => state.clearRecentProjects)
  const refreshRecoveryCopy = useEditorStore((state) => state.refreshRecoveryCopy)

  const [isOpen, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [isRenaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // The footer is a live relative time while the menu is open.
  useEffect(() => {
    if (!isOpen) return
    setNow(Date.now())
    // A recovery copy can appear (the first autosave tick) while the app runs.
    void refreshRecoveryCopy()
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isOpen, refreshRecoveryCopy])

  // Focus once the closed menu has finished handing focus back to the trigger
  // this field replaces, so the caret really lands here and the text is selected.
  useEffect(() => {
    if (!isRenaming) return
    const timer = window.setTimeout(() => {
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
    }, 60)
    return () => window.clearTimeout(timer)
  }, [isRenaming])

  const isTitled = !!currentProjectPath
  const name = isTitled ? projectNameFromPath(currentProjectPath) : 'Untitled project'
  const modKey = platform === 'darwin' ? '⌘' : 'Ctrl+'

  const savedClock = formatRelativeTime(lastSavedAt, now)
  // The copy on disk is the one the user cares about; this session's write is
  // the fallback before the store has re-read it.
  const recoveryClock = formatRelativeTime(recoveryCopy.exists ? recoveryCopy.modifiedAt : lastRecoveryAt, now)
  const footer = isTitled
    ? savedClock
      ? `Autosaved ${savedClock}`
      : 'Not saved yet'
    : recoveryClock
      ? `Recovery copy saved ${recoveryClock}`
      : 'Not saved yet'

  const startRename = () => {
    setNameDraft(name)
    setNameError(null)
    setRenaming(true)
  }

  const commitRename = async () => {
    // The current project is excluded from the collision check: keeping its own
    // name is a harmless no-op, not a clash.
    const otherNames = recentProjects.filter((project) => project.path !== currentProjectPath).map((p) => p.name)
    const validationError = validateProjectName(nameDraft, otherNames)
    if (validationError) {
      setNameError(validationError)
      return
    }
    const result = await onRename(nameDraft.trim())
    if (!result.ok) {
      setNameError(result.error ?? 'Could not rename the project')
      return
    }
    setRenaming(false)
    setNameError(null)
  }

  if (isRenaming) {
    return (
      <span className="pointer-events-auto flex items-center gap-2 text-ui" style={{ WebkitAppRegion: 'no-drag' }}>
        <input
          ref={nameInputRef}
          value={nameDraft}
          aria-label="Project name"
          aria-invalid={nameError !== null}
          onChange={(event) => {
            setNameDraft(event.target.value)
            setNameError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void commitRename()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setRenaming(false)
            }
          }}
          onBlur={() => setRenaming(false)}
          className={cn(
            'w-[200px] rounded-ctl border bg-ctl px-2 py-1 text-ui text-fg outline-none',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            nameError ? 'border-danger' : 'border-line',
          )}
        />
        {nameError && <span className="text-xs text-danger">{nameError}</span>}
      </span>
    )
  }

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
          <DropdownMenuSubTrigger disabled={recentProjects.length === 0 && !recoveryCopy.exists}>
            <span className="flex items-center gap-2">
              <Clock size={16} strokeWidth={ICON_STROKE} className="text-muted" />
              Open recent
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {recoveryCopy.exists && (
              <>
                <DropdownMenuItem onSelect={onOpenRecovery}>
                  <span className="truncate">
                    Recovered project
                    {recoveryClock ? `, ${recoveryClock}` : ''}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
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
          <>
            <DropdownMenuItem onSelect={onSaveCopy}>
              <Copy size={16} strokeWidth={ICON_STROKE} className="text-muted" />
              Save a copy…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={startRename}>
              <Pencil size={16} strokeWidth={ICON_STROKE} className="text-muted" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onShowInFolder}>
              <Folder size={16} strokeWidth={ICON_STROKE} className="text-muted" />
              Show in folder
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuFooter>{footer}</DropdownMenuFooter>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
