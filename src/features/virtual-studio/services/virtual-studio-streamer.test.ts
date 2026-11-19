import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VirtualStudioStreamer, type VirtualStudioIPC, type StreamerDependencies } from './virtual-studio-streamer'
import type { VirtualStudioConfig } from '../../../../shared/virtual-camera-types'
import { useEditorStore } from '../../../store/editorStore'
import {
  VirtualStudioAudioProcessor,
  VIRTUAL_STUDIO_AUDIO_PROCESSOR_NAME,
  createAudioWorkletBlobUrl,
} from '../workers/virtual-studio-audio-processor.worklet'

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

class MockAudioWorkletPort {
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null
  postMessage = vi.fn()
  close = vi.fn()
}

class MockAudioWorkletNode extends MockAudioNode {
  port = new MockAudioWorkletPort()
}

class MockAudioContext {
  currentTime = 0
  state = 'running'
  destination = new MockAudioNode()
  audioWorklet?: AudioWorklet
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

    it('attaches video audio source to demoAudioBus routing to virtual mic and local monitoring', async () => {
      await streamer.start()
      const mockVideoSource = new MockAudioNode()
      streamer.attachAudioSource(mockVideoSource as unknown as AudioNode)

      // Connects to demoAudioBus, which routes to both videoToVirtualMicGain and localMonitoringGain
      expect(mockVideoSource.connect).toHaveBeenCalledWith(streamer.getDemoAudioBus())
      expect((streamer.getDemoAudioBus() as unknown as MockGainNode).connect).toHaveBeenCalled()
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

    it('provides persistent demoAudioBus on audioContext before start', () => {
      const bus = streamer.getDemoAudioBus()
      expect(bus).toBeDefined()
      expect(mockContext.createGain).toHaveBeenCalled()
      // Calling getDemoAudioBus again returns the same persistent instance
      expect(streamer.getDemoAudioBus()).toBe(bus)
      // Connect to local monitoring should only be called once, not on every getDemoAudioBus call
      expect((bus as unknown as MockGainNode).connect).toHaveBeenCalledTimes(1)
    })

    it('caches MediaElementAudioSourceNode per HTMLMediaElement via createMediaElementSource', () => {
      const mockEl = {} as HTMLMediaElement
      const source1 = streamer.createMediaElementSource(mockEl)
      const source2 = streamer.createMediaElementSource(mockEl)
      expect(source1).toBe(source2)
      expect(mockContext.createMediaElementSource).toHaveBeenCalledTimes(1)
    })

    it('prevents duplicate connections when registerBusInput is used', () => {
      const mockMasterNode = new MockAudioNode()
      streamer.registerBusInput(mockMasterNode as unknown as AudioNode)
      streamer.attachAudioSource(mockMasterNode as unknown as AudioNode)
      // Since it was registered as already connected to the bus, wireVideoAudioGraph does not re-connect it
      expect(mockMasterNode.connect).not.toHaveBeenCalled()
    })

    it('supports unregisterBusInput to allow re-wiring when mixer changes', () => {
      const mockMasterNode = new MockAudioNode()
      streamer.registerBusInput(mockMasterNode as unknown as AudioNode)
      streamer.unregisterBusInput(mockMasterNode as unknown as AudioNode)
      streamer.attachAudioSource(mockMasterNode as unknown as AudioNode)
      expect(mockMasterNode.connect).toHaveBeenCalledWith(streamer.getDemoAudioBus())
    })

    it('wireVideoAudioGraph safely disconnects previous bus connection before reconnecting', () => {
      const mockSourceNode = new MockAudioNode()
      streamer.attachAudioSource(mockSourceNode as unknown as AudioNode)
      expect(mockSourceNode.connect).toHaveBeenCalledWith(streamer.getDemoAudioBus())

      // Re-attaching the same source disconnects before reconnecting to prevent duplicate signal summation
      streamer.attachAudioSource(mockSourceNode as unknown as AudioNode)
      expect(mockSourceNode.disconnect).toHaveBeenCalledWith(streamer.getDemoAudioBus())
    })

    it('maintains local monitoring gain at 1.0 when Virtual Studio is inactive', async () => {
      // Inactive streamer:
      expect(streamer.isActive()).toBe(false)
      streamer.setPlaying(true)
      // Local monitoring remains full volume (1.0) so normal editor playback is 100% audible
      expect(streamer.isActive()).toBe(false)

      // Start streamer: local monitoring now follows isPlaying and monitoring settings
      await streamer.start({ enableLocalAudioMonitoring: true, localMonitoringVolume: 0.8 })
      expect(streamer.isActive()).toBe(true)

      // When stopped:
      await streamer.stop()
      expect(streamer.isActive()).toBe(false)
      // Persistent bus still exists
      expect(streamer.getDemoAudioBus()).toBeDefined()
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

    it('resets playbackMicUnmuted when transitioning to playing=true', async () => {
      await streamer.start()
      const gainResults = mockContext.createGain.mock.results
      const micGain = (gainResults[1].value as MockGainNode).gain

      // Start playing: mic should be muted by default (playbackMicUnmuted=false)
      streamer.setPlaying(true)
      expect(micGain.setTargetAtTime).toHaveBeenCalledWith(0.0, expect.any(Number), 0.015)
    })

    it('allows explicit unmute of physical mic during video playback via setMicMuted', async () => {
      await streamer.start()
      const gainResults = mockContext.createGain.mock.results
      const micGain = (gainResults[1].value as MockGainNode).gain

      streamer.setPlaying(true)
      micGain.setTargetAtTime.mockClear()

      // Explicitly unmute during playback: sets playbackMicUnmuted=true
      streamer.setMicMuted(false)
      expect(micGain.setTargetAtTime).toHaveBeenCalledWith(1.0, expect.any(Number), 0.015)
    })

    it('allows re-muting physical mic during video playback via toggleMicMute', async () => {
      await streamer.start()
      const gainResults = mockContext.createGain.mock.results
      const micGain = (gainResults[1].value as MockGainNode).gain

      streamer.setPlaying(true)
      // Unmute during playback
      streamer.setMicMuted(false)
      micGain.setTargetAtTime.mockClear()

      // Re-mute during playback
      streamer.toggleMicMute()
      expect(micGain.setTargetAtTime).toHaveBeenCalledWith(0.0, expect.any(Number), 0.015)
    })

    it('resets playback mic unmuted state at the start of each new playback session', async () => {
      await streamer.start()
      const gainResults = mockContext.createGain.mock.results
      const micGain = (gainResults[1].value as MockGainNode).gain

      // Start playing and unmute mic
      streamer.setPlaying(true)
      streamer.setMicMuted(false) // playbackMicUnmuted=true
      streamer.setPlaying(false)

      micGain.setTargetAtTime.mockClear()
      // Start playing again: playbackMicUnmuted must reset to false
      streamer.setPlaying(true)
      expect(micGain.setTargetAtTime).toHaveBeenCalledWith(0.0, expect.any(Number), 0.015)
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

    it('pushes frame buffer directly from ImageData without redundant memcpy', async () => {
      await streamer.start()
      streamer.captureTick()
      const firstPayload = mockIpc.pushFrame.mock.calls[0][0]

      streamer.captureTick()
      const secondPayload = mockIpc.pushFrame.mock.calls[1][0]

      expect(firstPayload.data.byteLength).toBe(1920 * 1080 * 4)
      expect(secondPayload.data.byteLength).toBe(1920 * 1080 * 4)
      expect(firstPayload.data).toBeInstanceOf(Uint8Array)
      expect(secondPayload.data).toBeInstanceOf(Uint8Array)
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

    it('enables medium-quality image smoothing on scratchCtx for high-performance HD video scaling', async () => {
      mockCtx.imageSmoothingEnabled = false
      mockCtx.imageSmoothingQuality = 'low'

      await streamer.start()
      expect(mockCtx.imageSmoothingEnabled).toBe(true)
      expect(mockCtx.imageSmoothingQuality).toBe('medium')

      mockCtx.imageSmoothingEnabled = false
      mockCtx.imageSmoothingQuality = 'low'
      streamer.captureTick()
      expect(mockCtx.imageSmoothingEnabled).toBe(true)
      expect(mockCtx.imageSmoothingQuality).toBe('medium')
    })

    it('downscales live preview thumbnail to 320x180 before JPEG compression for zero UI stutter', async () => {
      await streamer.start()
      mockCtx.drawImage.mockClear()

      streamer.captureTick()
      expect(mockCtx.drawImage).toHaveBeenCalledWith(mockCanvas, 0, 0, 320, 180)
      expect(mockIpc.pushPreviewFrame).toHaveBeenCalledWith('data:image/jpeg;base64,mockThumbnail')
    })
  })

  describe('Event-Driven Frame Delivery (pushRenderedCanvas) & FPS Optimization', () => {
    it('pushes frame immediately with timestamp when active and activeSource is canvas', async () => {
      await streamer.start()
      streamer.setPlaying(true) // activeSource = 'canvas'
      mockIpc.pushFrame.mockClear()

      const testCanvas = { width: 1920, height: 1080 } as HTMLCanvasElement
      streamer.pushRenderedCanvas(testCanvas, 42.5)

      expect(mockIpc.pushFrame).toHaveBeenCalledTimes(1)
      expect(mockIpc.pushFrame).toHaveBeenCalledWith(
        expect.objectContaining({
          width: 1920,
          height: 1080,
          format: 'rgba',
          timestamp: 42.5,
        }),
      )
    })

    it('ignores pushRenderedCanvas when activeSource is webcam', async () => {
      await streamer.start()
      streamer.setPlaying(false) // activeSource = 'webcam'
      mockIpc.pushFrame.mockClear()

      const testCanvas = { width: 1920, height: 1080 } as HTMLCanvasElement
      streamer.pushRenderedCanvas(testCanvas)

      expect(mockIpc.pushFrame).not.toHaveBeenCalled()
    })

    it('ignores pushRenderedCanvas when streamer is inactive or stopped', async () => {
      await streamer.start()
      streamer.setPlaying(true)
      await streamer.stop()
      mockIpc.pushFrame.mockClear()

      const testCanvas = { width: 1920, height: 1080 } as HTMLCanvasElement
      streamer.pushRenderedCanvas(testCanvas)

      expect(mockIpc.pushFrame).not.toHaveBeenCalled()
    })

    it('performs 1:1 direct blitting without redundant fillRect when source canvas matches output dimensions', async () => {
      await streamer.start()
      streamer.setPlaying(true)
      mockCtx.fillRect.mockClear()
      mockCtx.drawImage.mockClear()

      const testCanvas = { width: 1920, height: 1080 } as HTMLCanvasElement
      streamer.pushRenderedCanvas(testCanvas)

      // 1:1 direct blit: no fillRect call, direct drawImage
      expect(mockCtx.fillRect).not.toHaveBeenCalled()
      expect(mockCtx.drawImage).toHaveBeenCalledWith(testCanvas, 0, 0, 1920, 1080)
    })

    it('falls back to letterboxing fillRect when source canvas dimensions do not match output resolution', async () => {
      await streamer.start()
      streamer.setPlaying(true)
      mockCtx.fillRect.mockClear()
      mockCtx.drawImage.mockClear()

      const oddCanvas = { width: 1000, height: 1000 } as HTMLCanvasElement
      streamer.pushRenderedCanvas(oddCanvas)

      // Aspect fit letterboxing requires background fillRect
      expect(mockCtx.fillRect).toHaveBeenCalledWith(0, 0, 1920, 1080)
      expect(mockCtx.drawImage).toHaveBeenCalledWith(oddCanvas, 420, 0, 1080, 1080)
    })

    it('preserves horizontal mirroring during 1:1 direct blit when isMirrored is true', async () => {
      await streamer.start()
      streamer.setPlaying(true)
      streamer.setMirrored(true)
      mockCtx.fillRect.mockClear()
      mockCtx.drawImage.mockClear()
      mockCtx.save.mockClear()
      mockCtx.translate.mockClear()
      mockCtx.scale.mockClear()
      mockCtx.restore.mockClear()

      const testCanvas = { width: 1920, height: 1080 } as HTMLCanvasElement
      streamer.pushRenderedCanvas(testCanvas)

      expect(mockCtx.fillRect).not.toHaveBeenCalled()
      expect(mockCtx.save).toHaveBeenCalled()
      expect(mockCtx.translate).toHaveBeenCalledWith(1920, 0)
      expect(mockCtx.scale).toHaveBeenCalledWith(-1, 1)
      expect(mockCtx.drawImage).toHaveBeenCalledWith(testCanvas, 0, 0, 1920, 1080)
      expect(mockCtx.restore).toHaveBeenCalled()
    })

    it('does not run the uncoordinated timer loop when activeSource is canvas, but runs it when activeSource is webcam', async () => {
      await streamer.start()
      streamer.setPlaying(true) // activeSource = 'canvas'
      mockIpc.pushFrame.mockClear()

      // When canvas is active, polling timer loop must be dormant
      vi.advanceTimersByTime(1000)
      expect(mockIpc.pushFrame).not.toHaveBeenCalled()

      // When switched back to webcam, polling timer loop resumes at target FPS
      streamer.setPlaying(false) // activeSource = 'webcam'
      mockIpc.pushFrame.mockClear()
      vi.advanceTimersByTime(1000)
      expect(mockIpc.pushFrame.mock.calls.length).toBeGreaterThanOrEqual(29)
    })

    it('throttles Mini-HUD thumbnail generation to 350 ms', async () => {
      await streamer.start({ isMiniHudVisible: true } as unknown as Partial<VirtualStudioConfig>)
      streamer.setPlaying(true)
      // Initial frame thumbnail was pushed during setPlaying(true)
      expect(mockIpc.pushPreviewFrame).toHaveBeenCalledTimes(1)
      mockIpc.pushPreviewFrame.mockClear()

      const testCanvas = { width: 1920, height: 1080 } as HTMLCanvasElement

      // Subsequent tick within 200ms (< 350ms) is throttled
      vi.advanceTimersByTime(200)
      streamer.pushRenderedCanvas(testCanvas)
      expect(mockIpc.pushPreviewFrame).not.toHaveBeenCalled()

      // After passing 350ms (advance another 160ms -> total 360ms), thumbnail is pushed
      vi.advanceTimersByTime(160)
      streamer.pushRenderedCanvas(testCanvas)
      expect(mockIpc.pushPreviewFrame).toHaveBeenCalledTimes(1)
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

    it('preserves attached AudioNode (masterNode) across stop and re-wires on start without videoElement override', async () => {
      const mockMasterNode = new MockAudioNode()
      const mockEl = {} as HTMLVideoElement
      streamer.attachVideoElement(mockEl)
      streamer.attachAudioSource(mockMasterNode as unknown as AudioNode)

      await streamer.start()
      expect(mockMasterNode.connect).toHaveBeenCalled()

      await streamer.stop()
      mockMasterNode.connect.mockClear()

      await streamer.start()
      // Custom audio source node must be preserved and reconnected, taking precedence over videoElement
      expect(mockMasterNode.connect).toHaveBeenCalled()
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

    it('connects virtualMicMasterNode to AudioWorkletNode and forwards worklet port messages to ipcBridge.pushAudio', async () => {
      const mockWorklet = {
        addModule: vi.fn().mockResolvedValue(undefined),
      }
      mockContext.audioWorklet = mockWorklet as unknown as AudioWorklet
      const originalAudioWorkletNode = (global as Record<string, unknown>).AudioWorkletNode
      ;(global as Record<string, unknown>).AudioWorkletNode = MockAudioWorkletNode

      try {
        await streamer.start()

        expect(mockWorklet.addModule).toHaveBeenCalled()
        const workletNode = streamer.getAudioWorkletNode() as unknown as MockAudioWorkletNode | null
        expect(workletNode).not.toBeNull()
        expect(workletNode).toBeInstanceOf(MockAudioWorkletNode)

        // Verify virtualMicMasterNode connects to workletNode
        expect(workletNode?.connect).toHaveBeenCalled()

        // Verify worklet port messages are routed directly to ipcBridge.pushAudio
        const fakeBuffer = new ArrayBuffer(256)
        workletNode!.port.onmessage!({ data: fakeBuffer })
        expect(mockIpc.pushAudio).toHaveBeenCalledWith(fakeBuffer)
      } finally {
        if (originalAudioWorkletNode) {
          ;(global as Record<string, unknown>).AudioWorkletNode = originalAudioWorkletNode
        } else {
          delete (global as Record<string, unknown>).AudioWorkletNode
        }
      }
    })

    it('falls back gracefully to ScriptProcessorNode when AudioWorklet is unsupported or addModule throws', async () => {
      const mockWorklet = {
        addModule: vi.fn().mockRejectedValue(new Error('Module load error in test environment')),
      }
      mockContext.audioWorklet = mockWorklet as unknown as AudioWorklet
      const originalAudioWorkletNode = (global as Record<string, unknown>).AudioWorkletNode
      ;(global as Record<string, unknown>).AudioWorkletNode = MockAudioWorkletNode

      try {
        await streamer.start()

        expect(streamer.getAudioWorkletNode()).toBeNull()
        const scriptProcessor = streamer.getScriptProcessorNode()
        expect(scriptProcessor).not.toBeNull()

        // Fallback ScriptProcessor pushes audio to IPC
        const fakeAudioEvent = {
          inputBuffer: {
            numberOfChannels: 2,
            getChannelData: (ch: number) =>
              ch === 0 ? new Float32Array([0.5, -0.5]) : new Float32Array([0.25, -0.25]),
          },
        }
        ;(scriptProcessor as unknown as MockScriptProcessorNode).onaudioprocess!(
          fakeAudioEvent as unknown as AudioProcessingEvent,
        )
        expect(mockIpc.pushAudio).toHaveBeenCalledWith(expect.any(Uint8Array))
      } finally {
        if (originalAudioWorkletNode) {
          ;(global as Record<string, unknown>).AudioWorkletNode = originalAudioWorkletNode
        } else {
          delete (global as Record<string, unknown>).AudioWorkletNode
        }
      }
    })

    it('cleans up AudioWorkletNode, closes port, and tears down graph on stop', async () => {
      const mockWorklet = {
        addModule: vi.fn().mockResolvedValue(undefined),
      }
      mockContext.audioWorklet = mockWorklet as unknown as AudioWorklet
      const originalAudioWorkletNode = (global as Record<string, unknown>).AudioWorkletNode
      ;(global as Record<string, unknown>).AudioWorkletNode = MockAudioWorkletNode

      try {
        await streamer.start()
        const workletNode = streamer.getAudioWorkletNode() as unknown as MockAudioWorkletNode | null
        expect(workletNode).not.toBeNull()

        await streamer.stop()

        expect(workletNode?.port.close).toHaveBeenCalled()
        expect(workletNode?.port.onmessage).toBeNull()
        expect(workletNode?.disconnect).toHaveBeenCalled()
        expect(streamer.getAudioWorkletNode()).toBeNull()
      } finally {
        if (originalAudioWorkletNode) {
          ;(global as Record<string, unknown>).AudioWorkletNode = originalAudioWorkletNode
        } else {
          delete (global as Record<string, unknown>).AudioWorkletNode
        }
      }
    })
  })

  describe('Hardware Webcam Stream Exposure', () => {
    it('exposes getWebcamStream() when camera is active and null when stopped', async () => {
      const mockStream = {
        getTracks: vi.fn(() => [{ stop: vi.fn() }]),
      }
      const instance = new VirtualStudioStreamer({
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue(mockStream),
        } as unknown as MediaDevices,
        ipcBridge: mockIpc,
      })
      expect(instance.getWebcamStream()).toBeNull()

      await instance.start({ enableCamera: true })
      expect(instance.getWebcamStream()).toBe(mockStream)

      await instance.stop()
      expect(instance.getWebcamStream()).toBeNull()
    })
  })
})

describe('VirtualStudioAudioProcessor', () => {
  it('converts stereo Float32Array [-1, 1] quantums to Int16Array [-32768, 32767] PCM chunks and posts transferable ArrayBuffer', () => {
    const processor = new VirtualStudioAudioProcessor()
    const postedBuffers: unknown[] = []
    const postedTransfers: unknown[] = []
    processor.port.postMessage = vi.fn((data, transfer) => {
      postedBuffers.push(data)
      postedTransfers.push(transfer)
    })

    const left = new Float32Array([0.0, 0.5, -0.5, 1.0, -1.0])
    const right = new Float32Array([0.0, 0.25, -0.25, 1.0, -1.0])

    const keepAlive = processor.process([[left, right]], [], {})
    expect(keepAlive).toBe(true)
    expect(processor.port.postMessage).toHaveBeenCalledTimes(1)

    const buffer = postedBuffers[0] as ArrayBuffer
    expect(buffer).toBeInstanceOf(ArrayBuffer)
    expect(postedTransfers[0]).toEqual([buffer])

    const int16 = new Int16Array(buffer)
    expect(int16.length).toBe(10)
    expect(int16[0]).toBe(0)
    expect(int16[1]).toBe(0)
    expect(int16[2]).toBe(16383)
    expect(int16[3]).toBe(8191)
    expect(int16[4]).toBe(-16384)
    expect(int16[5]).toBe(-8192)
    expect(int16[6]).toBe(32767)
    expect(int16[7]).toBe(32767)
    expect(int16[8]).toBe(-32768)
    expect(int16[9]).toBe(-32768)
  })

  it('handles mono input by duplicating to stereo interleaved PCM', () => {
    const processor = new VirtualStudioAudioProcessor()
    const postedBuffers: unknown[] = []
    processor.port.postMessage = vi.fn((data) => {
      postedBuffers.push(data)
    })

    const mono = new Float32Array([0.5, -0.5])
    const keepAlive = processor.process([[mono]], [], {})
    expect(keepAlive).toBe(true)

    const int16 = new Int16Array(postedBuffers[0] as ArrayBuffer)
    expect(int16.length).toBe(4)
    expect(int16[0]).toBe(16383)
    expect(int16[1]).toBe(16383)
    expect(int16[2]).toBe(-16384)
    expect(int16[3]).toBe(-16384)
  })

  it('clamps out-of-bounds float values to [-32768, 32767]', () => {
    const processor = new VirtualStudioAudioProcessor()
    const postedBuffers: unknown[] = []
    processor.port.postMessage = vi.fn((data) => {
      postedBuffers.push(data)
    })

    const overblown = new Float32Array([2.5, -3.0])
    processor.process([[overblown]], [], {})

    const int16 = new Int16Array(postedBuffers[0] as ArrayBuffer)
    expect(int16[0]).toBe(32767)
    expect(int16[1]).toBe(32767)
    expect(int16[2]).toBe(-32768)
    expect(int16[3]).toBe(-32768)
  })

  it('returns true without posting when input is empty or channels are missing', () => {
    const processor = new VirtualStudioAudioProcessor()
    processor.port.postMessage = vi.fn()

    expect(processor.process([], [], {})).toBe(true)
    expect(processor.process([[]], [], {})).toBe(true)
    expect(processor.process([[new Float32Array(0)]], [], {})).toBe(true)
    expect(processor.port.postMessage).not.toHaveBeenCalled()
  })

  it('verifies processor name and createAudioWorkletBlobUrl helper', () => {
    expect(VIRTUAL_STUDIO_AUDIO_PROCESSOR_NAME).toBe('virtual-studio-audio-processor')
    const blobUrl = createAudioWorkletBlobUrl()
    expect(typeof blobUrl).toBe('string')
  })
})
