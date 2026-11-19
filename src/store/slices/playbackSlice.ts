import type { PlaybackState, PlaybackActions, Slice } from '../../types'
import { createScopedLogger } from '../../lib/logger'

const logger = createScopedLogger('store:playback')

export const initialPlaybackState: PlaybackState = {
  isPlaying: false,
  currentTime: 0,
}

export const createPlaybackSlice: Slice<PlaybackState, PlaybackActions> = (set, get) => ({
  ...initialPlaybackState,
  setCurrentTime: (time) => {
    if (!get().isPlaying) {
      logger.debug(`setCurrentTime: ${time.toFixed(3)}s`)
    }
    set((state) => {
      state.currentTime = time
      const allZoomRegions = Object.values(state.zoomRegions)
      const allCutRegions = Object.values(state.cutRegions)

      const newActiveRegion = allZoomRegions.find((r) => time >= r.startTime && time < r.startTime + r.duration)
      state.activeZoomRegionId = newActiveRegion?.id ?? null

      const activeCutRegion = allCutRegions.find((r) => time >= r.startTime && time < r.startTime + r.duration)
      state.isCurrentlyCut = !!activeCutRegion
    })
  },
  togglePlay: () =>
    set((state) => {
      state.isPlaying = !state.isPlaying
      logger.info(`togglePlay -> ${state.isPlaying ? 'playing' : 'paused'}`)
    }),
  setPlaying: (isPlaying) =>
    set((state) => {
      if (state.isPlaying !== isPlaying) {
        logger.info(`setPlaying -> ${isPlaying ? 'playing' : 'paused'}`)
      }
      state.isPlaying = isPlaying
    }),
  seekToPreviousFrame: () => {
    const { isPlaying, currentTime } = get()
    if (isPlaying)
      set((state) => {
        state.isPlaying = false
      })
    const frameDuration = 1 / 30 // Assuming 30 FPS for frame-by-frame seeking
    const newTime = Math.max(0, currentTime - frameDuration)
    logger.info(`seekToPreviousFrame: ${currentTime.toFixed(3)}s -> ${newTime.toFixed(3)}s`)
    get().setCurrentTime(newTime)
  },
  seekToNextFrame: () => {
    const { isPlaying, currentTime, duration } = get()
    if (isPlaying)
      set((state) => {
        state.isPlaying = false
      })
    const frameDuration = 1 / 30 // Assuming 30 FPS
    const newTime = Math.min(duration, currentTime + frameDuration)
    logger.info(`seekToNextFrame: ${currentTime.toFixed(3)}s -> ${newTime.toFixed(3)}s`)
    get().setCurrentTime(newTime)
  },
  seekBackward: (seconds) => {
    const { isPlaying, currentTime } = get()
    if (isPlaying)
      set((state) => {
        state.isPlaying = false
      })
    const newTime = Math.max(0, currentTime - seconds)
    logger.info(`seekBackward ${seconds}s: ${currentTime.toFixed(3)}s -> ${newTime.toFixed(3)}s`)
    get().setCurrentTime(newTime)
  },
  seekForward: (seconds) => {
    const { isPlaying, currentTime, duration } = get()
    if (isPlaying)
      set((state) => {
        state.isPlaying = false
      })
    const newTime = Math.min(duration, currentTime + seconds)
    logger.info(`seekForward ${seconds}s: ${currentTime.toFixed(3)}s -> ${newTime.toFixed(3)}s`)
    get().setCurrentTime(newTime)
  },
})
