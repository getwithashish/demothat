import { DEFAULTS } from '../../lib/constants'
import { mediaUrl } from '../../../shared/media-url'
import { createScopedLogger } from '../../lib/logger'
import type {
  WebcamState,
  WebcamActions,
  WebcamPosition,
  WebcamStyles,
  WebcamClip,
  AudioClip,
  Slice,
} from '../../types'

const logger = createScopedLogger('store:webcam')

export const initialWebcamState: WebcamState = {
  webcamVideoPath: null,
  webcamVideoUrl: null,
  isWebcamVisible: false,
  webcamPosition: { pos: 'bottom-right' },
  webcamStyles: {
    shape: 'square',
    borderRadius: 35,
    size: 30,
    shadowBlur: 20,
    shadowOffsetX: 0,
    shadowOffsetY: 10,
    shadowColor: 'rgba(0, 0, 0, 0.4)',
    isFlipped: false,
    scaleOnZoom: DEFAULTS.CAMERA.STYLE.SCALE_ON_ZOOM.defaultValue,
    smartPosition: DEFAULTS.CAMERA.SMART_POSITION.ENABLED.defaultValue,
  },
  webcamClips: [],
}

export const createWebcamSlice: Slice<WebcamState, WebcamActions> = (set, get) => ({
  ...initialWebcamState,
  setWebcamPosition: (position: WebcamPosition) => {
    set((state) => {
      state.webcamPosition = position
    })
    get()._ensureActivePresetIsWritable()
  },
  setWebcamVisibility: (isVisible: boolean) => {
    set((state) => {
      state.isWebcamVisible = isVisible
    })
    get()._ensureActivePresetIsWritable()
  },
  updateWebcamStyle: (style: Partial<WebcamStyles>) => {
    set((state) => {
      Object.assign(state.webcamStyles, style)
    })
    get()._ensureActivePresetIsWritable()
  },
  addWebcamClip: (clip) => {
    const id = `webcam-clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    logger.info(`addWebcamClip: id=${id}, name=${clip.name}, startTime=${clip.startTime}`)
    set((state) => {
      let audioClipId = clip.audioClipId ?? null
      if (clip.hasAudio && !audioClipId) {
        audioClipId = `audio-${id}`
        state.audioClips = state.audioClips || []
        state.audioClips.push({
          id: audioClipId,
          name: `${clip.name} (Audio)`,
          filePath: clip.filePath,
          startTime: Math.max(0, clip.startTime),
          duration: Math.max(0.1, clip.duration),
          sourceStart: Math.max(0, clip.sourceStart ?? 0),
          sourceDuration: Math.max(0.1, clip.sourceDuration ?? clip.duration),
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
          loop: false,
          kind: 'recording',
          speed: 1,
          videoClipId: id,
        })
      }
      const newClip: WebcamClip = {
        ...clip,
        id,
        startTime: Math.max(0, clip.startTime),
        duration: Math.max(0.1, clip.duration),
        sourceStart: Math.max(0, clip.sourceStart ?? 0),
        audioClipId,
      }
      state.webcamClips = [...(state.webcamClips || []), newClip]
      state.isWebcamVisible = true
      if (!state.webcamVideoPath) {
        state.webcamVideoPath = newClip.filePath
        state.webcamVideoUrl = mediaUrl(newClip.filePath)
      }
      const clipEnd = newClip.startTime + newClip.duration
      if (clipEnd > state.duration) {
        state.duration = clipEnd
      }
      state.selectedRegionId = id
      state.isDirty = true
      if (state.saveStatus === 'saved') {
        state.saveStatus = 'unsaved'
      }
    })
    get()._ensureActivePresetIsWritable()
    return id
  },
  updateWebcamClip: (id, updates) => {
    logger.info(`updateWebcamClip: id=${id}`, updates)
    set((state) => {
      const clip = state.webcamClips.find((c) => c.id === id)
      if (!clip) return

      // Handle linked audio synchronization
      if (clip.audioClipId) {
        const audioClip = state.audioClips?.find((a) => a.id === clip.audioClipId)
        if (audioClip) {
          if (updates.startTime !== undefined) {
            const startDelta = updates.startTime - clip.startTime
            audioClip.startTime = Math.max(0, audioClip.startTime + startDelta)
          }
          if (updates.sourceStart !== undefined) {
            const sourceDelta = updates.sourceStart - clip.sourceStart
            audioClip.sourceStart = Math.max(0, audioClip.sourceStart + sourceDelta)
          }
          if (updates.duration !== undefined) {
            audioClip.duration = Math.max(0.1, updates.duration)
          }
        }
      }

      Object.assign(clip, updates)
      clip.startTime = Math.max(0, clip.startTime)
      clip.duration = Math.max(0.1, clip.duration)
      if (typeof clip.sourceDuration === 'number' && clip.sourceDuration > 0) {
        clip.sourceStart = Math.max(0, Math.min(Math.max(0, clip.sourceDuration - 0.1), clip.sourceStart))
      } else {
        clip.sourceStart = Math.max(0, clip.sourceStart)
      }

      // Auto-expand duration if clip extends past the current timeline end
      const clipEnd = clip.startTime + clip.duration
      if (clipEnd > state.duration) {
        state.duration = clipEnd
      }
      state.isDirty = true
      if (state.saveStatus === 'saved') {
        state.saveStatus = 'unsaved'
      }
    })
    get()._ensureActivePresetIsWritable()
  },
  deleteWebcamClip: (id) => {
    logger.info(`deleteWebcamClip: id=${id}`)
    set((state) => {
      const clip = state.webcamClips.find((c) => c.id === id)
      if (clip?.audioClipId) {
        state.audioClips = state.audioClips.filter((a) => a.id !== clip.audioClipId)
      }
      state.webcamClips = state.webcamClips.filter((c) => c.id !== id)
      if (state.selectedRegionId === id) {
        state.selectedRegionId = null
      }
      if (state.webcamClips.length === 0) {
        state.webcamVideoPath = null
        state.webcamVideoUrl = null
        state.isWebcamVisible = false
      } else if (state.webcamVideoPath === clip?.filePath) {
        state.webcamVideoPath = state.webcamClips[0].filePath
        state.webcamVideoUrl = mediaUrl(state.webcamClips[0].filePath)
      }
      state.isDirty = true
      if (state.saveStatus === 'saved') {
        state.saveStatus = 'unsaved'
      }
    })
    get()._ensureActivePresetIsWritable()
  },
  splitWebcamClip: (id, splitTime) => {
    logger.info(`splitWebcamClip: id=${id}, splitTime=${splitTime}`)
    set((state) => {
      const clipIndex = state.webcamClips.findIndex((c) => c.id === id)
      if (clipIndex === -1) return
      const clip = state.webcamClips[clipIndex]
      if (splitTime <= clip.startTime || splitTime >= clip.startTime + clip.duration) return

      const firstDuration = splitTime - clip.startTime
      const secondDuration = clip.duration - firstDuration
      const secondSourceStart = clip.sourceStart + firstDuration
      clip.duration = firstDuration

      const newClipId = `webcam-clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      let newAudioClipId: string | null = null

      if (clip.audioClipId) {
        const audioClip = state.audioClips.find((a) => a.id === clip.audioClipId)
        if (audioClip) {
          audioClip.duration = firstDuration
          newAudioClipId = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          const secondAudioClip: AudioClip = {
            ...audioClip,
            id: newAudioClipId,
            startTime: splitTime,
            duration: secondDuration,
            sourceStart: audioClip.sourceStart + firstDuration,
            videoClipId: newClipId,
          }
          state.audioClips.push(secondAudioClip)
        }
      }

      const baseName = clip.name.replace(/\s*\(Part\s*\d+\)$/, '')
      const secondClip: WebcamClip = {
        id: newClipId,
        name: `${baseName} (Part 2)`,
        filePath: clip.filePath,
        startTime: splitTime,
        duration: secondDuration,
        sourceStart: secondSourceStart,
        sourceDuration: clip.sourceDuration,
        audioClipId: newAudioClipId,
        hasAudio: clip.hasAudio,
      }

      state.webcamClips.splice(clipIndex + 1, 0, secondClip)
      state.selectedRegionId = newClipId
      state.isDirty = true
      if (state.saveStatus === 'saved') {
        state.saveStatus = 'unsaved'
      }
    })
    get()._ensureActivePresetIsWritable()
  },
  replaceWebcamClipSource: (id, filePath, sourceDuration) => {
    logger.info(`replaceWebcamClipSource: id=${id}, filePath=${filePath}, sourceDuration=${sourceDuration}`)
    set((state) => {
      const clip = state.webcamClips.find((c) => c.id === id)
      if (!clip) return
      const fileName = filePath.split(/[/\\]/).pop() || 'Webcam'
      clip.filePath = filePath
      clip.name = fileName
      clip.sourceDuration = sourceDuration
      clip.sourceStart = 0
      clip.duration = Math.min(clip.duration, sourceDuration)
      if (clip.audioClipId) {
        const audioClip = state.audioClips?.find((a) => a.id === clip.audioClipId)
        if (audioClip) {
          audioClip.duration = clip.duration
        }
      }
      if (state.webcamClips[0]?.id === id || state.webcamVideoPath === clip.filePath) {
        state.webcamVideoPath = filePath
        state.webcamVideoUrl = mediaUrl(filePath)
      }
      state.isDirty = true
      if (state.saveStatus === 'saved') {
        state.saveStatus = 'unsaved'
      }
    })
    get()._ensureActivePresetIsWritable()
  },
})
