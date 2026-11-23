import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from '../editorStore'

import { markProjectClean } from './projectSlice'

type State = ReturnType<typeof useEditorStore.getState>

const clearState = () => {
  useEditorStore.setState({
    selectedRegionId: null,
    videoPath: '/recordings/one.mp4',
    duration: 10,
    videoClips: [],
    audioClips: [],
    isDirty: false,
  } as unknown as State)
  markProjectClean(useEditorStore.getState())
}

beforeEach(clearState)

describe('timelineSlice videoClips', () => {
  it('adds a video clip and auto-expands duration when clip exceeds timeline', () => {
    useEditorStore.getState().addVideoClip({
      name: 'Test Clip',
      filePath: '/path/to/test.mp4',
      startTime: 8,
      duration: 5,
      sourceDuration: 5,
      hasAudio: true,
    })

    const state = useEditorStore.getState()
    expect(state.videoClips).toHaveLength(1)
    expect(state.videoClips[0].name).toBe('Test Clip')
    expect(state.videoClips[0].startTime).toBe(8)
    expect(state.videoClips[0].duration).toBe(5)
    // 8 + 5 = 13s, so duration expanded from 10 to 13
    expect(state.duration).toBe(13)
    expect(state.selectedRegionId).toBe(state.videoClips[0].id)
    expect(state.isDirty).toBe(true)

    // Verify linked audio clip was created
    expect(state.audioClips).toHaveLength(1)
    expect(state.audioClips[0].kind).toBe('recording')
    expect(state.audioClips[0].startTime).toBe(8)
    expect(state.audioClips[0].duration).toBe(5)
    expect(state.audioClips[0].videoClipId).toBe(state.videoClips[0].id)
  })

  it('updates a video clip and auto-expands duration and moves linked audio', () => {
    useEditorStore.getState().addVideoClip({
      name: 'Clip A',
      filePath: '/path/a.mp4',
      startTime: 2,
      duration: 4,
      sourceDuration: 4,
      hasAudio: true,
    })

    const clipId = useEditorStore.getState().videoClips[0].id
    useEditorStore.getState().updateVideoClip(clipId, {
      startTime: 9,
      duration: 6,
    })

    const state = useEditorStore.getState()
    expect(state.videoClips[0].startTime).toBe(9)
    expect(state.videoClips[0].duration).toBe(6)
    // 9 + 6 = 15s > 10s
    expect(state.duration).toBe(15)

    // Linked audio clip should be updated in sync
    expect(state.audioClips[0].startTime).toBe(9)
    expect(state.audioClips[0].duration).toBe(6)
  })

  it('deletes a video clip and removes linked audio clip', () => {
    useEditorStore.getState().addVideoClip({
      name: 'Clip B',
      filePath: '/path/b.mp4',
      startTime: 1,
      duration: 3,
      sourceDuration: 3,
      hasAudio: true,
    })

    const clipId = useEditorStore.getState().videoClips[0].id
    expect(useEditorStore.getState().videoClips).toHaveLength(1)
    expect(useEditorStore.getState().audioClips).toHaveLength(1)

    useEditorStore.getState().deleteVideoClip(clipId)

    const state = useEditorStore.getState()
    expect(state.videoClips).toHaveLength(0)
    expect(state.audioClips).toHaveLength(0)
    expect(state.selectedRegionId).toBeNull()
  })
})
