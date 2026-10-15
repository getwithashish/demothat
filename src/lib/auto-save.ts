// Pure decisions behind autosave and the header save indicator.
//
// Kept free of React and the store so the tick rule, the status derivation and
// the indicator's flicker window can be unit-tested directly.

import type { SaveStatus } from '../types'

/**
 * How long a save must run before the indicator shows "Saving…". Shorter saves
 * finish inside this window and the indicator keeps its previous state, so a
 * fast write never flashes.
 */
export const SAVING_INDICATOR_DELAY_MS = 300

export interface AutoSaveTickInput {
  autoSaveEnabled: boolean
  hasVideo: boolean
  isDirty: boolean
  inFlight: boolean
  /** True while the project file is being renamed; a tick must not write. */
  renaming?: boolean
}

/** Whether an autosave tick should write. */
export function shouldAutoSave(input: AutoSaveTickInput): boolean {
  return input.autoSaveEnabled && input.hasVideo && input.isDirty && !input.inFlight && !input.renaming
}

export interface SaveStatusSource {
  currentProjectPath: string | null
  saveStatus: SaveStatus
}

/**
 * Derives the save status from the project's own state.
 *
 * `saving` and `error` are owned by the save itself and are never overwritten
 * here — `error` stays visible until the next attempt, which is what makes the
 * retry (a tick or the Retry link) observable. Otherwise a project with no file
 * is `untitled` (even when it has edits: "Unsaved changes" would suggest a file
 * that does not exist), a file with edits is `unsaved`, and a clean file is
 * `saved`.
 */
export function deriveSaveStatus(state: SaveStatusSource, isDirty: boolean): SaveStatus {
  if (state.saveStatus === 'saving' || state.saveStatus === 'error') return state.saveStatus
  if (!state.currentProjectPath) return 'untitled'
  return isDirty ? 'unsaved' : 'saved'
}

/** The auto-save cadence in words, for the "Auto-saves within …" tooltip. */
export function formatInterval(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'a moment'
  if (seconds < 60) {
    const rounded = Math.round(seconds)
    return rounded === 1 ? '1 second' : `${rounded} seconds`
  }
  const minutes = Math.round(seconds / 60)
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}

/** "12 seconds ago" / "2 minutes ago" — used for the recovery-copy tooltip. */
export function formatRelativeTime(at: number | null, now: number): string | null {
  if (!at || !Number.isFinite(at)) return null
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds} seconds ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`
}

export interface SaveIndicatorInput {
  saveStatus: SaveStatus
  /** Milliseconds the current `saving` status has been showing. */
  savingElapsedMs: number
  autoSaveEnabled: boolean
  autoSaveIntervalSec: number
  /** Pre-formatted clock time of the last save, e.g. "3:42 PM". */
  lastSavedClock: string | null
  /** Pre-formatted age of the recovery copy, e.g. "12 seconds ago". */
  recoveryClock: string | null
  saveError: string | null
}

export interface SaveIndicatorView {
  kind: SaveStatus
  label: string
  tooltip: string
  /** True while a young save is still inside the flicker window. */
  holdPrevious: boolean
}

/** The label, tooltip and icon kind for the header's save indicator. */
export function selectSaveIndicator(input: SaveIndicatorInput): SaveIndicatorView {
  if (input.saveStatus === 'saving') {
    const tooltip = 'Saving your project…'
    if (input.savingElapsedMs < SAVING_INDICATOR_DELAY_MS) {
      // Too early to know whether this is a quick save; keep what is on screen.
      return { kind: 'saving', label: 'Saving…', tooltip, holdPrevious: true }
    }
    return { kind: 'saving', label: 'Saving…', tooltip, holdPrevious: false }
  }

  switch (input.saveStatus) {
    case 'saved':
      return {
        kind: 'saved',
        label: 'Saved',
        tooltip: input.lastSavedClock ? `Last saved at ${input.lastSavedClock}` : 'Saved',
        holdPrevious: false,
      }
    case 'error':
      return {
        kind: 'error',
        label: "Couldn't save",
        tooltip: input.saveError ?? 'The last save failed.',
        holdPrevious: false,
      }
    case 'untitled':
      return {
        kind: 'untitled',
        label: 'Not saved yet',
        tooltip: input.recoveryClock
          ? `Recovery copy saved ${input.recoveryClock}`
          : 'This project has not been saved to a file yet',
        holdPrevious: false,
      }
    case 'unsaved':
    default:
      return {
        kind: 'unsaved',
        label: 'Unsaved changes',
        tooltip: input.autoSaveEnabled
          ? `Auto-saves within ${formatInterval(input.autoSaveIntervalSec)}`
          : 'Auto-save is off. Turn it on in Settings.',
        holdPrevious: false,
      }
  }
}
