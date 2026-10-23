import { TIMELINE, ZOOM } from '../../lib/constants'
import { suggestSpeedRegions } from '../../../shared/auto-speed'
import type { TimelineState, TimelineActions, Slice } from '../../types'
import type { CutRegion, ZoomRegion, SpeedRegion } from '../../types'

export const initialTimelineState: TimelineState = {
  zoomRegions: {},
  cutRegions: {},
  speedRegions: {},
  videoClips: [],
  previewCutRegion: null,
  selectedRegionId: null,
  activeZoomRegionId: null,
  isCurrentlyCut: false,
  timelineZoom: 1,
}

/**
 * Recalculates and assigns z-index values to all timeline regions based on their duration.
 * Shorter regions get a higher z-index to ensure they are clickable on top of longer ones.
 * This function mutates the draft state directly within an Immer producer.
 * @param state - The current EditorState draft.
 */
const recalculateZIndices = (state: {
  zoomRegions: Record<string, ZoomRegion>
  cutRegions: Record<string, CutRegion>
  speedRegions: Record<string, SpeedRegion>
}) => {
  const allRegions = [
    ...Object.values(state.zoomRegions),
    ...Object.values(state.cutRegions),
    ...Object.values(state.speedRegions),
  ]
  allRegions.sort((a, b) => a.duration - b.duration)

  const regionCount = allRegions.length
  allRegions.forEach((region, index) => {
    const newZIndex = 10 + (regionCount - 1 - index)
    if (state.zoomRegions[region.id]) {
      state.zoomRegions[region.id].zIndex = newZIndex
    } else if (state.cutRegions[region.id]) {
      state.cutRegions[region.id].zIndex = newZIndex
    } else if (state.speedRegions[region.id]) {
      state.speedRegions[region.id].zIndex = newZIndex
    }
  })
}

