import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { temporal } from 'zundo'
import { shallow } from 'zustand/shallow'
import { useShallow } from 'zustand/react/shallow'

import type { EditorState } from '../types'
import type { EditorActions as AllActions } from '../types'
import { createProjectSlice, initialProjectState, projectIsDirty } from './slices/projectSlice'
import { deriveSaveStatus } from '../lib/auto-save'
import { createPlaybackSlice, initialPlaybackState } from './slices/playbackSlice'
import { createFrameSlice, initialFrameState } from './slices/frameSlice'
import { createTimelineSlice, initialTimelineState } from './slices/timelineSlice'
import { createPresetSlice, initialPresetState } from './slices/presetSlice'
import { createWebcamSlice, initialWebcamState } from './slices/webcamSlice'
import { createUISlice, initialUIState } from './slices/uiSlice'
import { createAudioSlice, initialAudioState } from './slices/audioSlice'
import { createLicenseSlice, initialLicenseState } from './slices/licenseSlice'

// Combine all actions into one type for the final store
type EditorStore = EditorState & AllActions

export const useEditorStore = create(
  temporal(
    immer<EditorStore>((set, get) => ({
      // Combine initial states from all slices
      ...initialProjectState,
      ...initialPlaybackState,
      ...initialFrameState,
      ...initialTimelineState,
      ...initialPresetState,
      ...initialWebcamState,
      ...initialUIState,
      ...initialAudioState,
      ...initialLicenseState,

      // Combine actions from all slices
      ...createProjectSlice(set, get),
      ...createPlaybackSlice(set, get),
      ...createFrameSlice(set, get),
      ...createTimelineSlice(set, get),
      ...createPresetSlice(set, get),
      ...createWebcamSlice(set, get),
      ...createUISlice(set, get),
      ...createAudioSlice(set, get),
      ...createLicenseSlice(set, get),

      // Global reset action
      reset: () =>
        set((state) => {
          Object.assign(
            state,
            initialProjectState,
            initialPlaybackState,
            initialFrameState,
            initialTimelineState,
            initialAudioState,
          )
          // App-level state like presets and theme are not reset here
        }),
    })),
    {
      // Configuration for Zundo (undo/redo)
      partialize: (state) => {
        // Only include properties that should be part of the undo/redo history.
        const {
          frameStyles,
          cameraMotions,
          visualEffects,
          compositionLayouts,
          audioClips,
          mouseClickSoundsEnabled,
          mouseClickSoundPath,
          mouseClickSoundName,
          mouseClickSoundVolume,
          aspectRatio,
          zoomRegions,
          cutRegions,
          speedRegions,
          videoClips,
          presets,
          activePresetId,
          webcamPosition,
          webcamStyles,
          isWebcamVisible,
        } = state

        return {
          frameStyles,
          cameraMotions,
          visualEffects,
          compositionLayouts,
          audioClips,
          mouseClickSoundsEnabled,
          mouseClickSoundPath,
          mouseClickSoundName,
          mouseClickSoundVolume,
          aspectRatio,
          zoomRegions,
          cutRegions,
          speedRegions,
          videoClips,
          presets,
          activePresetId,
          webcamPosition,
          webcamStyles,
          isWebcamVisible,
        }
      },
      equality: shallow,
    },
  ),
)

// --- Custom Hooks for specific state parts ---

/**
 * Hook to select only playback-related state, optimized with shallow comparison.
 */
export const usePlaybackState = () =>
  useEditorStore(
    useShallow((state) => ({
      currentTime: state.currentTime,
      duration: state.duration,
      isPlaying: state.isPlaying,
      isCurrentlyCut: state.isCurrentlyCut,
    })),
  )

/**
 * Hook to select only frame style state, optimized with shallow comparison.
 */
export const useFrameStyles = () => useEditorStore(useShallow((state) => state.frameStyles))

/**
 * Hook to select all timeline regions, optimized with shallow comparison.
 */
export const useAllRegions = () =>
  useEditorStore(
    useShallow((state) => ({
      zoomRegions: state.zoomRegions,
      cutRegions: state.cutRegions,
      speedRegions: state.speedRegions,
    })),
  )

// --- Dirty tracking ---
// Keep `isDirty` in sync with the tracked fields, derive the header's save
// status from it, and mirror the dirty flag to the main process, which needs to
// know before replacing the session with a new project.
useEditorStore.subscribe((state) => {
  const dirty = projectIsDirty(state)
  const saveStatus = deriveSaveStatus(state, dirty)
  if (dirty === state.isDirty && saveStatus === state.saveStatus) return
  useEditorStore.setState({ isDirty: dirty, saveStatus })
  if (dirty !== state.isDirty && typeof window !== 'undefined' && window.electronAPI?.setProjectDirty) {
    window.electronAPI.setProjectDirty(dirty)
  }
})
