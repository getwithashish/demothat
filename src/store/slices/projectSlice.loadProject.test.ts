// @vitest-environment jsdom
//
// Regression test for the blank preview after recording: the video URLs the
// project slice hands the <video> element must be percent-encoded. The
// recorded files live under the userData directory ("Application Support" on
// macOS — a space — plus whatever the user name/install path contains), and an
// unencoded URL makes the media element never load, so the canvas stays blank.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '../editorStore'

const electronAPI = {
  readFile: vi.fn(() => Promise.resolve('{}')),
  getPlatform: vi.fn(() => Promise.resolve('linux')),
}

const resetStore = () => {
  // Wipe previous state before each test so the store starts clean.
  useEditorStore.setState((state) => {
    Object.assign(state, {
      videoPath: null,
      metadataPath: null,
      videoUrl: null,
      webcamVideoPath: null,
      webcamVideoUrl: null,
      duration: 0,
      metadata: [],
      videoDimensions: { width: 0, height: 0 },
      recordingGeometry: null,
      screenSize: null,
      currentProjectPath: null,
      isDirty: false,
    })
  }, true)
}

describe('loadProject video URLs', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { window: unknown }).window = { electronAPI }
    vi.clearAllMocks()
    resetStore()
  })

  it('percent-encodes a path with a space (macOS userData dir)', async () => {
    const videoPath = '/Users/me/Library/Application Support/DemoThat/projects/p1/media/screen.mp4'
    const webcamVideoPath = '/Users/me/Library/Application Support/DemoThat/projects/p1/media/webcam.mp4'

    await useEditorStore.getState().loadProject({ videoPath, metadataPath: '/tmp/recording.json', webcamVideoPath })

    const { videoUrl, webcamVideoUrl } = useEditorStore.getState()
    expect(videoUrl).toBe('media:///Users/me/Library/Application%20Support/DemoThat/projects/p1/media/screen.mp4')
    expect(webcamVideoUrl).toBe('media:///Users/me/Library/Application%20Support/DemoThat/projects/p1/media/webcam.mp4')
  })

  it('escapes # and ? that would otherwise terminate the URL', async () => {
    const videoPath = '/tmp/rec#1/what?.mp4'
    await useEditorStore.getState().loadProject({ videoPath, metadataPath: '/tmp/recording.json' })

    const { videoUrl } = useEditorStore.getState()
    expect(videoUrl).toBe('media:///tmp/rec%231/what%3F.mp4')
  })
})
