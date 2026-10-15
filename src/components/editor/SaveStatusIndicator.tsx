// Save status in the editor header (DESIGN_SPEC §5): one small, quiet line that
// says whether the work on screen is on disk.
//
// The decisions live in src/lib/auto-save.ts; this file only renders them.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { AlertTriangle, Check, Cloud, CloudOff, Loader2, Point } from 'tabler-icons-react'
import { useEditorStore } from '../../store/editorStore'
import { formatRelativeTime, selectSaveIndicator, type SaveIndicatorView } from '../../lib/auto-save'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { ICON_STROKE } from '../ui/icons'
import { cn } from '../../lib/utils'
import type { SaveStatus } from '../../types'

/**
 * AGENTS.md pins icons at 18px; the save line is deliberately smaller because
 * the spec asks for a 16px icon here.
 */
const STATUS_ICON_SIZE = 16

/** tabler-icons-react v1.56 has no cloud-check, so the cloud carries a tick. */
function StatusIcon({ kind }: { kind: SaveStatus }) {
  switch (kind) {
    case 'saving':
      return <Loader2 size={STATUS_ICON_SIZE} strokeWidth={ICON_STROKE} className="animate-spin" />
    case 'saved':
      return (
        <span className="relative inline-flex">
          <Cloud size={STATUS_ICON_SIZE} strokeWidth={ICON_STROKE} />
          <Check
            size={10}
            strokeWidth={ICON_STROKE + 1}
            className="absolute -bottom-0.5 -right-1 rounded-full bg-panel"
          />
        </span>
      )
    case 'error':
      return <AlertTriangle size={STATUS_ICON_SIZE} strokeWidth={ICON_STROKE} />
    case 'untitled':
      return <CloudOff size={STATUS_ICON_SIZE} strokeWidth={ICON_STROKE} />
    case 'unsaved':
    default:
      return <Point size={STATUS_ICON_SIZE} strokeWidth={ICON_STROKE} />
  }
}

export function SaveStatusIndicator() {
  const { saveStatus, autoSaveEnabled, autoSaveIntervalSec, lastSavedAt, lastRecoveryAt, saveError } = useEditorStore(
    useShallow((state) => ({
      saveStatus: state.saveStatus,
      autoSaveEnabled: state.autoSaveEnabled,
      autoSaveIntervalSec: state.autoSaveIntervalSec,
      lastSavedAt: state.lastSavedAt,
      lastRecoveryAt: state.lastRecoveryAt,
      saveError: state.saveError,
    })),
  )

  const [now, setNow] = useState(() => Date.now())
  const [isTooltipOpen, setTooltipOpen] = useState(false)
  const savingStartedAtRef = useRef<number | null>(null)

  // Tick fast while a save runs (so the 300ms reveal lands on time) and once a
  // second while the tooltip is open (so "12 seconds ago" stays true).
  useEffect(() => {
    if (saveStatus === 'saving') {
      if (savingStartedAtRef.current === null) savingStartedAtRef.current = Date.now()
      const timer = window.setInterval(() => setNow(Date.now()), 100)
      return () => window.clearInterval(timer)
    }
    savingStartedAtRef.current = null
    if (!isTooltipOpen) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [saveStatus, isTooltipOpen])

  const view = useMemo<SaveIndicatorView>(
    () =>
      selectSaveIndicator({
        saveStatus,
        savingElapsedMs: savingStartedAtRef.current === null ? 0 : now - savingStartedAtRef.current,
        autoSaveEnabled,
        autoSaveIntervalSec,
        lastSavedClock: lastSavedAt
          ? new Date(lastSavedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
          : null,
        recoveryClock: formatRelativeTime(lastRecoveryAt, now),
        saveError,
      }),
    [saveStatus, now, autoSaveEnabled, autoSaveIntervalSec, lastSavedAt, lastRecoveryAt, saveError],
  )

  // A save that finishes inside the flicker window must not repaint: hold the
  // previous line until the new state is real. The updater returns the previous
  // object when nothing visible changed, so the ticks cannot loop.
  const [displayed, setDisplayed] = useState<SaveIndicatorView>(view)
  useEffect(() => {
    if (view.holdPrevious) return
    setDisplayed((previous) =>
      previous.kind === view.kind && previous.label === view.label && previous.tooltip === view.tooltip
        ? previous
        : view,
    )
  }, [view])

  const retry = () => {
    const state = useEditorStore.getState()
    // A titled project retries the real save; an untitled one retries the
    // recovery copy, so Retry never opens a dialog on its own.
    void state.saveProject(state.currentProjectPath ? {} : { auto: true }).catch(() => undefined)
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'pointer-events-auto flex items-center gap-1.5 whitespace-nowrap text-xs',
              displayed.kind === 'error' ? 'text-danger' : 'text-muted',
            )}
            style={{ WebkitAppRegion: 'no-drag' }}
          >
            <span key={displayed.kind} className="animate-status-in inline-flex">
              <StatusIcon kind={displayed.kind} />
            </span>
            <span aria-live="polite">{displayed.label}</span>
            {displayed.kind === 'error' && (
              <button
                type="button"
                onClick={retry}
                className="pointer-events-auto underline underline-offset-2 hover:text-fg"
                style={{ WebkitAppRegion: 'no-drag' }}
              >
                Retry
              </button>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent>{displayed.tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
