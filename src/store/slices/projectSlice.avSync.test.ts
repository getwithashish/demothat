// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '../editorStore'
import {
  DEFAULT_AV_SYNC_OFFSET_MS,
  DEFAULT_WEBCAM_MIC_AV_SYNC_OFFSET_MS,
  MIN_AV_SYNC_OFFSET_MS,
  MAX_AV_SYNC_OFFSET_MS,
} from '../../../shared/virtual-camera-types'

const electronAPI = {
  readFile: vi.fn(() => Promise.resolve('{}')),
  getPlatform: vi.fn(() => Promise.resolve('linux')),
  getSetting: vi.fn(() => Promise.resolve(null)),
  loadCursorTheme: vi.fn(() => Promise.resolve(null)),
}

const resetStore = () => {
  useEditorStore.setState((state) => {
    Object.assign(state, {
      videoPath: null,
      metadataPath: null,
      videoUrl: null,
      webcamVideoPath: null,
      webcamVideoUrl: null,
      duration: 10,
      metadata: [],
      videoDimensions: { width: 1920, height: 1080 },
      recordingGeometry: null,
      screenSize: null,
      currentProjectPath: null,
      isDirty: false,
      audioTracks: [],
      audioTracksFromManifest: false,
      hasAudioTrack: false,
      avSyncOffsetMs: DEFAULT_AV_SYNC_OFFSET_MS,
      syncOffset: DEFAULT_AV_SYNC_OFFSET_MS,
    })
  }, true)
}

