// Answers the main process's session guard: may the current project be replaced?
//
// Only the renderer knows whether there is work to lose, and only it can collect
// a save payload; the main process owns the native dialogs and asks before
// opening another project, closing the window or quitting.

import { useEffect } from 'react'
import { useEditorStore } from '../store/editorStore'
import { whenSaveIdle } from '../lib/project-file'
import { decideSessionAction } from '../lib/session-guard'

type SessionVerdict =
  | { state: 'clean' }
  | { state: 'saved' }
  | { state: 'save-failed'; error?: string }
  | { state: 'untitled-dirty'; recoveryWritten?: boolean }

export function useSessionGuard(): void {
  useEffect(() => {
    const settle = (requestId: string, verdict: SessionVerdict) => {
      window.electronAPI.settleBeforeReplace({ requestId, verdict })
    }

    const cleanupBefore = window.electronAPI.onBeforeReplace(async ({ requestId, reason }) => {
      // A save may already be running (an autosave tick). Let it finish and
      // re-read, so a routine autosave is never mistaken for a failed one.
      await whenSaveIdle()
      const state = useEditorStore.getState()

      const action = decideSessionAction({
        isDirty: state.isDirty,
        hasProjectPath: !!state.currentProjectPath,
        reason,
      })

      if (action === 'nothing-to-do') {
        settle(requestId, { state: state.currentProjectPath ? 'saved' : 'clean' })
        return
      }

      if (action === 'save') {
        try {
          const result = await state.saveProject()
          const ok = !result.canceled && !result.recovery
          settle(requestId, ok ? { state: 'saved' } : { state: 'save-failed' })
        } catch (error) {
          settle(requestId, { state: 'save-failed', error: (error as Error)?.message })
        }
        return
      }

      // Never saved to a file. On the way out, write the recovery copy first so
      // the user's choice becomes "keep it" rather than "lose it".
      let recoveryWritten = false
      if (action === 'recovery-then-ask') {
        try {
          const result = await state.saveProject({ auto: true })
          recoveryWritten = !result.canceled && !!result.recovery
        } catch (error) {
          console.error('[SessionGuard] Could not write the recovery copy:', error)
        }
      }
      settle(requestId, { state: 'untitled-dirty', recoveryWritten })
    })

    // Main cannot save on its own: it asks, and the renderer runs the real path
    // (including the save dialog for a project that has never had a file).
    const cleanupSave = window.electronAPI.onPerformSave(async ({ requestId }) => {
      try {
        const result = await useEditorStore.getState().saveProject()
        window.electronAPI.settlePerformSave({ requestId, ok: !result.canceled && !result.recovery })
      } catch (error) {
        console.error('[SessionGuard] Save on demand failed:', error)
        window.electronAPI.settlePerformSave({ requestId, ok: false })
      }
    })

    return () => {
      cleanupBefore()
      cleanupSave()
    }
  }, [])
}
