// What the renderer must do before the main process replaces its session.
//
// Pure so the guard's decision table can be tested without Electron: the hook
// (src/hooks/useSessionGuard.ts) does the saving, this says which case it is in.

export type ReplaceReason = 'open' | 'close' | 'quit'

export type SessionAction =
  /** Nothing to lose. */
  | 'nothing-to-do'
  /** A real file with unsaved edits: save it. */
  | 'save'
  /** Never saved to a file: let main ask (open discards; closing keeps a copy). */
  | 'ask-untitled'
  /** Leaving the app with unsaved work: write the recovery copy, then let main ask. */
  | 'recovery-then-ask'

export function decideSessionAction(input: {
  isDirty: boolean
  hasProjectPath: boolean
  reason: ReplaceReason
}): SessionAction {
  if (!input.isDirty) return 'nothing-to-do'
  if (input.hasProjectPath) return 'save'
  return input.reason === 'open' ? 'ask-untitled' : 'recovery-then-ask'
}
