import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VirtualStudioStreamer, type VirtualStudioIPC, type StreamerDependencies } from './virtual-studio-streamer'
import type { VirtualStudioConfig } from '../../../../shared/virtual-camera-types'
import { useEditorStore } from '../../../store/editorStore'

class MockAudioParam {
  value = 1.0
  setValueAtTime = vi.fn((val: number) => {
    this.value = val
  })
  setTargetAtTime = vi.fn((val: number) => {
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
  let mockIpc: Record<keyof VirtualStudioIPC, ReturnType<typeof vi.fn>> & VirtualStudioIPC
  let mockMediaDevices: {
    getUserMedia: ReturnType<typeof vi.fn>
  }
  let mockCanvas: HTMLCanvasElement
  let mockCtx: {
    drawImage: ReturnType<typeof vi.fn>
    fillRect: ReturnType<typeof vi.fn>
    clearRect: ReturnType<typeof vi.fn>
    getImageData: ReturnType<typeof vi.fn>
    save: ReturnType<typeof vi.fn>
    restore: ReturnType<typeof vi.fn>
    translate: ReturnType<typeof vi.fn>
    scale: ReturnType<typeof vi.fn>
    imageSmoothingEnabled: boolean
    imageSmoothingQuality: ImageSmoothingQuality
  }
  let mockVideo: {
    videoWidth: number
    videoHeight: number
    play: ReturnType<typeof vi.fn>
    pause: ReturnType<typeof vi.fn>
    srcObject: unknown
    muted: boolean
    playsInline: boolean
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] })

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
        isMirrored: false,
      }),
      installDriver: vi.fn().mockResolvedValue({ success: true }),
      start: vi.fn().mockResolvedValue({ success: true }),
      stop: vi.fn().mockResolvedValue({ success: true }),
      pushFrame: vi.fn(),
      pushAudio: vi.fn().mockResolvedValue({ success: true }),
      triggerAction: vi.fn().mockResolvedValue({ success: true }),
      updateStatus: vi.fn(),
      pushPreviewFrame: vi.fn(),
      onPreviewFrame: vi.fn(() => vi.fn()),
      showHud: vi.fn(),
      hideHud: vi.fn(),
      toggleHud: vi.fn(),
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
      getImageData: vi.fn((_x = 0, _y = 0, w = 1920, h = 1080) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      })),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
    }

    mockCanvas = {
      width: 1920,
      height: 1080,
      getContext: vi.fn(() => mockCtx),
      toDataURL: vi.fn(() => 'data:image/jpeg;base64,mockThumbnail'),
    } as unknown as HTMLCanvasElement

    mockVideo = {
      videoWidth: 1920,
      videoHeight: 1080,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      srcObject: null,
      muted: false,
      playsInline: false,
    }

    const deps: StreamerDependencies = {
      audioContext: mockContext as unknown as AudioContext,
      mediaDevices: mockMediaDevices as unknown as MediaDevices,
      ipcBridge: mockIpc,
      createCanvas: () => mockCanvas,
      createVideo: () => mockVideo as unknown as HTMLVideoElement,
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

    it('clamps and updates local audio monitoring volume locally without circular IPC echo', async () => {
      await streamer.start()

      streamer.setLocalMonitoringVolume(1.5)
      expect(streamer.getMonitoringVolume()).toBe(1.0)

      streamer.setLocalMonitoringVolume(-0.2)
      expect(streamer.getMonitoringVolume()).toBe(0.0)

      streamer.setLocalMonitoringVolume(0.7)
      expect(streamer.getMonitoringVolume()).toBe(0.7)
      // Must not dispatch updateStatus on continuous volume changes
      expect(mockIpc.updateStatus).not.toHaveBeenCalledWith(expect.objectContaining({ localMonitoringVolume: 0.7 }))
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

    it('resumes suspended audioContext when playback starts', async () => {
      mockContext.state = 'suspended'
      await streamer.start()

      streamer.setPlaying(true)
      expect(mockContext.resume).toHaveBeenCalled()
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

    it('uses 15ms exponential cross-fade transitions via setTargetAtTime to prevent audio clicks', async () => {
      await streamer.start()
      const gainResults = mockContext.createGain.mock.results
      const videoGain = (gainResults[2].value as MockGainNode).gain
      videoGain.setTargetAtTime.mockClear()

      streamer.setPlaying(true)
      expect(videoGain.setTargetAtTime).toHaveBeenCalledWith(1.0, expect.any(Number), 0.015)

      videoGain.setTargetAtTime.mockClear()
      streamer.setPlaying(false)
      expect(videoGain.setTargetAtTime).toHaveBeenCalledWith(0.0, expect.any(Number), 0.015)
    })
  })

  describe('Frame Capture and Preview Notifications', () => {
    it('captures canvas preview when activeSource is canvas and broadcasts live thumbnail to IPC', async () => {
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
      const pushCall = mockIpc.pushFrame.mock.calls[0][0]
      expect(pushCall.data.byteLength).toBe(8294400) // 1920 * 1080 * 4 bytes
      expect(mockIpc.pushPreviewFrame).toHaveBeenCalledWith('data:image/jpeg;base64,mockThumbnail')
    })

    it('captures webcam video when activeSource is webcam', async () => {
      await streamer.start()
      streamer.setPlaying(false) // activeSource = webcam
      streamer.captureTick()

      expect(mockCtx.drawImage).toHaveBeenCalled()
      expect(mockIpc.pushFrame).toHaveBeenCalled()
    })

    it('holds editor canvas frame as fallback when activeSource is webcam but physical webcam is unavailable', async () => {
      // Simulate webcam with no video stream (e.g. videoWidth = 0)
      mockVideo.videoWidth = 0
      mockVideo.videoHeight = 0
      await streamer.start()

      const testCanvas = { width: 1920, height: 1080 } as HTMLCanvasElement
      streamer.attachCanvas(testCanvas)

      streamer.setPlaying(false) // activeSource = webcam
      streamer.captureTick()

      // Should hold the last editor canvas preview frame!
      expect(mockCtx.drawImage).toHaveBeenCalledWith(testCanvas, 0, 0, 1920, 1080)
      expect(mockIpc.pushFrame).toHaveBeenCalled()
    })

    it('fills with fallback color when both webcam and source canvas are unavailable', async () => {
      mockVideo.videoWidth = 0
      mockVideo.videoHeight = 0
      await streamer.start()
      streamer.detachCanvas()

      streamer.setPlaying(false) // activeSource = webcam
      streamer.captureTick()

      expect(mockCtx.fillRect).toHaveBeenCalledWith(0, 0, 1920, 1080)
      expect(mockIpc.pushFrame).toHaveBeenCalled()
    })

    it('pushes frames unidirectionally on each captureTick without blocking or dropping frames', async () => {
      await streamer.start()
      streamer.captureTick()
      expect(mockIpc.pushFrame).toHaveBeenCalledTimes(1)

      // Subsequent tick pushes immediately without waiting or dropping
      streamer.captureTick()
      expect(mockIpc.pushFrame).toHaveBeenCalledTimes(2)

      streamer.captureTick()
      expect(mockIpc.pushFrame).toHaveBeenCalledTimes(3)
    })

    it('reuses the same pre-allocated transfer buffer across capture ticks to eliminate GC churn', async () => {
      await streamer.start()
      streamer.captureTick()
      const firstPayload = mockIpc.pushFrame.mock.calls[0][0]

      streamer.captureTick()
      const secondPayload = mockIpc.pushFrame.mock.calls[1][0]

      expect(firstPayload.data).toBe(secondPayload.data)
      expect(firstPayload.data.byteLength).toBe(1920 * 1080 * 4)
    })

    it('only generates and pushes Mini-HUD preview thumbnails when Mini-HUD is visible or has listeners', async () => {
      await streamer.start({ isMiniHudVisible: false } as unknown as Partial<VirtualStudioConfig>)
      mockIpc.pushPreviewFrame.mockClear()

      streamer.captureTick()
      expect(mockIpc.pushFrame).toHaveBeenCalled()
      expect(mockIpc.pushPreviewFrame).not.toHaveBeenCalled()

      // When Mini-HUD becomes visible
      streamer.setMiniHudVisible(true)
      // Advance by 100ms so thumbnail throttling interval passes
      vi.advanceTimersByTime(100)
      streamer.captureTick()
      expect(mockIpc.pushPreviewFrame).toHaveBeenCalled()
    })

    it('runs frame loop with drift compensation at target FPS', async () => {
      await streamer.start({ outputResolution: { width: 1280, height: 720, fps: 30 } })
      mockIpc.pushFrame.mockClear()

      // Advance by 1 second (1000ms)
      vi.advanceTimersByTime(1000)
      // Should have captured 30 frames over 1000ms
      expect(mockIpc.pushFrame.mock.calls.length).toBeGreaterThanOrEqual(29)
      expect(mockIpc.pushFrame.mock.calls.length).toBeLessThanOrEqual(31)
    })

    it('maintains steady cadence without double-firing on initial frames', async () => {
      await streamer.start({ outputResolution: { width: 1280, height: 720, fps: 30 } })
      mockIpc.pushFrame.mockClear()

      // Advance by 34ms (first frame interval: 1000/30 = 33.3ms)
      vi.advanceTimersByTime(34)
      expect(mockIpc.pushFrame).toHaveBeenCalledTimes(1)

      // Advance by another 33ms (total 67ms -> second frame should fire)
      vi.advanceTimersByTime(33)
      expect(mockIpc.pushFrame).toHaveBeenCalledTimes(2)

      // Advance by another 33ms (total 100ms -> third frame should fire)
      vi.advanceTimersByTime(33)
      expect(mockIpc.pushFrame).toHaveBeenCalledTimes(3)
    })

    it('falls back to 30 FPS when fps is zero, negative, or invalid', async () => {
      await streamer.start({ outputResolution: { width: 1280, height: 720, fps: 0 } })
      mockIpc.pushFrame.mockClear()

      vi.advanceTimersByTime(1000)
      expect(mockIpc.pushFrame.mock.calls.length).toBeGreaterThanOrEqual(29)
      expect(mockIpc.pushFrame.mock.calls.length).toBeLessThanOrEqual(31)
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

    it('applies centered aspect-fit letterboxing on sourceCanvas for non-16:9 aspect ratios', async () => {
      await streamer.start()
      const squareCanvas = { width: 1000, height: 1000 } as HTMLCanvasElement
      streamer.attachCanvas(squareCanvas)

      streamer.setPlaying(true) // activeSource = canvas
      streamer.captureTick()

      // For 1920x1080 output and 1000x1000 input: scale = 1080/1000 = 1.08 -> dw = 1080, dh = 1080, dx = (1920-1080)/2 = 420, dy = 0
      expect(mockCtx.fillRect).toHaveBeenCalledWith(0, 0, 1920, 1080)
      expect(mockCtx.drawImage).toHaveBeenCalledWith(squareCanvas, 420, 0, 1080, 1080)
    })

    it('enables high-quality image smoothing on scratchCtx for crisp HD video scaling', async () => {
      mockCtx.imageSmoothingEnabled = false
      mockCtx.imageSmoothingQuality = 'low'

      await streamer.start()
      expect(mockCtx.imageSmoothingEnabled).toBe(true)
      expect(mockCtx.imageSmoothingQuality).toBe('high')

      mockCtx.imageSmoothingEnabled = false
      mockCtx.imageSmoothingQuality = 'low'
      streamer.captureTick()
      expect(mockCtx.imageSmoothingEnabled).toBe(true)
      expect(mockCtx.imageSmoothingQuality).toBe('high')
    })

    it('downscales live preview thumbnail to 320x180 before JPEG compression for zero UI stutter', async () => {
      await streamer.start()
      mockCtx.drawImage.mockClear()

      streamer.captureTick()
      expect(mockCtx.drawImage).toHaveBeenCalledWith(mockCanvas, 0, 0, 320, 180)
      expect(mockIpc.pushPreviewFrame).toHaveBeenCalledWith('data:image/jpeg;base64,mockThumbnail')
    })
  })

  describe('Video Mirroring', () => {
    it('initializes with mirroring disabled and updates state and IPC on toggle', async () => {
      await streamer.start()
      expect(streamer.getMirrored()).toBe(false)
      expect(streamer.isMirrorEnabled()).toBe(false)

      mockIpc.updateStatus.mockClear()
      streamer.setMirrored(true)
      expect(streamer.getMirrored()).toBe(true)
      expect(streamer.isMirrorEnabled()).toBe(true)
      expect(mockIpc.updateStatus).toHaveBeenCalledWith({ isMirrored: true })

      // Redundant setMirrored is a no-op
      mockIpc.updateStatus.mockClear()
      streamer.setMirrored(true)
      expect(mockIpc.updateStatus).not.toHaveBeenCalled()

      streamer.setMirrored(false)
      expect(streamer.getMirrored()).toBe(false)
      expect(mockIpc.updateStatus).toHaveBeenCalledWith({ isMirrored: false })
    })

    it('applies horizontal flip transform in captureTick when isMirrored is true', async () => {
      await streamer.start()
      streamer.setMirrored(true)

      streamer.captureTick()
      expect(mockCtx.save).toHaveBeenCalled()
      expect(mockCtx.translate).toHaveBeenCalledWith(1920, 0)
      expect(mockCtx.scale).toHaveBeenCalledWith(-1, 1)
      expect(mockCtx.restore).toHaveBeenCalled()
    })

    it('guarantees context restore in finally block even if drawing throws during mirrored tick', async () => {
      await streamer.start()
      streamer.setMirrored(true)

      mockCtx.drawImage.mockImplementationOnce(() => {
        throw new Error('WebGL context lost')
      })

      expect(() => {
        streamer.captureTick()
      }).not.toThrow()

      expect(mockCtx.save).toHaveBeenCalled()
      expect(mockCtx.restore).toHaveBeenCalled()
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

    it('preserves attached MediaStream across stop and re-wires on start', async () => {
      const mockStream = createMockMediaStream()
      streamer.attachMediaStream(mockStream)

      await streamer.start()
      expect(mockContext.createMediaStreamSource).toHaveBeenCalledWith(mockStream)

      await streamer.stop()
      mockContext.createMediaStreamSource.mockClear()

      await streamer.start()
      expect(mockContext.createMediaStreamSource).toHaveBeenCalledWith(mockStream)
    })

    it('preserves attached video element across stop and re-wires on start', async () => {
      const mockEl = {} as HTMLVideoElement
      streamer.attachVideoElement(mockEl)

      await streamer.start()
      const firstSource = mockContext.createMediaElementSource.mock.results[0].value as MockAudioNode
      expect(firstSource.connect).toHaveBeenCalled()

      await streamer.stop()
      firstSource.connect.mockClear()

      await streamer.start()
      // Web Audio caches MediaElementSourceNode per element; verify it was reconnected to the graph
      expect(firstSource.connect).toHaveBeenCalled()
    })
  })

  describe('Dynamic Camera & Microphone Enable Toggles', () => {
    it('setEnableCamera toggles camera dynamically and updates IPC status', async () => {
      await streamer.start({ enableCamera: true, enableMic: true })
      mockIpc.updateStatus = vi.fn()

      await streamer.setEnableCamera(false)
      expect(mockIpc.updateStatus).toHaveBeenCalledWith({ isCameraActive: false })

      mockMediaDevices.getUserMedia.mockClear()
      await streamer.setEnableCamera(true)
      expect(mockMediaDevices.getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          video: expect.objectContaining({
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          }),
        }),
      )
      expect(mockIpc.updateStatus).toHaveBeenCalledWith({ isCameraActive: true })

      // Redundant call should be a no-op
      mockIpc.updateStatus.mockClear()
      await streamer.setEnableCamera(true)
      expect(mockIpc.updateStatus).not.toHaveBeenCalled()
    })

    it('setEnableMic toggles microphone dynamically and updates IPC status', async () => {
      await streamer.start({ enableCamera: true, enableMic: true })
      mockIpc.updateStatus = vi.fn()

      await streamer.setEnableMic(false)
      expect(mockIpc.updateStatus).toHaveBeenCalledWith({ isMicActive: false })

      mockMediaDevices.getUserMedia.mockClear()
      await streamer.setEnableMic(true)
      expect(mockMediaDevices.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: true }))
      expect(mockIpc.updateStatus).toHaveBeenCalledWith({ isMicActive: true })

      // Redundant call should be a no-op
      mockIpc.updateStatus.mockClear()
      await streamer.setEnableMic(true)
      expect(mockIpc.updateStatus).not.toHaveBeenCalled()
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

    it('syncWithStore subscribes to enableCamera, enableMic, and device store changes', async () => {
      await streamer.start({ enableCamera: true, enableMic: true })
      const setEnableCameraSpy = vi.spyOn(streamer, 'setEnableCamera')
      const setEnableMicSpy = vi.spyOn(streamer, 'setEnableMic')
      const setSelectedCameraSpy = vi.spyOn(streamer, 'setSelectedCamera')
      const setSelectedMicSpy = vi.spyOn(streamer, 'setSelectedMic')

      const cleanup = streamer.syncWithStore()

      useEditorStore.getState().setEnableCamera(false)
      expect(setEnableCameraSpy).toHaveBeenCalledWith(false)

      useEditorStore.getState().setEnableMic(false)
      expect(setEnableMicSpy).toHaveBeenCalledWith(false)

      useEditorStore.getState().setSelectedCameraId('external-cam-2')
      expect(setSelectedCameraSpy).toHaveBeenCalledWith('external-cam-2')

      useEditorStore.getState().setSelectedMicId('studio-mic-2')
      expect(setSelectedMicSpy).toHaveBeenCalledWith('studio-mic-2')

      cleanup()
    })

    it('syncWithStore subscribes to isMirrored store changes', async () => {
      await streamer.start()
      const setMirroredSpy = vi.spyOn(streamer, 'setMirrored')
      const cleanup = streamer.syncWithStore()

      useEditorStore.setState({ isMirrored: true } as unknown as Parameters<typeof useEditorStore.setState>[0])
      expect(setMirroredSpy).toHaveBeenCalledWith(true)

      useEditorStore.setState({ isMirrored: false } as unknown as Parameters<typeof useEditorStore.setState>[0])
      expect(setMirroredSpy).toHaveBeenCalledWith(false)

      cleanup()
    })
  })

  describe('Edge Cases & Resilient Fallbacks', () => {
    it('handles getUserMedia camera permission denial gracefully', async () => {
      mockMediaDevices.getUserMedia.mockRejectedValueOnce(new Error('NotAllowedError'))

      // Should not throw during startup
      const res = await streamer.start({ enableCamera: true, enableMic: false })
      expect(res.success).toBe(true)

      // When webcam capture fails, captureTick should fall back to solid background without crashing
      streamer.captureTick()
      expect(mockCtx.fillRect).toHaveBeenCalled()
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

    it('supports attaching and detaching multi-track mixed MediaStream for audio input', async () => {
      await streamer.start()
      const mockStream = createMockMediaStream()

      streamer.attachMediaStream(mockStream)
      expect(mockContext.createMediaStreamSource).toHaveBeenCalledWith(mockStream)

      // Detaching should disconnect cleanly
      expect(() => {
        streamer.detachMediaStream()
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

    it('handles zero or invalid canvas dimensions safely during captureTick', async () => {
      await streamer.start({ enableCamera: false, enableMic: false })
      streamer.setPlaying(true) // activeSource = 'canvas'

      const zeroCanvas = {
        width: 0,
        height: 0,
      } as unknown as HTMLCanvasElement

      streamer.attachCanvas(zeroCanvas)

      expect(() => {
        streamer.captureTick()
      }).not.toThrow()

      expect(mockCtx.fillRect).toHaveBeenCalled()
      expect(mockCtx.drawImage).not.toHaveBeenCalledWith(
        zeroCanvas,
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      )
    })

    it('catches drawImage exception on broken canvas and falls back to dark background', async () => {
      await streamer.start({ enableCamera: false, enableMic: false })
      streamer.setPlaying(true) // activeSource = 'canvas'

      const validCanvas = {
        width: 1920,
        height: 1080,
      } as unknown as HTMLCanvasElement

      streamer.attachCanvas(validCanvas)
      mockCtx.drawImage.mockImplementationOnce(() => {
        throw new Error('Canvas rendering context detached')
      })

      expect(() => {
        streamer.captureTick()
      }).not.toThrow()

      expect(mockCtx.fillRect).toHaveBeenCalled()
      expect(mockIpc.pushFrame).toHaveBeenCalled()
    })

    it('catches drawImage exception on broken webcam video and falls back gracefully', async () => {
      await streamer.start({ enableCamera: true, enableMic: false })
      streamer.setPlaying(false) // activeSource = 'webcam'

      mockCtx.drawImage.mockImplementationOnce(() => {
        throw new Error('Webcam video frame decoding error')
      })

      expect(() => {
        streamer.captureTick()
      }).not.toThrow()

      expect(mockCtx.fillRect).toHaveBeenCalled()
      expect(mockIpc.pushFrame).toHaveBeenCalled()
    })
  })
})
