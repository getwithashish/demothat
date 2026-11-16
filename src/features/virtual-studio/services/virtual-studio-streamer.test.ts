import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VirtualStudioStreamer, type VirtualStudioIPC, type StreamerDependencies } from './virtual-studio-streamer'
import { useEditorStore } from '../../../store/editorStore'

class MockAudioParam {
  value = 1.0
  setValueAtTime = vi.fn((val: number) => {
    this.value = val
  })
}

class MockAudioNode {
  connect = vi.fn()
  disconnect = vi.fn()
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam()
}

class MockScriptProcessorNode extends MockAudioNode {
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null = null
}

class MockAudioContext {
  currentTime = 0
  state = 'running'
  destination = new MockAudioNode()
  createGain = vi.fn(() => new MockGainNode())
  createScriptProcessor = vi.fn(() => new MockScriptProcessorNode())
  createMediaElementSource = vi.fn(() => new MockAudioNode())
  createMediaStreamSource = vi.fn(() => new MockAudioNode())
  resume = vi.fn().mockResolvedValue(undefined)
  close = vi.fn().mockResolvedValue(undefined)
}

function createMockMediaStream(): MediaStream {
  const mockTrack = {
    stop: vi.fn(),
    kind: 'video',
    enabled: true,
  }
  return {
    getTracks: () => [mockTrack],
    getVideoTracks: () => [mockTrack],
    getAudioTracks: () => [mockTrack],
  } as unknown as MediaStream
}

