import { useEffect, useRef } from 'react'
import { useEditorStore } from '../store/editorStore'
import { shouldAutoSave } from '../lib/auto-save'

/**
 * Periodically saves the open project while it has unsaved changes.
 *
 * With a project path the write is a normal save (the dirty flag clears); with
 * no path it writes the crash-recovery copy so unsaved work is never lost.
 * Saves go through the same guard as manual saves, so an auto-save can never
 * overlap a Cmd/Ctrl+S, and an auto-save never opens a dialog.
 *
 * The decision itself lives in `shouldAutoSave` so it can be unit-tested.
 */
export function useAutoSave(): void {
  const intervalSec = useEditorStore((state) => state.autoSaveIntervalSec)
  const inFlightRef = useRef(false)

  useEffect(() => {
    if (!intervalSec || intervalSec <= 0) return

    const timer = window.setInterval(async () => {
      // Read live state rather than closing over render-time values.
      const state = useEditorStore.getState()
      const shouldSave = shouldAutoSave({
        autoSaveEnabled: state.autoSaveEnabled,
        hasVideo: !!state.videoPath,
        isDirty: state.isDirty,
        inFlight: inFlightRef.current,
      })
      if (!shouldSave) return

      inFlightRef.current = true
      try {
        await state.saveProject({ auto: true })
      } catch (error) {
        console.error('[AutoSave] Failed to auto-save the project:', error)
      } finally {
        inFlightRef.current = false
      }
    }, intervalSec * 1000)

    return () => window.clearInterval(timer)
  }, [intervalSec])
}
