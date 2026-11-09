import { useEffect } from 'react'
import { useEditorStore } from '../../store/editorStore'
import { ZOOM, TIMELINE } from '../../lib/constants'
import type { ZoomRegion, SpeedRegion, AspectRatio, Background, CameraMoveKind } from '../../types'
import type { TranscriptDocument } from '../../../shared/transcript'
import type { SubtitleFormat } from '../../../shared/subtitles'

export function useAIToolDispatcher(): void {
  useEffect(() => {
    const unsubscribe = window.electronAPI.onAIExecuteTool(async (payload) => {
      const { id, name, args } = payload
      const store = useEditorStore.getState()

      try {
        let result: unknown = { success: true }

        switch (name) {
          case 'add_zoom_region': {
            const { metadata, currentTime, recordingGeometry, duration } = store
            const startTime = typeof args.startTime === 'number' ? args.startTime : currentTime
            const dur = typeof args.duration === 'number' ? args.duration : ZOOM.DEFAULT_DURATION

            const lastMousePos = metadata
              .slice()
              .reverse()
              .find((m) => m.timestamp <= startTime)

            const regionId = `zoom-${Date.now()}`
            const newRegion: ZoomRegion = {
              id: regionId,
              type: 'zoom',
              startTime,
              duration: dur,
              zoomLevel: typeof args.zoomLevel === 'number' ? args.zoomLevel : ZOOM.DEFAULT_LEVEL,
              easing: (args.easing as string) || ZOOM.DEFAULT_EASING,
              transitionDuration:
                typeof args.transitionDuration === 'number'
                  ? args.transitionDuration
                  : ZOOM.SPEED_OPTIONS[ZOOM.DEFAULT_SPEED as keyof typeof ZOOM.SPEED_OPTIONS],
              targetX:
                typeof args.targetX === 'number'
                  ? args.targetX
                  : lastMousePos && recordingGeometry
                    ? lastMousePos.x / recordingGeometry.width - 0.5
                    : 0,
              targetY:
                typeof args.targetY === 'number'
                  ? args.targetY
                  : lastMousePos && recordingGeometry
                    ? lastMousePos.y / recordingGeometry.height - 0.5
                    : 0,
              mode: 'auto',
              zIndex: 0,
            }

            if (newRegion.startTime + newRegion.duration > duration && duration > 0) {
              newRegion.duration = Math.max(TIMELINE.MINIMUM_REGION_DURATION, duration - newRegion.startTime)
            }

            useEditorStore.setState((state) => {
              state.zoomRegions[regionId] = newRegion
              state.selectedRegionId = regionId
              state.isDirty = true
            })
            result = { addedZoomId: regionId, startTime: newRegion.startTime, duration: newRegion.duration }
            break
          }

          case 'add_cut_region': {
            const startTime = typeof args.startTime === 'number' ? args.startTime : store.currentTime
            const duration = typeof args.duration === 'number' ? args.duration : 2
            store.addCutRegion({ startTime, duration })
            result = { addedCutAt: startTime, duration }
            break
          }

          case 'add_speed_region': {
            const startTime = typeof args.startTime === 'number' ? args.startTime : store.currentTime
            const duration = typeof args.duration === 'number' ? args.duration : 3.0
            const speed = typeof args.speed === 'number' ? args.speed : 1.5
            const regionId = `speed-${Date.now()}`

            const newRegion: SpeedRegion = {
              id: regionId,
              type: 'speed',
              startTime,
              duration,
              speed,
              zIndex: 0,
            }

            useEditorStore.setState((state) => {
              state.speedRegions[regionId] = newRegion
              state.selectedRegionId = regionId
              state.isDirty = true
            })
            result = { addedSpeedId: regionId, startTime, duration, speed }
            break
          }

          case 'update_region': {
            const { id: regionId, updates } = args as { id: string; updates: Record<string, unknown> }
            store.updateRegion(regionId, updates)
            result = { updated: regionId }
            break
          }

          case 'delete_region': {
            const regionId = String(args.id)
            store.deleteRegion(regionId)
            result = { deleted: regionId }
            break
          }

          case 'delete_selected': {
            store.deleteSelected()
            result = { deletedSelected: true }
            break
          }

          case 'set_playhead': {
            const time = Number(args.time)
            store.setCurrentTime(time)
            result = { currentTime: time }
            break
          }

          case 'run_tidy_up': {
            const tidyResult = await store.tidyUp()
            result = tidyResult
            break
          }

          case 'set_aspect_ratio': {
            const ratio = args.aspectRatio as AspectRatio
            store.setAspectRatio(ratio)
            result = { aspectRatio: ratio }
            break
          }

          case 'set_frame_style': {
            store.updateFrameStyle(args)
            result = { updatedStyles: args }
            break
          }

          case 'set_background': {
            store.updateBackground(args as unknown as Background)
            result = { background: args }
            break
          }

          case 'add_visual_effect': {
            const kind = (args.kind as 'mask' | 'blur' | 'focus' | 'border') || 'focus'
            store.addVisualEffect(kind)
            result = { addedEffect: kind }
            break
          }

          case 'delete_visual_effect': {
            store.deleteVisualEffect(String(args.id))
            result = { deletedEffect: args.id }
            break
          }

          case 'add_camera_motion': {
            store.addCameraMotion(args.kind as CameraMoveKind, Number(args.startTime), Number(args.endTime))
            result = { addedCameraMotion: args.kind }
            break
          }

          case 'delete_camera_motion': {
            store.deleteCameraMotion(String(args.id))
            result = { deletedCameraMotion: args.id }
            break
          }

          case 'set_cursor_style': {
            store.updateCursorStyle(args)
            result = { cursorStyles: args }
            break
          }

          case 'set_audio_volume': {
            store.setVolume(Number(args.volume))
            result = { volume: args.volume }
            break
          }

          case 'set_audio_muted': {
            store.setIsMuted(Boolean(args.muted))
            result = { muted: args.muted }
            break
          }

          case 'toggle_mouse_click_sounds': {
            store.setMouseClickSoundsEnabled(Boolean(args.enabled))
            if (typeof args.volume === 'number') {
              store.setMouseClickSoundVolume(args.volume)
            }
            result = { mouseClickSounds: args.enabled }
            break
          }

          case 'run_transcription': {
            const videoPath = store.videoPath
            if (!videoPath) throw new Error('No recording video path loaded.')
            const res = await window.electronAPI.startTranscription({
              sourcePath: videoPath,
              language: args.language as string | undefined,
            })
            if (res.ok && res.transcript) {
              store.setTranscript(res.transcript as unknown as TranscriptDocument)
            }
            result = res
            break
          }

          case 'set_subtitles_enabled': {
            store.setSubtitlesEnabled(Boolean(args.enabled))
            if (args.format) {
              store.setSubtitleFormat(args.format as SubtitleFormat)
            }
            result = { subtitlesEnabled: args.enabled }
            break
          }

          case 'update_subtitle_cue': {
            store.updateSubtitleCue(String(args.id), { text: String(args.text) })
            result = { updatedCue: args.id }
            break
          }

          case 'remove_subtitle_cue': {
            store.removeSubtitleCue(String(args.id))
            result = { removedCue: args.id }
            break
          }

          case 'save_project': {
            const saveRes = await store.saveProject()
            result = saveRes
            break
          }

          case 'get_video_frame_at': {
            const videoPath = store.videoPath
            const time = typeof args.time === 'number' ? args.time : store.currentTime
            if (!videoPath) throw new Error('No video loaded')
            const frameBase64 = await window.electronAPI.getVideoFrame({ videoPath, time })
            result = { frame: frameBase64 ? 'frame_captured' : 'none' }
            break
          }

          default:
            throw new Error(`Unknown tool: ${name}`)
        }

        window.electronAPI.aiToolExecutionResult({
          id,
          ok: true,
          result,
        })
      } catch (err) {
        window.electronAPI.aiToolExecutionResult({
          id,
          ok: false,
          error: (err as Error)?.message ?? String(err),
        })
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])
}
