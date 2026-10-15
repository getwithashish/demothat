// Deciding whether the current editor session may be replaced — by opening
// another project, by closing the window, or by quitting the app.
//
// The renderer owns the *answer*, because only it knows whether the project is
// dirty, whether it has a file, and whether a save is even possible. The main
// process owns the *dialogs*, because only it can show native ones. Both the
// OS-initiated open path (features/project-open.ts) and the renderer-initiated
// one (project:load) call confirmReplaceSession, so there is exactly one guard.

import log from 'electron-log/main'
import { dialog } from 'electron'
import { appState } from '../state'

export type ReplaceReason = 'open' | 'close' | 'quit'

/** What the renderer reports about the session it is holding. */
export type SessionVerdict =
  | { state: 'clean' }
  | { state: 'saved' }
  | { state: 'save-failed'; error?: string }
  | { state: 'untitled-dirty'; recoveryWritten?: boolean }

interface PendingRequest {
  resolve: (value: unknown) => void
  timer: NodeJS.Timeout
}

const pending = new Map<string, PendingRequest>()
let requestCounter = 0
let quitApproved = false

/** True once the quit guard has run, so the window close does not ask twice. */
export function isQuitApproved(): boolean {
  return quitApproved
}

export function markQuitApproved(): void {
  quitApproved = true
}

/** Re-arms the guard (a fresh session can need asking again). */
export function resetQuitApproval(): void {
  quitApproved = false
}

/** Called by the IPC layer when the renderer answers a guard request. */
export function settleGuardRequest(requestId: string, payload: unknown): void {
  const request = pending.get(requestId)
  if (!request) return
  pending.delete(requestId)
  clearTimeout(request.timer)
  request.resolve(payload)
}

function askRenderer<T>(
  channel: 'project:before-replace' | 'project:perform-save',
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<T | null> {
  const win = appState.editorWin
  if (!win || win.isDestroyed()) return Promise.resolve(null)

  const requestId = `guard-${++requestCounter}`
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      log.warn(`[SessionGuard] ${channel} timed out after ${timeoutMs}ms`)
      resolve(null)
    }, timeoutMs)
    pending.set(requestId, { resolve: resolve as (value: unknown) => void, timer })
    win.webContents.send(channel, { requestId, ...payload })
  })
}

/**
 * How long the renderer's flush may take before the user is asked instead.
 *
 * Measured against the real archive writer: a 3-minute 1080p30 screen recording
 * with a webcam track (216 MB of media) saves in ~1.5s, so 10s is roughly seven
 * times the cost of a typical multi-minute project. A very long recording can
 * still exceed it; the user then gets the "couldn't save" dialog rather than a
 * silently lost session.
 */
const FLUSH_TIMEOUT_MS = 10_000

/** Returns true when the session may be replaced. */
export async function confirmReplaceSession(reason: ReplaceReason): Promise<boolean> {
  const win = appState.editorWin
  // No editor, or a dead one: nothing to lose.
  if (!win || win.isDestroyed()) return true

  let verdict = await askRenderer<SessionVerdict>('project:before-replace', { reason }, FLUSH_TIMEOUT_MS)
  if (!verdict) {
    // A renderer that cannot answer cannot save either: offer the user the choice.
    verdict = { state: 'save-failed', error: 'The save did not finish in time.' }
  }

  if (verdict.state === 'clean' || verdict.state === 'saved') return true

  if (verdict.state === 'save-failed') {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: reason === 'open' ? ['Discard changes and continue', 'Cancel'] : ['Close anyway', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: "Couldn't save your latest changes",
      message: "Couldn't save your latest changes.",
      detail: 'Continuing now will lose everything since the last successful save.',
    })
    return response === 0
  }

  // Untitled with unsaved work.
  if (reason === 'open') {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Open Without Saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Unsaved Changes',
      message: 'The current project has unsaved changes.',
      detail: 'Opening another project will discard them.',
    })
    return response === 0
  }

  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Save project…', "Don't save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'Save this project?',
    message: 'This project has never been saved to a file.',
    detail: 'A recovery copy stays available under Open recent until the next unsaved session replaces it.',
  })
  if (response === 2) return false
  if (response === 1) return true

  // "Save project…" needs the renderer: only it can collect the payload, and
  // the save dialog belongs to the same window.
  const result = await askRenderer<{ ok: boolean }>('project:perform-save', {}, FLUSH_TIMEOUT_MS)
  return !!result?.ok
}
