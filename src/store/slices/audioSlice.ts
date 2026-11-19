import type { AudioState, AudioActions, Slice } from '../../types'
import { DEFAULTS } from '../../lib/constants'
import { createScopedLogger } from '../../lib/logger'

const logger = createScopedLogger('store:audio')

export const initialAudioState: AudioState = {
  volume: DEFAULTS.AUDIO.VOLUME.defaultValue,
  isMuted: DEFAULTS.AUDIO.MUTED.defaultValue,
  audioClips: [],
  mouseClickSoundsEnabled: true,
  mouseClickSoundPath: null,
  mouseClickSoundName: null,
  mouseClickSoundVolume: 0.8,
}

export const createAudioSlice: Slice<AudioState, AudioActions> = (set) => ({
  ...initialAudioState,
  setVolume: (volume: number) => {
    logger.debug(`setVolume: ${volume.toFixed(2)}`)
    set((state) => {
      state.volume = Math.max(0, Math.min(1, volume))
      if (state.volume > 0) state.isMuted = false
    })
  },
  toggleMute: () => {
    logger.info('toggleMute')
    set((state) => {
      state.isMuted = !state.isMuted
    })
  },
  setIsMuted: (isMuted: boolean) => {
    logger.info(`setIsMuted: ${isMuted}`)
    set((state) => {
      state.isMuted = isMuted
    })
  },
  addAudioClip: (clip) => {
    const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    logger.info(`addAudioClip: id=${id}, kind=${clip.kind ?? 'music'}, duration=${clip.duration}`)
    set((state) => {
      state.audioClips.push({ kind: 'music', speed: 1, ...clip, id })
      state.selectedRegionId = id
      state.activeSidePanelTab = 'audio'
    })
  },
  updateAudioClip: (id, updates) => {
    logger.info(`updateAudioClip: id=${id}`, updates)
    set((state) => {
      const clip = state.audioClips.find((item) => item.id === id)
      if (clip) {
        Object.assign(clip, updates)
        clip.startTime = Math.max(0, clip.startTime)
        clip.duration = Math.max(0.1, clip.duration)
        clip.sourceStart = Math.max(0, clip.sourceStart)
        clip.sourceDuration = Math.max(0.1, clip.sourceDuration)
        clip.volume = Math.max(0, Math.min(1, clip.volume))
        clip.speed = Math.max(0.5, Math.min(2, Number(clip.speed) || 1))
        clip.fadeIn = Math.max(0, Math.min(clip.duration, clip.fadeIn))
        clip.fadeOut = Math.max(0, Math.min(clip.duration, clip.fadeOut))
      }
    })
  },
  deleteAudioClip: (id) => {
    logger.info(`deleteAudioClip: id=${id}`)
    set((state) => {
      state.audioClips = state.audioClips.filter((clip) => clip.id !== id)
      if (state.selectedRegionId === id) state.selectedRegionId = null
    })
  },
  setMouseClickSoundsEnabled: (enabled) => {
    logger.info(`setMouseClickSoundsEnabled: ${enabled}`)
    set((state) => {
      state.mouseClickSoundsEnabled = enabled
    })
  },
  setMouseClickSound: (path, name) => {
    logger.info(`setMouseClickSound: name=${name}, path=${path}`)
    set((state) => {
      state.mouseClickSoundPath = path
      state.mouseClickSoundName = name
    })
  },
  setMouseClickSoundVolume: (volume) => {
    logger.debug(`setMouseClickSoundVolume: ${volume.toFixed(2)}`)
    set((state) => {
      state.mouseClickSoundVolume = Math.max(0, Math.min(1, volume))
    })
  },
})