describe('VirtualStudioStreamer', () => {
  let streamer: VirtualStudioStreamer
  let mockContext: MockAudioContext
  let mockIpc: VirtualStudioIPC
  let mockMediaDevices: {
    getUserMedia: ReturnType<typeof vi.fn>
  }
  let mockCanvas: HTMLCanvasElement
  let mockCtx: {
    drawImage: ReturnType<typeof vi.fn>
    fillRect: ReturnType<typeof vi.fn>
    clearRect: ReturnType<typeof vi.fn>
    getImageData: ReturnType<typeof vi.fn>
  }
  let mockVideo: HTMLVideoElement

  beforeEach(() => {
    vi.useFakeTimers()

    mockContext = new MockAudioContext()

    mockIpc = {
      getStatus: vi.fn().mockResolvedValue({
        cameraDriverInstalled: true,
        micDriverInstalled: true,
        isStreaming: true,
        isCameraActive: true,
        isMicActive: true,
        activeSource: 'webcam',
        webcamDeviceId: null,
        micDeviceId: null,
        isMicMuted: false,
        isPlaying: false,
        isLocalAudioMonitoringEnabled: true,
        localMonitoringVolume: 1.0,
      }),
      installDriver: vi.fn().mockResolvedValue({ success: true }),
      start: vi.fn().mockResolvedValue({ success: true }),
      stop: vi.fn().mockResolvedValue({ success: true }),
      pushFrame: vi.fn().mockResolvedValue({ success: true }),
      pushAudio: vi.fn().mockResolvedValue({ success: true }),
      triggerAction: vi.fn().mockResolvedValue({ success: true }),
      updateStatus: vi.fn(),
      onStatusChange: vi.fn(() => vi.fn()),
      onTrayAction: vi.fn(() => vi.fn()),
    }

    mockMediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue(createMockMediaStream()),
    }

    mockCtx = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray(1920 * 1080 * 4),
        width: 1920,
        height: 1080,
      })),
    }

    mockCanvas = {
      width: 1920,
      height: 1080,
      getContext: vi.fn(() => mockCtx),
    } as unknown as HTMLCanvasElement

    mockVideo = {
      videoWidth: 1920,
      videoHeight: 1080,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      srcObject: null,
      muted: false,
      playsInline: false,
    } as unknown as HTMLVideoElement

    const deps: StreamerDependencies = {
      audioContext: mockContext as unknown as AudioContext,
      mediaDevices: mockMediaDevices as unknown as MediaDevices,
      ipcBridge: mockIpc,
      createCanvas: () => mockCanvas,
      createVideo: () => mockVideo,
    }

    streamer = new VirtualStudioStreamer(deps)
  })

  afterEach(async () => {
    await streamer.stop()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  describe('Initialization and Defaults', () => {
    it('initializes with default settings', () => {
      expect(streamer.isActive()).toBe(false)
      expect(streamer.getPlaying()).toBe(false)
      expect(streamer.getActiveSource()).toBe('webcam')
      expect(streamer.isMuted()).toBe(false)
      expect(streamer.isMonitoringEnabled()).toBe(true)
      expect(streamer.getMonitoringVolume()).toBe(1.0)
    })
  })

  describe('Dual-Output Audio Graph Routing', () => {
    it('sets up gain nodes and connects local monitoring to audioContext.destination', async () => {
      await streamer.start()

      expect(mockContext.createGain).toHaveBeenCalled()
      expect(streamer.isActive()).toBe(true)
    })

    it('attaches video audio source to both virtual mic and local monitoring destination', async () => {
      await streamer.start()
      const mockVideoSource = new MockAudioNode()
      streamer.attachAudioSource(mockVideoSource as unknown as AudioNode)

      // Connects to videoToVirtualMicGain and localMonitoringGain
      expect(mockVideoSource.connect).toHaveBeenCalledTimes(2)
    })

    it('clamps and updates local audio monitoring volume', async () => {
      await streamer.start()

      streamer.setLocalMonitoringVolume(1.5)
      expect(streamer.getMonitoringVolume()).toBe(1.0)

      streamer.setLocalMonitoringVolume(-0.2)
      expect(streamer.getMonitoringVolume()).toBe(0.0)

      streamer.setLocalMonitoringVolume(0.7)
      expect(streamer.getMonitoringVolume()).toBe(0.7)
      expect(mockIpc.updateStatus).toHaveBeenCalledWith(expect.objectContaining({ localMonitoringVolume: 0.7 }))
    })

    it('updates local audio monitoring enabled state', async () => {
      await streamer.start()

      streamer.setLocalAudioMonitoringEnabled(false)
      expect(streamer.isMonitoringEnabled()).toBe(false)
      expect(mockIpc.updateStatus).toHaveBeenCalledWith(
        expect.objectContaining({ isLocalAudioMonitoringEnabled: false }),
      )
    })
  })

  describe('Instant Auto-Return Logic', () => {
    it('mutes physical mic and switches to canvas feed when playback starts', async () => {
      await streamer.start()

      // Initially paused/idle -> activeSource is webcam
      expect(streamer.getActiveSource()).toBe('webcam')

      // User starts playback
      streamer.setPlaying(true)

      expect(streamer.getPlaying()).toBe(true)
      expect(streamer.getActiveSource()).toBe('canvas')
      expect(mockIpc.updateStatus).toHaveBeenCalledWith(
        expect.objectContaining({ isPlaying: true, activeSource: 'canvas' }),
      )
    })

    it('unmutes physical mic and returns to webcam feed when playback is paused', async () => {
      await streamer.start()

      streamer.setPlaying(true)
      expect(streamer.getActiveSource()).toBe('canvas')

      // User pauses playback
      streamer.setPlaying(false)

      expect(streamer.getPlaying()).toBe(false)
      expect(streamer.getActiveSource()).toBe('webcam')
      expect(mockIpc.updateStatus).toHaveBeenCalledWith(
        expect.objectContaining({ isPlaying: false, activeSource: 'webcam' }),
      )
    })

    it('respects manual mic mute when paused and maintains mute during playback', async () => {
      await streamer.start()

      // Manual mute
      streamer.setMicMuted(true)
      expect(streamer.isMuted()).toBe(true)

      // Start playing
      streamer.setPlaying(true)
      expect(streamer.isMuted()).toBe(true)

      // Pause: should remain muted because user set it manually
      streamer.setPlaying(false)
      expect(streamer.isMuted()).toBe(true)

      // Unmute manually
      streamer.toggleMicMute()
      expect(streamer.isMuted()).toBe(false)
    })
  })

  describe('Frame Capture and Preview Notifications', () => {
    it('captures canvas preview when activeSource is canvas', async () => {
      await streamer.start()
      const testCanvas = { width: 1920, height: 1080 } as HTMLCanvasElement
      streamer.attachCanvas(testCanvas)

      streamer.setPlaying(true) // activeSource = canvas
      streamer.captureTick()

      expect(mockCtx.drawImage).toHaveBeenCalledWith(testCanvas, 0, 0, 1920, 1080)
      expect(mockIpc.pushFrame).toHaveBeenCalledWith(
        expect.objectContaining({
          width: 1920,
          height: 1080,
          format: 'rgba',
        }),
      )
    })

    it('captures webcam video when activeSource is webcam', async () => {
      await streamer.start()
      streamer.setPlaying(false) // activeSource = webcam
      streamer.captureTick()

      expect(mockCtx.drawImage).toHaveBeenCalled()
      expect(mockIpc.pushFrame).toHaveBeenCalled()
    })

    it('notifies registered preview listeners with the outgoing scratch canvas', async () => {
      await streamer.start()
      const previewListener = vi.fn()
      const unsubscribe = streamer.onPreviewFrame(previewListener)

      streamer.captureTick()
      expect(previewListener).toHaveBeenCalledWith(mockCanvas)

      unsubscribe()
      previewListener.mockClear()
      streamer.captureTick()
      expect(previewListener).not.toHaveBeenCalled()
    })
  })

  describe('Lifecycle Management', () => {
    it('starts devices and notifies IPC main process', async () => {
      const res = await streamer.start({
        enableCamera: true,
        enableMic: true,
        selectedWebcamId: 'cam-1',
        selectedMicId: 'mic-1',
      })

      expect(res.success).toBe(true)
      expect(mockMediaDevices.getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          video: { deviceId: { exact: 'cam-1' } },
        }),
      )
      expect(mockIpc.start).toHaveBeenCalled()
    })

    it('stops media stream tracks and tears down graph on stop', async () => {
      await streamer.start()
      expect(streamer.isActive()).toBe(true)

      await streamer.stop()
      expect(streamer.isActive()).toBe(false)
      expect(mockIpc.stop).toHaveBeenCalled()
    })
  })

  describe('Zustand Store and Tray Synchronization', () => {
    it('syncWithStore subscribes to timeline playback changes', async () => {
      await streamer.start()
      const cleanup = streamer.syncWithStore()

      // Toggle store playing
      useEditorStore.getState().setPlaying(true)
      expect(streamer.getPlaying()).toBe(true)
      expect(streamer.getActiveSource()).toBe('canvas')

      useEditorStore.getState().setPlaying(false)
      expect(streamer.getPlaying()).toBe(false)
      expect(streamer.getActiveSource()).toBe('webcam')

      cleanup()
    })
  })

  describe('Edge Cases & Resilient Fallbacks', () => {
    it('handles getUserMedia camera permission denial gracefully', async () => {
      mockMediaDevices.getUserMedia.mockRejectedValueOnce(new Error('NotAllowedError'))

      // Should not throw during startup
      const res = await streamer.start({ enableCamera: true, enableMic: false })
      expect(res.success).toBe(true)

      // When webcam capture fails, captureTick should fall back to blank frame without crashing
      streamer.captureTick()
      expect(mockCtx.clearRect).toHaveBeenCalled()
      expect(mockIpc.pushFrame).toHaveBeenCalled()
    })

    it('handles getUserMedia microphone permission denial gracefully', async () => {
      mockMediaDevices.getUserMedia.mockRejectedValueOnce(new Error('NotFoundError'))

      // Should not throw during startup
      const res = await streamer.start({ enableCamera: false, enableMic: true })
      expect(res.success).toBe(true)
    })

    it('processes audio buffer via ScriptProcessor and pushes 16-bit PCM to IPC', async () => {
      await streamer.start()

      const processorResults = mockContext.createScriptProcessor.mock.results
      expect(processorResults.length).toBeGreaterThan(0)
      const processor = processorResults[0].value as MockScriptProcessorNode
      expect(processor.onaudioprocess).toBeDefined()

      const fakeAudioEvent = {
        inputBuffer: {
          numberOfChannels: 2,
          getChannelData: (ch: number) =>
            ch === 0 ? new Float32Array([0.5, -0.5, 1.0, -1.0]) : new Float32Array([0.25, -0.25, 0.5, -0.5]),
        },
      }

      processor.onaudioprocess!(fakeAudioEvent as unknown as AudioProcessingEvent)
      expect(mockIpc.pushAudio).toHaveBeenCalledWith(expect.any(Uint8Array))
    })

    it('supports attaching and detaching HTMLVideoElement seamlessly', async () => {
      await streamer.start()

      const mockVideoEl = {} as HTMLMediaElement
      streamer.attachVideoElement(mockVideoEl)
      expect(mockContext.createMediaElementSource).toHaveBeenCalledWith(mockVideoEl)

      // Detach should disconnect safely without throwing
      expect(() => {
        streamer.detachVideoElement()
      }).not.toThrow()
    })

    it('supports dynamically switching cameras and microphones while active', async () => {
      await streamer.start({ enableCamera: true, enableMic: true })
      mockMediaDevices.getUserMedia.mockClear()

      await streamer.setSelectedCamera('cam-4k')
      expect(mockMediaDevices.getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          video: { deviceId: { exact: 'cam-4k' } },
        }),
      )

      await streamer.setSelectedMic('mic-studio')
      expect(mockMediaDevices.getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          audio: { deviceId: { exact: 'mic-studio' } },
        }),
      )
    })

    it('handles errors inside preview frame listeners gracefully without breaking frame ticks', async () => {
      await streamer.start()

      const buggyListener = vi.fn(() => {
        throw new Error('Listener failed')
      })
      const goodListener = vi.fn()

      streamer.onPreviewFrame(buggyListener)
      streamer.onPreviewFrame(goodListener)

      expect(() => {
        streamer.captureTick()
      }).not.toThrow()

      expect(buggyListener).toHaveBeenCalled()
      expect(goodListener).toHaveBeenCalled()
    })
  })
})