export const createTimelineSlice: Slice<TimelineState, TimelineActions> = (set, get) => ({
  ...initialTimelineState,
  addZoomRegion: () => {
    const { metadata, currentTime, recordingGeometry, duration } = get()
    if (duration === 0) return

    const lastMousePos = metadata
      .slice()
      .reverse()
      .find((m) => m.timestamp <= currentTime)
    const id = `zoom-${Date.now()}`

    const newRegion: ZoomRegion = {
      id,
      type: 'zoom',
      startTime: currentTime,
      duration: ZOOM.DEFAULT_DURATION,
      zoomLevel: ZOOM.DEFAULT_LEVEL,
      easing: ZOOM.DEFAULT_EASING,
      transitionDuration: ZOOM.SPEED_OPTIONS[ZOOM.DEFAULT_SPEED as keyof typeof ZOOM.SPEED_OPTIONS],
      targetX: lastMousePos && recordingGeometry ? lastMousePos.x / recordingGeometry.width - 0.5 : 0,
      targetY: lastMousePos && recordingGeometry ? lastMousePos.y / recordingGeometry.height - 0.5 : 0,
      mode: 'auto',
      zIndex: 0,
    }

    if (newRegion.startTime + newRegion.duration > duration) {
      newRegion.duration = Math.max(TIMELINE.MINIMUM_REGION_DURATION, duration - newRegion.startTime)
    }

    set((state) => {
      state.zoomRegions[id] = newRegion
      state.selectedRegionId = id
      recalculateZIndices(state)
    })
  },
  addCutRegion: (regionData) => {
    const { currentTime, duration } = get()
    if (duration === 0) return

    const id = `cut-${Date.now()}`
    const newRegion: CutRegion = {
      id,
      type: 'cut',
      startTime: currentTime,
      duration: 2,
      zIndex: 0,
      ...regionData,
    }

    if (newRegion.startTime + newRegion.duration > duration) {
      newRegion.duration = Math.max(TIMELINE.MINIMUM_REGION_DURATION, duration - newRegion.startTime)
    }

    set((state) => {
      state.cutRegions[id] = newRegion
      state.selectedRegionId = id
      recalculateZIndices(state)
    })
  },
  addVideoClip: (clip) => {
    const id = `video-clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    set((state) => {
      // New clips land on top of the stack (highest order draws last).
      const nextOrder = state.videoClips.reduce((max, item) => Math.max(max, item.order ?? 0), -1) + 1
      state.videoClips.push({ ...clip, sourceStart: 0, order: nextOrder, id })
      state.selectedRegionId = id
    })
  },
  updateVideoClip: (id, updates) =>
    set((state) => {
      const clip = state.videoClips.find((item) => item.id === id)
      if (!clip) return
      Object.assign(clip, updates)
      clip.startTime = Math.max(0, clip.startTime)
      clip.duration = Math.max(0.1, clip.duration)
      clip.sourceStart = Math.max(0, Math.min(Math.max(0, clip.sourceDuration - 0.1), clip.sourceStart))
    }),
  deleteVideoClip: (id) =>
    set((state) => {
      state.videoClips = state.videoClips.filter((clip) => clip.id !== id)
      if (state.selectedRegionId === id) state.selectedRegionId = null
    }),
  setVideoClipOrder: (orderedIds) =>
    set((state) => {
      // Index 0 is the bottom-most layer; the last id is the topmost.
      orderedIds.forEach((id, index) => {
        const clip = state.videoClips.find((item) => item.id === id)
        if (clip) clip.order = index
      })
    }),
  addSpeedRegion: () => {
    const { currentTime, duration } = get()
    if (duration === 0) return

    const id = `speed-${Date.now()}`
    const newRegion: SpeedRegion = {
      id,
      type: 'speed',
      startTime: currentTime,
      duration: 3.0, // default duration
      speed: 1.5, // default speed
      zIndex: 0,
    }

    if (newRegion.startTime + newRegion.duration > duration) {
      newRegion.duration = Math.max(TIMELINE.MINIMUM_REGION_DURATION, duration - newRegion.startTime)
    }

    set((state) => {
      state.speedRegions[id] = newRegion
      state.selectedRegionId = id
      recalculateZIndices(state)
    })
  },
  /**
   * Find the dead stretches and add a speed region over each.
   *
   * The silences come from the recording's own audio, which is the only part of this
   * that can be known for certain: nobody is speaking, so nothing is lost by playing
   * it faster. The activity half of the detector needs a measure of how much the
   * screen is changing, which this does not have yet, so what it proposes here is the
   * conservative half.
   *
   * A stretch that already has a speed region over it is left alone: the user's own
   * region is a decision, and this is a suggestion.
   */
  tidyUp: async () => {
    const { videoPath, duration } = get()
    if (!videoPath || !(duration > 0)) return { added: 0, suggested: 0 }

    let silences: { start: number; end: number }[] = []
    try {
      const detected = await window.electronAPI.detectSilence(videoPath)
      silences = detected.map((range) => ({ start: range.start, end: range.end }))
    } catch (error) {
      // Without the audio there is nothing to be sure about, and guessing would put
      // speed changes over material the viewer was watching.
      console.warn('[TidyUp] Could not read the recording’s silences:', error)
      return { added: 0, suggested: 0 }
    }

    const suggested = suggestSpeedRegions({ silences, duration })
    const existing = Object.values(get().speedRegions)
    const additions = suggested.filter(
      (candidate) =>
        !existing.some(
          (region) =>
            candidate.startTime < region.startTime + region.duration &&
            region.startTime < candidate.startTime + candidate.duration,
        ),
    )

    if (additions.length > 0) {
      set((state) => {
        additions.forEach((region, index) => {
          const id = `speed-auto-${Date.now()}-${index}`
          state.speedRegions[id] = {
            id,
            type: 'speed',
            startTime: region.startTime,
            duration: region.duration,
            speed: region.speed,
            zIndex: 0,
          }
        })
        recalculateZIndices(state)
        state.isDirty = true
      })
    }

    return { added: additions.length, suggested: suggested.length }
  },
  updateRegion: (id, updates) => {
    set((state) => {
      const region = state.zoomRegions[id] || state.cutRegions[id] || state.speedRegions[id]
      if (region) {
        const oldDuration = region.duration
        Object.assign(region, updates)
        if (oldDuration !== region.duration) {
          recalculateZIndices(state)
        }
      }
    })
  },
  deleteRegion: (id) => {
    set((state) => {
      delete state.zoomRegions[id]
      delete state.cutRegions[id]
      delete state.speedRegions[id]
      if (state.selectedRegionId === id) {
        state.selectedRegionId = null
      }
      recalculateZIndices(state)
    })
  },
  setSelectedRegionId: (id) =>
    set((state) => {
      state.selectedRegionId = id
    }),
  setPreviewCutRegion: (region) =>
    set((state) => {
      state.previewCutRegion = region
    }),
  setTimelineZoom: (zoom) =>
    set((state) => {
      state.timelineZoom = zoom
    }),
  applyAnimationSettingsToAll: ({ transitionDuration, easing, zoomLevel }) => {
    set((state) => {
      Object.values(state.zoomRegions).forEach((region) => {
        region.transitionDuration = transitionDuration
        region.easing = easing
        region.zoomLevel = zoomLevel
      })
    })
  },
  applySpeedToAll: (speed) => {
    set((state) => {
      Object.values(state.speedRegions).forEach((region) => {
        region.speed = speed
      })
    })
  },
})