describe('A/V Lip Sync Store Integration', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { window: unknown }).window = { electronAPI }
    vi.clearAllMocks()
    resetStore()
  })

  it('automatically sets +250ms offset when both webcam and mic audio are present in recording', async () => {
    electronAPI.readFile.mockResolvedValueOnce(
      JSON.stringify({
        audioTracks: [{ index: 0, kind: 'mic', name: 'mic', codec: 'aac', channels: 1, sampleRate: 48000 }],
      }),
    )

    await useEditorStore.getState().loadProject({
      videoPath: '/tmp/screen.mp4',
      metadataPath: '/tmp/metadata.json',
      webcamVideoPath: '/tmp/webcam.mp4',
    })

    const { avSyncOffsetMs, syncOffset } = useEditorStore.getState()
    expect(avSyncOffsetMs).toBe(DEFAULT_WEBCAM_MIC_AV_SYNC_OFFSET_MS)
    expect(syncOffset).toBe(DEFAULT_WEBCAM_MIC_AV_SYNC_OFFSET_MS)
  })

  it('defaults to 0ms when recording has no webcam', async () => {
    electronAPI.readFile.mockResolvedValueOnce(
      JSON.stringify({
        audioTracks: [{ index: 0, kind: 'mic', name: 'mic', codec: 'aac', channels: 1, sampleRate: 48000 }],
      }),
    )

    await useEditorStore.getState().loadProject({
      videoPath: '/tmp/screen.mp4',
      metadataPath: '/tmp/metadata.json',
    })

    const { avSyncOffsetMs, syncOffset } = useEditorStore.getState()
    expect(avSyncOffsetMs).toBe(DEFAULT_AV_SYNC_OFFSET_MS)
    expect(syncOffset).toBe(DEFAULT_AV_SYNC_OFFSET_MS)
  })

  it('defaults to 0ms when recording has webcam but no audio track', async () => {
    electronAPI.readFile.mockResolvedValueOnce(
      JSON.stringify({
        audioTracks: [],
      }),
    )

    await useEditorStore.getState().loadProject({
      videoPath: '/tmp/screen.mp4',
      metadataPath: '/tmp/metadata.json',
      webcamVideoPath: '/tmp/webcam.mp4',
    })

    const { avSyncOffsetMs, syncOffset } = useEditorStore.getState()
    expect(avSyncOffsetMs).toBe(0)
    expect(syncOffset).toBe(0)
  })

  it('respects explicitly saved avSyncOffsetMs from metadata', async () => {
    electronAPI.readFile.mockResolvedValueOnce(
      JSON.stringify({
        audioTracks: [{ index: 0, kind: 'mic', name: 'mic', codec: 'aac', channels: 1, sampleRate: 48000 }],
        avSyncOffsetMs: 500,
      }),
    )

    await useEditorStore.getState().loadProject({
      videoPath: '/tmp/screen.mp4',
      metadataPath: '/tmp/metadata.json',
      webcamVideoPath: '/tmp/webcam.mp4',
    })

    const { avSyncOffsetMs, syncOffset } = useEditorStore.getState()
    expect(avSyncOffsetMs).toBe(500)
    expect(syncOffset).toBe(500)
  })

  it('respects explicitly saved 0ms avSyncOffsetMs without overriding to +250ms', async () => {
    electronAPI.readFile.mockResolvedValueOnce(
      JSON.stringify({
        audioTracks: [{ index: 0, kind: 'mic', name: 'mic', codec: 'aac', channels: 1, sampleRate: 48000 }],
        avSyncOffsetMs: 0,
      }),
    )

    await useEditorStore.getState().loadProject({
      videoPath: '/tmp/screen.mp4',
      metadataPath: '/tmp/metadata.json',
      webcamVideoPath: '/tmp/webcam.mp4',
    })

    const { avSyncOffsetMs, syncOffset } = useEditorStore.getState()
    expect(avSyncOffsetMs).toBe(0)
    expect(syncOffset).toBe(0)
  })

  it('falls back to non-zero syncOffset when avSyncOffsetMs is undefined', async () => {
    electronAPI.readFile.mockResolvedValueOnce(
      JSON.stringify({
        audioTracks: [{ index: 0, kind: 'mic', name: 'mic', codec: 'aac', channels: 1, sampleRate: 48000 }],
        syncOffset: 350,
      }),
    )

    await useEditorStore.getState().loadProject({
      videoPath: '/tmp/screen.mp4',
      metadataPath: '/tmp/metadata.json',
      webcamVideoPath: '/tmp/webcam.mp4',
    })

    const { avSyncOffsetMs, syncOffset } = useEditorStore.getState()
    expect(avSyncOffsetMs).toBe(350)
    expect(syncOffset).toBe(350)
  })

  it('setAvSyncOffsetMs updates state, clamps to [-2000, 3000], and marks project dirty', () => {
    useEditorStore.setState({ isDirty: false, videoPath: '/tmp/screen.mp4', isVirtualStudioActive: false })
    useEditorStore.getState().setAvSyncOffsetMs(500)

    expect(useEditorStore.getState().avSyncOffsetMs).toBe(500)
    expect(useEditorStore.getState().syncOffset).toBe(500)
    expect(useEditorStore.getState().isDirty).toBe(true)

    useEditorStore.getState().setAvSyncOffsetMs(4000)
    expect(useEditorStore.getState().avSyncOffsetMs).toBe(MAX_AV_SYNC_OFFSET_MS)

    useEditorStore.getState().setAvSyncOffsetMs(-3500)
    expect(useEditorStore.getState().avSyncOffsetMs).toBe(MIN_AV_SYNC_OFFSET_MS)
  })

  it('setAvSyncOffsetMs does NOT mark project dirty when Virtual Studio is active', () => {
    useEditorStore.setState({ isDirty: false, videoPath: '/tmp/screen.mp4', isVirtualStudioActive: true })
    useEditorStore.getState().setAvSyncOffsetMs(300)

    expect(useEditorStore.getState().avSyncOffsetMs).toBe(300)
    expect(useEditorStore.getState().syncOffset).toBe(300)
    expect(useEditorStore.getState().isDirty).toBe(false)
  })

  it('inactive Virtual Studio background status does not clobber open editor project avSyncOffsetMs', () => {
    useEditorStore.setState({
      videoPath: '/tmp/screen.mp4',
      isVirtualStudioActive: false,
      avSyncOffsetMs: DEFAULT_WEBCAM_MIC_AV_SYNC_OFFSET_MS,
      syncOffset: DEFAULT_WEBCAM_MIC_AV_SYNC_OFFSET_MS,
    })

    // Simulate background IPC status event (e.g. driver probe with default 0ms)
    useEditorStore.getState().setVirtualStudioStatus({ avSyncOffsetMs: 0, isStreaming: false })

    expect(useEditorStore.getState().avSyncOffsetMs).toBe(DEFAULT_WEBCAM_MIC_AV_SYNC_OFFSET_MS)
  })

  it('applyOpenedProject preserves avSyncOffsetMs and syncOffset', async () => {
    await useEditorStore.getState().applyOpenedProject(
      {
        videoPath: '/tmp/screen.mp4',
        metadataPath: '/tmp/metadata.json',
        avSyncOffsetMs: 750,
      },
      '/tmp/project.dthat',
    )

    const { avSyncOffsetMs, syncOffset } = useEditorStore.getState()
    expect(avSyncOffsetMs).toBe(750)
    expect(syncOffset).toBe(750)
  })
})
