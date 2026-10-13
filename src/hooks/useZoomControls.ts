import { useCallback, useEffect, useState } from 'react'
import { useEditorStore } from '../store/editorStore'

const TIMELINE_ZOOM_MIN = 1
const TIMELINE_ZOOM_MAX = 4
const TIMELINE_ZOOM_STEP = 0.5

/**
 * Interface zoom (Electron `webContents` zoom) plus keyboard shortcuts for
 * both the interface and the timeline zoom.
 *
 *   Cmd/Ctrl + '='            interface zoom in
 *   Cmd/Ctrl + '-'            interface zoom out
 *   Cmd/Ctrl + '0'            interface zoom reset (100%)
 *   Cmd/Ctrl + Shift + '='    timeline zoom in
 *   Cmd/Ctrl + Shift + '-'    timeline zoom out
 *   Cmd/Ctrl + Shift + '0'    timeline zoom reset (1x)
 *
 * Keys are matched on `event.code`, so they behave the same on every keyboard
 * layout ('=' is `Equal` even where '+' needs Shift).
 */
export function useZoomControls() {
  const [zoomFactor, setZoomFactor] = useState(1)

  useEffect(() => {
    let cancelled = false
    window.electronAPI
      .getZoomFactor()
      .then((factor) => {
        if (!cancelled) setZoomFactor(factor)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const zoomIn = useCallback(async () => {
    setZoomFactor(await window.electronAPI.zoomIn())
  }, [])
  const zoomOut = useCallback(async () => {
    setZoomFactor(await window.electronAPI.zoomOut())
  }, [])
  const resetZoom = useCallback(async () => {
    setZoomFactor(await window.electronAPI.zoomReset())
  }, [])

  const stepTimelineZoom = useCallback((direction: 1 | -1) => {
    const { timelineZoom, setTimelineZoom } = useEditorStore.getState()
    setTimelineZoom(
      Math.max(TIMELINE_ZOOM_MIN, Math.min(TIMELINE_ZOOM_MAX, timelineZoom + direction * TIMELINE_ZOOM_STEP)),
    )
  }, [])

  const resetTimelineZoom = useCallback(() => {
    useEditorStore.getState().setTimelineZoom(TIMELINE_ZOOM_MIN)
  }, [])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return

      const { code } = event
      const zoomInCode = code === 'Equal' || code === 'NumpadAdd'
      const zoomOutCode = code === 'Minus' || code === 'NumpadSubtract'
      const resetCode = code === 'Digit0' || code === 'Numpad0'

      // Shift is the timeline-zoom modifier.
      if (event.shiftKey) {
        if (zoomInCode) {
          event.preventDefault()
          stepTimelineZoom(1)
        } else if (zoomOutCode) {
          event.preventDefault()
          stepTimelineZoom(-1)
        } else if (resetCode) {
          event.preventDefault()
          resetTimelineZoom()
        }
        return
      }

      if (zoomInCode) {
        event.preventDefault()
        void zoomIn()
      } else if (zoomOutCode) {
        event.preventDefault()
        void zoomOut()
      } else if (resetCode) {
        event.preventDefault()
        void resetZoom()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [zoomIn, zoomOut, resetZoom, stepTimelineZoom, resetTimelineZoom])

  return { zoomFactor, zoomIn, zoomOut, resetZoom, stepTimelineZoom, resetTimelineZoom }
}
