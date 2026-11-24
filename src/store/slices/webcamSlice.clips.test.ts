import { describe, expect, it } from 'vitest'
import { createWebcamSlice } from './webcamSlice'
import { createAudioSlice } from './audioSlice'
import type { EditorState, EditorActions } from '../../types'

function createTestStore(overrides: Partial<EditorState> = {}) {
  let state = {} as EditorState & EditorActions

  const set: Parameters<typeof createWebcamSlice>[0] = (fn) => {
    fn(state)
  }
  const get: Parameters<typeof createWebcamSlice>[1] = () => state

  const webcamSlice = createWebcamSlice(set, get)
  const audioSlice = createAudioSlice(set, get)

  state = {
    duration: 10,
    selectedRegionId: null as string | null,
    isDirty: false,
    ...webcamSlice,
    ...audioSlice,
    ...overrides,
    _ensureActivePresetIsWritable: () => {},
  } as unknown as EditorState & EditorActions

  return {
    getState: () => state,
    webcam: webcamSlice,
    audio: audioSlice,
  }
}

describe('webcamSlice - clips management', () => {
  it('initializes with empty webcamClips', () => {
    const store = createTestStore()
    expect(store.getState().webcamClips).toEqual([])
  })

  it('adds a webcam clip and automatically sets isWebcamVisible and primary path', () => {
    const store = createTestStore()
    const clipId = store.webcam.addWebcamClip({
      name: 'Host Camera',
      filePath: '/path/to/host.mp4',
      startTime: 2,
      duration: 5,
      sourceStart: 0,
      sourceDuration: 10,
    })

    const state = store.getState()
    expect(state.webcamClips).toHaveLength(1)
    expect(state.webcamClips[0].id).toBe(clipId)
    expect(state.webcamClips[0].name).toBe('Host Camera')
    expect(state.isWebcamVisible).toBe(true)
    expect(state.webcamVideoPath).toBe('/path/to/host.mp4')
    expect(state.selectedRegionId).toBe(clipId)
    expect(state.isDirty).toBe(true)
  })

  it('marks isDirty and changes saveStatus to unsaved across all operations', () => {
    const store = createTestStore({ saveStatus: 'saved', isDirty: false })
    const clipId = store.webcam.addWebcamClip({
      name: 'Camera 1',
      filePath: '/path/to/cam.mp4',
      startTime: 0,
      duration: 5,
      sourceStart: 0,
      sourceDuration: 10,
    })
    expect(store.getState().isDirty).toBe(true)
    expect(store.getState().saveStatus).toBe('unsaved')

    store.getState().isDirty = false
    store.getState().saveStatus = 'saved'
    store.webcam.updateWebcamClip(clipId, { duration: 4 })
    expect(store.getState().isDirty).toBe(true)
    expect(store.getState().saveStatus).toBe('unsaved')

    store.getState().isDirty = false
    store.getState().saveStatus = 'saved'
    store.webcam.splitWebcamClip(clipId, 2)
    expect(store.getState().isDirty).toBe(true)
    expect(store.getState().saveStatus).toBe('unsaved')

    store.getState().isDirty = false
    store.getState().saveStatus = 'saved'
    store.webcam.deleteWebcamClip(clipId)
    expect(store.getState().isDirty).toBe(true)
    expect(store.getState().saveStatus).toBe('unsaved')
  })

  it('automatically creates a linked AudioClip when adding a webcam clip with hasAudio', () => {
    const store = createTestStore({ audioClips: [] })
    const clipId = store.webcam.addWebcamClip({
      name: 'Webcam with Mic',
      filePath: '/path/to/webcam-mic.mp4',
      startTime: 1,
      duration: 4,
      sourceStart: 0,
      sourceDuration: 10,
      hasAudio: true,
    })

    const state = store.getState()
    const clip = state.webcamClips.find((c) => c.id === clipId)
    expect(clip?.audioClipId).toBeTruthy()
    const linkedAudio = state.audioClips.find((a) => a.id === clip?.audioClipId)
    expect(linkedAudio).toBeDefined()
    expect(linkedAudio?.name).toBe('Webcam with Mic (Audio)')
    expect(linkedAudio?.startTime).toBe(1)
    expect(linkedAudio?.duration).toBe(4)
    expect(linkedAudio?.videoClipId).toBe(clipId)
  })

  it('clamps sourceStart within [0, sourceDuration - 0.1] in updateWebcamClip', () => {
    const store = createTestStore()
    const clipId = store.webcam.addWebcamClip({
      name: 'Clip',
      filePath: '/path/to/clip.mp4',
      startTime: 0,
      duration: 5,
      sourceStart: 0,
      sourceDuration: 10,
    })

    // Negative sourceStart clamped to 0
    store.webcam.updateWebcamClip(clipId, { sourceStart: -5 })
    expect(store.getState().webcamClips[0].sourceStart).toBe(0)

    // Over-boundary sourceStart clamped to sourceDuration - 0.1
    store.webcam.updateWebcamClip(clipId, { sourceStart: 15 })
    expect(store.getState().webcamClips[0].sourceStart).toBe(9.9)
  })

  it('updates webcamVideoPath to next clip when deleting the active clip, and resets visibility when all deleted', () => {
    const store = createTestStore()
    const clip1 = store.webcam.addWebcamClip({
      name: 'Cam 1',
      filePath: '/path/to/cam1.mp4',
      startTime: 0,
      duration: 5,
      sourceStart: 0,
      sourceDuration: 10,
    })
    const clip2 = store.webcam.addWebcamClip({
      name: 'Cam 2',
      filePath: '/path/to/cam2.mp4',
      startTime: 5,
      duration: 5,
      sourceStart: 0,
      sourceDuration: 10,
    })

    expect(store.getState().webcamVideoPath).toBe('/path/to/cam1.mp4')
    expect(store.getState().isWebcamVisible).toBe(true)

    // Delete first clip: webcamVideoPath should update to remaining clip
    store.webcam.deleteWebcamClip(clip1)
    expect(store.getState().webcamClips).toHaveLength(1)
    expect(store.getState().webcamVideoPath).toBe('/path/to/cam2.mp4')
    expect(store.getState().isWebcamVisible).toBe(true)

    // Delete last clip: visibility and path reset to null/false
    store.webcam.deleteWebcamClip(clip2)
    expect(store.getState().webcamClips).toHaveLength(0)
    expect(store.getState().webcamVideoPath).toBeNull()
    expect(store.getState().webcamVideoUrl).toBeNull()
    expect(store.getState().isWebcamVisible).toBe(false)
  })

  it('auto-expands timeline duration when webcam clip extends past current duration', () => {
    const store = createTestStore({ duration: 5 })
    store.webcam.addWebcamClip({
      name: 'Outro Camera',
      filePath: '/path/to/outro.mp4',
      startTime: 3,
      duration: 7, // 3 + 7 = 10s > 5s
      sourceStart: 0,
      sourceDuration: 10,
    })

    expect(store.getState().duration).toBe(10)
  })

  it('updates webcam clip and synchronizes linked audio in lockstep', () => {
    const store = createTestStore({
      audioClips: [
        {
          id: 'audio-mic-1',
          name: 'Microphone',
          filePath: '/path/to/mic.wav',
          startTime: 2,
          duration: 5,
          sourceStart: 0,
          sourceDuration: 10,
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
          loop: false,
        },
      ],
    })

    const clipId = store.webcam.addWebcamClip({
      name: 'Webcam',
      filePath: '/path/to/cam.mp4',
      startTime: 2,
      duration: 5,
      sourceStart: 0,
      sourceDuration: 10,
      audioClipId: 'audio-mic-1',
    })

    // Retime webcam clip by +3 seconds (from 2s to 5s)
    store.webcam.updateWebcamClip(clipId, { startTime: 5 })

    const state = store.getState()
    const updatedWebcam = state.webcamClips.find((c) => c.id === clipId)
    const updatedAudio = state.audioClips.find((a) => a.id === 'audio-mic-1')

    expect(updatedWebcam?.startTime).toBe(5)
    // Linked audio must have moved by the exact same delta (+3s)
    expect(updatedAudio?.startTime).toBe(5)
  })

  it('splits a webcam clip and splits linked microphone audio symmetrically', () => {
    const store = createTestStore({
      audioClips: [
        {
          id: 'audio-mic-1',
          name: 'Microphone',
          filePath: '/path/to/mic.wav',
          startTime: 0,
          duration: 10,
          sourceStart: 0,
          sourceDuration: 10,
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
          loop: false,
        },
      ],
    })

    const clipId = store.webcam.addWebcamClip({
      name: 'Webcam 1',
      filePath: '/path/to/cam.mp4',
      startTime: 0,
      duration: 10,
      sourceStart: 0,
      sourceDuration: 10,
      audioClipId: 'audio-mic-1',
    })

    // Split at 4.0s
    store.webcam.splitWebcamClip(clipId, 4.0)

    const state = store.getState()
    expect(state.webcamClips).toHaveLength(2)

    const first = state.webcamClips[0]
    const second = state.webcamClips[1]

    expect(first.startTime).toBe(0)
    expect(first.duration).toBe(4.0)
    expect(first.sourceStart).toBe(0)

    expect(second.startTime).toBe(4.0)
    expect(second.duration).toBe(6.0)
    expect(second.sourceStart).toBe(4.0)
    expect(second.sourceDuration).toBe(10)

    // Linked audio must also be split symmetrically into two contiguous audio clips
    expect(state.audioClips).toHaveLength(2)
    const firstAudio = state.audioClips[0]
    const secondAudio = state.audioClips[1]

    expect(firstAudio.startTime).toBe(0)
    expect(firstAudio.duration).toBe(4.0)

    expect(secondAudio.startTime).toBe(4.0)
    expect(secondAudio.duration).toBe(6.0)
    expect(secondAudio.sourceStart).toBe(4.0)
    expect(second.audioClipId).toBe(secondAudio.id)
  })

  it('deletes a webcam clip and cleans up linked audio', () => {
    const store = createTestStore({
      audioClips: [
        {
          id: 'audio-mic-1',
          name: 'Microphone',
          filePath: '/path/to/mic.wav',
          startTime: 0,
          duration: 10,
          sourceStart: 0,
          sourceDuration: 10,
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
          loop: false,
        },
      ],
    })

    const clipId = store.webcam.addWebcamClip({
      name: 'Webcam',
      filePath: '/path/to/cam.mp4',
      startTime: 0,
      duration: 10,
      sourceStart: 0,
      sourceDuration: 10,
      audioClipId: 'audio-mic-1',
    })

    expect(store.getState().webcamClips).toHaveLength(1)
    expect(store.getState().audioClips).toHaveLength(1)

    store.webcam.deleteWebcamClip(clipId)

    expect(store.getState().webcamClips).toHaveLength(0)
    expect(store.getState().audioClips).toHaveLength(0)
    expect(store.getState().webcamVideoPath).toBeNull()
  })

  it('replaces webcam clip source file and updates metadata', () => {
    const store = createTestStore()
    const clipId = store.webcam.addWebcamClip({
      name: 'Webcam A',
      filePath: '/path/to/cam-a.mp4',
      startTime: 0,
      duration: 10,
      sourceStart: 0,
      sourceDuration: 10,
    })

    store.webcam.replaceWebcamClipSource(clipId, '/path/to/cam-b-replacement.mp4', 8)

    const updated = store.getState().webcamClips.find((c) => c.id === clipId)
    expect(updated?.filePath).toBe('/path/to/cam-b-replacement.mp4')
    expect(updated?.name).toBe('cam-b-replacement.mp4')
    expect(updated?.sourceDuration).toBe(8)
    expect(updated?.duration).toBe(8) // Clamped to source duration
    expect(store.getState().webcamVideoPath).toBe('/path/to/cam-b-replacement.mp4')
  })
})
