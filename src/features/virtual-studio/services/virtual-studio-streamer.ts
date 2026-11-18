import {
  DEFAULT_VIRTUAL_STUDIO_RESOLUTION,
  DEFAULT_VIRTUAL_STUDIO_FALLBACK_COLOR,
  type VirtualStudioConfig,
  type VirtualStudioStatus,
  type VirtualFramePayload,
  type TrayQuickAction,
  type VirtualStudioActionResult,
} from '../../../../shared/virtual-camera-types'
import { useEditorStore } from '../../../store/editorStore'
import {
  VIRTUAL_STUDIO_AUDIO_PROCESSOR_NAME,
  createAudioWorkletBlobUrl,
} from '../workers/virtual-studio-audio-processor.worklet'

export interface VirtualStudioIPC {
  getStatus: () => Promise<VirtualStudioStatus>
  installDriver: () => Promise<VirtualStudioActionResult>
  start: (config: VirtualStudioConfig) => Promise<VirtualStudioActionResult>
  stop: () => Promise<VirtualStudioActionResult>
  pushFrame: (payload: VirtualFramePayload) => void
  pushAudio: (buffer: Uint8Array | ArrayBuffer) => void
  triggerAction: (action: TrayQuickAction) => Promise<VirtualStudioActionResult>
  updateStatus: (patch: Partial<VirtualStudioStatus>) => void
  pushPreviewFrame?: (dataUrl: string) => void
  onPreviewFrame?: (callback: (dataUrl: string) => void) => () => void
  showHud?: () => void
  hideHud?: () => void
  toggleHud?: () => void
  onStatusChange?: (callback: (status: VirtualStudioStatus) => void) => () => void
  onTrayAction?: (callback: (action: TrayQuickAction) => void) => () => void
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}

function getVirtualStudioAPI(): VirtualStudioIPC | undefined {
  if (typeof window === 'undefined') return undefined
  return window.electronAPI?.virtualStudio as unknown as VirtualStudioIPC | undefined
}

export const defaultIpcBridge: VirtualStudioIPC = {
  getStatus: () =>
    getVirtualStudioAPI()?.getStatus() ??
    Promise.resolve({
      cameraDriverInstalled: false,
      micDriverInstalled: false,
      isStreaming: false,
      isCameraActive: false,
      isMicActive: false,
      activeSource: 'webcam',
      webcamDeviceId: null,
      micDeviceId: null,
      isMicMuted: false,
      isPlaying: false,
      isLocalAudioMonitoringEnabled: true,
      localMonitoringVolume: 1.0,
      isMirrored: false,
      isMiniHudVisible: true,
      error: null,
    }),
  installDriver: () => getVirtualStudioAPI()?.installDriver() ?? Promise.resolve({ success: true }),
  start: (config: VirtualStudioConfig) => getVirtualStudioAPI()?.start(config) ?? Promise.resolve({ success: true }),
  stop: () => getVirtualStudioAPI()?.stop() ?? Promise.resolve({ success: true }),
  pushFrame: (payload: VirtualFramePayload) => {
    getVirtualStudioAPI()?.pushFrame(payload)
  },
  pushAudio: (buffer: Uint8Array | ArrayBuffer) => {
    getVirtualStudioAPI()?.pushAudio(buffer)
  },
  triggerAction: (action: TrayQuickAction) =>
    getVirtualStudioAPI()?.triggerAction(action) ?? Promise.resolve({ success: true }),
  updateStatus: (patch: Partial<VirtualStudioStatus>) => {
    getVirtualStudioAPI()?.updateStatus(patch)
  },
  pushPreviewFrame: (dataUrl: string) => {
    getVirtualStudioAPI()?.pushPreviewFrame?.(dataUrl)
  },
  onPreviewFrame: (callback: (dataUrl: string) => void) =>
    getVirtualStudioAPI()?.onPreviewFrame?.(callback) ?? (() => {}),
  showHud: () => {
    getVirtualStudioAPI()?.showHud?.()
  },
  hideHud: () => {
    getVirtualStudioAPI()?.hideHud?.()
  },
  toggleHud: () => {
    getVirtualStudioAPI()?.toggleHud?.()
  },
  onStatusChange: (callback) => getVirtualStudioAPI()?.onStatusChange?.(callback) ?? (() => {}),
  onTrayAction: (callback) => getVirtualStudioAPI()?.onTrayAction?.(callback) ?? (() => {}),
}

export interface StreamerDependencies {
  audioContext?: AudioContext
  mediaDevices?: MediaDevices
  ipcBridge?: VirtualStudioIPC
  createCanvas?: () => HTMLCanvasElement
  createVideo?: () => HTMLVideoElement
  audioWorkletUrl?: string
}

export type PreviewFrameCallback = (canvas: HTMLCanvasElement) => void

/**
 * Manages physical webcam capture, canvas grabbing, dual-output Web Audio graph,
 * and Instant Auto-Return switching for the Virtual Camera & Microphone Studio.
 */
export class VirtualStudioStreamer {
  private active = false
  private isPlaying = false
  private activeSource: 'webcam' | 'canvas' = 'webcam'
  private isMicMuted = false
  private playbackMicUnmuted: boolean = false
  private isLocalAudioMonitoringEnabled = true
  private localMonitoringVolume = 1.0
  private isMirrored = false
  private selectedCameraId: string | null = null
  private selectedMicId: string | null = null
  private enableCamera = true
  private enableMic = true
  private outputResolution: { width: number; height: number; fps: number } = {
    ...DEFAULT_VIRTUAL_STUDIO_RESOLUTION,
  }
  private lastThumbnailTime = -1
  private isMiniHudVisible = true
  private nextFrameTime = 0

  // Dependency Injections
  private audioContext: AudioContext | null = null
  private mediaDevices: MediaDevices | null = null
  private ipcBridge: VirtualStudioIPC
  private createCanvas: () => HTMLCanvasElement
  private createVideo: () => HTMLVideoElement

  // Video / Canvas Capture State
  private sourceCanvas: HTMLCanvasElement | null = null
  private webcamVideo: HTMLVideoElement | null = null
  private webcamStream: MediaStream | null = null
  private scratchCanvas: HTMLCanvasElement | null = null
  private scratchCtx: CanvasRenderingContext2D | null = null
  private hudThumbnailCanvas: HTMLCanvasElement | null = null
  private hudThumbnailCtx: CanvasRenderingContext2D | null = null
  private frameTimer: ReturnType<typeof setTimeout> | null = null
  private previewListeners: Set<PreviewFrameCallback> = new Set()

  // Dual-Output Audio Graph State
  private micStream: MediaStream | null = null
  private micSourceNode: MediaStreamAudioSourceNode | AudioNode | null = null
  private micGainNode: GainNode | null = null
  private videoSourceNode: MediaElementAudioSourceNode | MediaStreamAudioSourceNode | AudioNode | null = null
  private customAudioSourceNode: AudioNode | null = null
  private mediaStreamSourceNode: MediaStreamAudioSourceNode | AudioNode | null = null
  private attachedMediaStream: MediaStream | null = null
  private videoElement: HTMLMediaElement | null = null
  private demoAudioBus: GainNode | null = null
  private videoToVirtualMicGain: GainNode | null = null
  private localMonitoringGain: GainNode | null = null
  private virtualMicMasterNode: GainNode | null = null
  private audioWorkletNode: AudioWorkletNode | null = null
  private scriptProcessorNode: ScriptProcessorNode | AudioNode | null = null
  private audioWorkletBlobUrl: string | null = null
  private audioWorkletUrl?: string
  private zeroGainNode: GainNode | null = null
  private elementSourceMap: WeakMap<HTMLMediaElement, MediaElementAudioSourceNode> = new WeakMap()
  private registeredBusInputs: WeakSet<AudioNode> = new WeakSet()
  private isDemoBusConnectedToMonitoring = false

  constructor(deps: StreamerDependencies = {}) {
    this.audioContext = deps.audioContext ?? null
    this.mediaDevices = deps.mediaDevices ?? (typeof navigator !== 'undefined' ? navigator.mediaDevices : null)
    this.ipcBridge = deps.ipcBridge ?? defaultIpcBridge
    this.audioWorkletUrl = deps.audioWorkletUrl
    this.createCanvas =
      deps.createCanvas ??
      (() => {
        if (typeof document !== 'undefined') return document.createElement('canvas')
        return {} as HTMLCanvasElement
      })
    this.createVideo =
      deps.createVideo ??
      (() => {
        if (typeof document !== 'undefined') return document.createElement('video')
        return {} as HTMLVideoElement
      })
  }

  public getAudioWorkletNode(): AudioWorkletNode | null {
    return this.audioWorkletNode
  }

  public getScriptProcessorNode(): ScriptProcessorNode | AudioNode | null {
    return this.scriptProcessorNode
  }

  public setIpcBridge(ipc: VirtualStudioIPC): void {
    this.ipcBridge = ipc
  }

  public isActive(): boolean {
    return this.active
  }

  public getPlaying(): boolean {
    return this.isPlaying
  }

  public getActiveSource(): 'webcam' | 'canvas' {
    return this.activeSource
  }

  public isMuted(): boolean {
    return this.isMicMuted
  }

  public isMonitoringEnabled(): boolean {
    return this.isLocalAudioMonitoringEnabled
  }

  public getMonitoringVolume(): number {
    return this.localMonitoringVolume
  }

  public isMirrorEnabled(): boolean {
    return this.isMirrored
  }

  public getMirrored(): boolean {
    return this.isMirrored
  }

  public setMirrored(mirrored: boolean): void {
    if (this.isMirrored === mirrored) return
    this.isMirrored = mirrored
    if (this.active) {
      this.ipcBridge.updateStatus({ isMirrored: mirrored } as Partial<VirtualStudioStatus>)
    }
  }

  public isHudVisible(): boolean {
    return this.isMiniHudVisible
  }

  public setMiniHudVisible(visible: boolean): void {
    this.isMiniHudVisible = visible
  }

  public getPreviewCanvas(): HTMLCanvasElement | null {
    return this.scratchCanvas
  }

  /**
   * Subscribes to live outgoing frames rendered to the preview canvas.
   * Used by the Mini-HUD to show a live thumbnail feed.
   */
  public onPreviewFrame(callback: PreviewFrameCallback): () => void {
    this.previewListeners.add(callback)
    return () => {
      this.previewListeners.delete(callback)
    }
  }

  /**
   * Attaches the WYSIWYG editor canvas preview for canvas capture.
   */
  public attachCanvas(canvas: HTMLCanvasElement): void {
    this.sourceCanvas = canvas
  }

  public detachCanvas(): void {
    this.sourceCanvas = null
  }

  /**
   * Pushes a newly rendered editor canvas frame immediately without waiting for a timer loop.
   * Delivers frames directly to IPC when Virtual Studio is active and activeSource is 'canvas'.
   */
  public pushRenderedCanvas(sourceCanvas: HTMLCanvasElement, timestamp?: number): void {
    if (!this.active || this.activeSource !== 'canvas') return
    this.sourceCanvas = sourceCanvas
    this.captureTick(timestamp)
  }

  /**
   * Attaches video element for audio extraction into the Dual-Output Audio Graph.
   */
  public attachVideoElement(video: HTMLMediaElement): void {
    this.videoElement = video
    if (this.customAudioSourceNode || this.attachedMediaStream) {
      // Dedicated audio source or multi-track stream takes precedence over raw video element
      return
    }
    if (!this.audioContext) {
      this.initAudioContext()
    }
    if (!this.audioContext) return

    try {
      const sourceNode = this.createMediaElementSource(video)
      if (this.videoSourceNode && this.videoSourceNode !== sourceNode && this.demoAudioBus) {
        try {
          this.videoSourceNode.disconnect(this.demoAudioBus)
        } catch {
          // Ignore disconnect errors
        }
        this.registeredBusInputs.delete(this.videoSourceNode)
      }
      this.videoSourceNode = sourceNode
      this.wireVideoAudioGraph()
    } catch (err) {
      console.warn('[VirtualStudioStreamer] Failed to attach video element to audio graph:', err)
    }
  }

  /**
   * Attaches a mixed multi-track MediaStream to the Dual-Output Audio Graph.
   */
  public attachMediaStream(stream: MediaStream): void {
    this.attachedMediaStream = stream
    if (!this.audioContext) {
      this.initAudioContext()
    }
    if (!this.audioContext) return

    try {
      if (this.mediaStreamSourceNode) {
        try {
          this.mediaStreamSourceNode.disconnect()
        } catch {
          // Ignore disconnect errors
        }
        this.registeredBusInputs.delete(this.mediaStreamSourceNode)
        this.mediaStreamSourceNode = null
      }
      const sourceNode = this.audioContext.createMediaStreamSource(stream)
      this.mediaStreamSourceNode = sourceNode
      if (this.videoSourceNode && this.videoSourceNode !== sourceNode && this.demoAudioBus) {
        try {
          this.videoSourceNode.disconnect(this.demoAudioBus)
        } catch {
          // Ignore disconnect errors
        }
        this.registeredBusInputs.delete(this.videoSourceNode)
      }
      this.videoSourceNode = sourceNode
      this.wireVideoAudioGraph()
    } catch (err) {
      console.warn('[VirtualStudioStreamer] Failed to attach media stream to audio graph:', err)
    }
  }

  public detachMediaStream(): void {
    this.attachedMediaStream = null
    if (this.mediaStreamSourceNode) {
      try {
        this.mediaStreamSourceNode.disconnect()
      } catch {
        // Disconnect can throw if already disconnected
      }
      this.registeredBusInputs.delete(this.mediaStreamSourceNode)
      this.mediaStreamSourceNode = null
    }
    if (this.customAudioSourceNode) {
      this.videoSourceNode = this.customAudioSourceNode
      this.wireVideoAudioGraph()
    } else if (this.videoElement) {
      this.attachVideoElement(this.videoElement)
    } else {
      this.detachVideoElement()
    }
  }

  /**
   * Attaches an AudioNode to the Dual-Output Audio Graph.
   */
  public attachAudioSource(source: AudioNode): void {
    if (!this.audioContext) {
      this.initAudioContext()
    }
    if (this.videoSourceNode && this.videoSourceNode !== source && this.demoAudioBus) {
      try {
        this.videoSourceNode.disconnect(this.demoAudioBus)
      } catch {
        // Ignore disconnect errors
      }
      this.registeredBusInputs.delete(this.videoSourceNode)
    }
    this.customAudioSourceNode = source
    this.videoSourceNode = source
    this.wireVideoAudioGraph()
  }

  /**
   * Registers an AudioNode as already feeding into the demoAudioBus (e.g. from PreviewAudioMixer).
   * Prevents duplicate summing connections.
   */
  public registerBusInput(node: AudioNode | null | undefined): void {
    if (node) {
      this.registeredBusInputs.add(node)
    }
  }

  /**
   * Unregisters an AudioNode when detached or disposed.
   */
  public unregisterBusInput(node: AudioNode | null | undefined): void {
    if (node) {
      this.registeredBusInputs.delete(node)
    }
  }

  /**
   * Reusable, cached MediaElementAudioSourceNode factory per HTMLMediaElement.
   * Avoids "MediaElementAudioSourceNode already created" DOM exceptions.
   */
  public createMediaElementSource(element: HTMLMediaElement): MediaElementAudioSourceNode {
    const ctx = this.getAudioContext()
    let sourceNode = this.elementSourceMap.get(element)
    if (!sourceNode) {
      sourceNode = ctx.createMediaElementSource(element)
      this.elementSourceMap.set(element, sourceNode)
    }
    return sourceNode
  }

  /**
   * Returns the persistent demoAudioBus GainNode. All editor timeline playback,
   * background music clips, and sound effects feed into this bus.
   */
  public getDemoAudioBus(): GainNode {
    return this.ensureDemoAudioBus()
  }

  private ensureDemoAudioBus(): GainNode {
    if (!this.audioContext) {
      this.initAudioContext()
    }
    if (!this.audioContext) {
      return {} as GainNode
    }
    if (!this.demoAudioBus) {
      if (typeof this.audioContext.createGain === 'function') {
        this.demoAudioBus = this.audioContext.createGain()
        this.demoAudioBus.gain.value = 1.0
      } else {
        this.demoAudioBus = {
          gain: { value: 1.0, setValueAtTime: () => {}, setTargetAtTime: () => {} },
          connect: () => {},
          disconnect: () => {},
        } as unknown as GainNode
      }
    }
    if (!this.localMonitoringGain) {
      if (typeof this.audioContext.createGain === 'function') {
        this.localMonitoringGain = this.audioContext.createGain()
        this.localMonitoringGain.gain.value = this.active
          ? this.isLocalAudioMonitoringEnabled
            ? this.localMonitoringVolume
            : 0.0
          : 1.0
        if (this.audioContext.destination) {
          try {
            this.localMonitoringGain.connect(this.audioContext.destination)
          } catch {
            // Ignore in test mocks
          }
        }
      } else {
        this.localMonitoringGain = {
          gain: { value: 1.0, setValueAtTime: () => {}, setTargetAtTime: () => {} },
          connect: () => {},
          disconnect: () => {},
        } as unknown as GainNode
      }
    }
    if (
      !this.isDemoBusConnectedToMonitoring &&
      this.demoAudioBus &&
      this.localMonitoringGain &&
      typeof this.demoAudioBus.connect === 'function'
    ) {
      try {
        this.demoAudioBus.connect(this.localMonitoringGain)
        this.isDemoBusConnectedToMonitoring = true
      } catch {
        // Ignore if already connected
      }
    }
    return this.demoAudioBus
  }

  public getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.initAudioContext()
    }
    return this.audioContext!
  }

  public detachVideoElement(): void {
    this.videoElement = null
    if (this.videoSourceNode && !this.customAudioSourceNode && !this.mediaStreamSourceNode) {
      if (this.demoAudioBus) {
        try {
          this.videoSourceNode.disconnect(this.demoAudioBus)
        } catch {
          // Disconnect can throw if already disconnected
        }
      }
      this.registeredBusInputs.delete(this.videoSourceNode)
      this.videoSourceNode = null
    }
  }

  public detachAudioSource(): void {
    if (this.videoSourceNode && this.demoAudioBus) {
      try {
        this.videoSourceNode.disconnect(this.demoAudioBus)
      } catch {
        // Ignore disconnect errors
      }
      this.registeredBusInputs.delete(this.videoSourceNode)
    }
    this.customAudioSourceNode = null
    this.videoSourceNode = null
  }

  /**
   * Starts Virtual Studio: initializes devices, sets up audio graph, and begins frame loop.
   */
  public async start(config: Partial<VirtualStudioConfig> = {}): Promise<VirtualStudioActionResult> {
    if (this.active) {
      await this.stop()
    }

    if (config.outputResolution) this.outputResolution = { ...this.outputResolution, ...config.outputResolution }
    if (config.enableCamera !== undefined) this.enableCamera = config.enableCamera
    if (config.enableMic !== undefined) this.enableMic = config.enableMic
    if (config.selectedWebcamId !== undefined) this.selectedCameraId = config.selectedWebcamId
    if (config.selectedMicId !== undefined) this.selectedMicId = config.selectedMicId
    if (config.enableLocalAudioMonitoring !== undefined) {
      this.isLocalAudioMonitoringEnabled = config.enableLocalAudioMonitoring
    }
    if (config.localMonitoringVolume !== undefined) {
      this.localMonitoringVolume = Math.max(0, Math.min(1, config.localMonitoringVolume))
    }
    const configAny = config as unknown as { isMirrored?: boolean; isMiniHudVisible?: boolean }
    if (configAny.isMirrored !== undefined) {
      this.isMirrored = configAny.isMirrored
    }
    if (configAny.isMiniHudVisible !== undefined) {
      this.isMiniHudVisible = configAny.isMiniHudVisible
    }

    this.active = true
    this.isPlaying = false
    this.activeSource = 'webcam'
    this.isMicMuted = false

    // Initialize scratch canvas
    this.scratchCanvas = this.createCanvas()
    this.scratchCanvas.width = this.outputResolution.width
    this.scratchCanvas.height = this.outputResolution.height
    this.scratchCtx = this.scratchCanvas.getContext?.('2d') ?? null
    if (this.scratchCtx) {
      this.scratchCtx.imageSmoothingEnabled = true
      this.scratchCtx.imageSmoothingQuality = 'high'
    }

    // Initialize HUD thumbnail canvas (320x180) to reduce JPEG encoding overhead by 36x
    this.hudThumbnailCanvas = this.createCanvas()
    this.hudThumbnailCanvas.width = 320
    this.hudThumbnailCanvas.height = 180
    this.hudThumbnailCtx = this.hudThumbnailCanvas.getContext?.('2d') ?? null

    // Initialize Audio Graph
    this.initAudioContext()
    await this.buildAudioGraph()

    // Initialize Devices
    if (this.enableCamera) {
      await this.startWebcam()
    }
    if (this.enableMic) {
      await this.startMicrophone()
    }

    // Apply initial auto-return states
    this.applyInstantAutoReturn()

    // Start frame grabber interval
    this.startFrameLoop()

    // Notify IPC main process
    const result = await this.ipcBridge.start({
      enableCamera: this.enableCamera,
      enableMic: this.enableMic,
      selectedWebcamId: this.selectedCameraId ?? undefined,
      selectedMicId: this.selectedMicId ?? undefined,
      outputResolution: this.outputResolution,
      enableLocalAudioMonitoring: this.isLocalAudioMonitoringEnabled,
      localMonitoringVolume: this.localMonitoringVolume,
    })

    return result
  }

  /**
   * Stops Virtual Studio: frees hardware cameras and mics, closes audio graph, and stops frame loop.
   */
  public async stop(): Promise<VirtualStudioActionResult> {
    this.active = false
    this.stopFrameLoop()
    this.stopWebcam()
    this.stopMicrophone()
    this.teardownAudioGraph()
    this.hudThumbnailCanvas = null
    this.hudThumbnailCtx = null
    this.lastThumbnailTime = -1

    // Notify IPC main process
    const result = await this.ipcBridge.stop()
    return result
  }

  /**
   * Instant Auto-Return: Switches feeds and audio routing between playback and webcam.
   * - When playing: broadcasts canvas preview frames and video audio; mutes physical mic.
   * - When paused/idle: instantly switches to physical webcam feed and un-mutes physical mic.
   */
  public setPlaying(isPlaying: boolean): void {
    if (this.isPlaying === isPlaying) return
    this.isPlaying = isPlaying
    this.activeSource = isPlaying ? 'canvas' : 'webcam'

    if (isPlaying) {
      this.playbackMicUnmuted = false
    }

    if (isPlaying && this.audioContext?.state === 'suspended') {
      void this.audioContext.resume().catch(() => {})
    }

    this.applyInstantAutoReturn()

    // Synchronize status with main process
    this.ipcBridge.updateStatus({
      isPlaying: this.isPlaying,
      activeSource: this.activeSource,
      isMicMuted: this.isMicMuted,
    })

    // Manage frame timer loop according to activeSource:
    // When canvas: do not poll timer loop; frames are delivered event-driven by pushRenderedCanvas.
    // When webcam: keep timer loop running at target FPS.
    this.startFrameLoop()

    // Immediately trigger a frame render
    this.captureTick()
  }

  /**
   * Mutes or un-mutes the physical microphone.
   */
  public setMicMuted(muted: boolean): void {
    this.isMicMuted = muted
    if (this.isPlaying) {
      this.playbackMicUnmuted = !muted
    }
    this.applyInstantAutoReturn()
    this.ipcBridge.updateStatus({ isMicMuted: this.isMicMuted })
  }

  public toggleMicMute(): void {
    this.setMicMuted(!this.isMicMuted)
  }

  /**
   * Sets whether video playback audio is monitored locally through speakers/headphones.
   */
  public setLocalAudioMonitoringEnabled(enabled: boolean): void {
    this.isLocalAudioMonitoringEnabled = enabled
    this.applyInstantAutoReturn()
    this.ipcBridge.updateStatus({ isLocalAudioMonitoringEnabled: enabled })
  }

  /**
   * Sets local audio monitoring volume (clamped between 0.0 and 1.0).
   * Note: Does not dispatch async updateStatus to IPC to prevent circular slider fighting loops.
   */
  public setLocalMonitoringVolume(volume: number): void {
    this.localMonitoringVolume = Math.max(0, Math.min(1, volume))
    this.applyInstantAutoReturn()
  }

  /**
   * Dynamically enables or disables physical camera capture while active.
   */
  public async setEnableCamera(enable: boolean): Promise<void> {
    if (this.enableCamera === enable) return
    this.enableCamera = enable
    if (this.active) {
      if (enable) {
        await this.startWebcam()
      } else {
        this.stopWebcam()
      }
      this.ipcBridge.updateStatus({ isCameraActive: enable })
    }
  }

  /**
   * Dynamically enables or disables physical microphone capture while active.
   */
  public async setEnableMic(enable: boolean): Promise<void> {
    if (this.enableMic === enable) return
    this.enableMic = enable
    if (this.active) {
      if (enable) {
        await this.startMicrophone()
      } else {
        this.stopMicrophone()
      }
      this.ipcBridge.updateStatus({ isMicActive: enable })
    }
  }

  /**
   * Switches physical webcam device.
   */
  public async setSelectedCamera(deviceId: string | null): Promise<void> {
    this.selectedCameraId = deviceId
    if (this.active && this.enableCamera) {
      await this.startWebcam()
    }
  }

  /**
   * Switches physical microphone device.
   */
  public async setSelectedMic(deviceId: string | null): Promise<void> {
    this.selectedMicId = deviceId
    if (this.active && this.enableMic) {
      await this.startMicrophone()
    }
  }

  // --- Internal Audio Engine ---

  private initAudioContext(): void {
    if (this.audioContext) return
    try {
      const AudioCtx = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null
      if (AudioCtx) {
        this.audioContext = new AudioCtx({ sampleRate: 48000 })
      }
    } catch (err) {
      console.warn('[VirtualStudioStreamer] Unable to create AudioContext:', err)
    }
  }

  private async buildAudioGraph(): Promise<void> {
    if (!this.audioContext) return

    try {
      if (this.audioContext.state === 'suspended') {
        void this.audioContext.resume().catch(() => {})
      }

      // 1. Virtual Mic Master Gain Node
      this.virtualMicMasterNode = this.audioContext.createGain()
      this.virtualMicMasterNode.gain.value = 1.0

      // 2. Physical Mic Gain Node
      this.micGainNode = this.audioContext.createGain()
      this.micGainNode.gain.value = 1.0
      this.micGainNode.connect(this.virtualMicMasterNode)

      // 3. Demo Audio to Virtual Mic Gain Node
      this.videoToVirtualMicGain = this.audioContext.createGain()
      this.videoToVirtualMicGain.gain.value = 0.0
      this.videoToVirtualMicGain.connect(this.virtualMicMasterNode)

      // 4. Ensure persistent demoAudioBus and localMonitoringGain exist and are routed
      this.ensureDemoAudioBus()

      // Connect persistent demoAudioBus to videoToVirtualMicGain
      if (this.demoAudioBus && typeof this.demoAudioBus.connect === 'function') {
        try {
          this.demoAudioBus.connect(this.videoToVirtualMicGain)
        } catch {
          // Ignore in mock environments
        }
      }

      // 5. Virtual Mic Sink Audio Node (AudioWorklet with graceful ScriptProcessor fallback)
      let workletConnected = false
      if (
        this.audioContext.audioWorklet &&
        typeof this.audioContext.audioWorklet.addModule === 'function' &&
        typeof AudioWorkletNode !== 'undefined'
      ) {
        try {
          if (!this.audioWorkletBlobUrl && !this.audioWorkletUrl) {
            this.audioWorkletBlobUrl = createAudioWorkletBlobUrl()
          }
          const moduleUrl = this.audioWorkletUrl || this.audioWorkletBlobUrl
          if (moduleUrl) {
            await this.audioContext.audioWorklet.addModule(moduleUrl)
            const workletNode = new AudioWorkletNode(this.audioContext, VIRTUAL_STUDIO_AUDIO_PROCESSOR_NAME)
            workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
              if (!this.active) return
              this.ipcBridge.pushAudio(event.data)
            }
            this.audioWorkletNode = workletNode
            this.virtualMicMasterNode.connect(workletNode)

            // Connect processor to destination through zero gain so Chromium schedules buffer callbacks
            this.zeroGainNode = this.audioContext.createGain()
            this.zeroGainNode.gain.value = 0.0
            workletNode.connect(this.zeroGainNode)
            this.zeroGainNode.connect(this.audioContext.destination)
            workletConnected = true
          }
        } catch (err) {
          console.warn(
            '[VirtualStudioStreamer] AudioWorklet initialization failed, falling back to ScriptProcessor:',
            err,
          )
        }
      }

      if (!workletConnected && typeof this.audioContext.createScriptProcessor === 'function') {
        const processor = this.audioContext.createScriptProcessor(4096, 2, 2)
        let lastDiagnosticTime = 0
        processor.onaudioprocess = (event: AudioProcessingEvent) => {
          if (!this.active) return
          const input = event.inputBuffer
          const left = input.getChannelData(0)
          const right = input.numberOfChannels > 1 ? input.getChannelData(1) : left

          const pcmBytes = this.interleaveFloatTo16BitPCM(left, right)
          this.ipcBridge.pushAudio(pcmBytes)

          // Periodic active audio diagnostic logging (every 4 seconds during playback)
          const now = Date.now()
          if (this.isPlaying && now - lastDiagnosticTime > 4000) {
            lastDiagnosticTime = now
            let sumSq = 0
            for (let i = 0; i < left.length; i += 16) {
              sumSq += left[i] * left[i]
            }
            const rms = Math.sqrt(sumSq / (left.length / 16))
            if (rms > 0.005) {
              console.log(`[VirtualStudioStreamer] Active audio streaming to virtual mic (RMS: ${rms.toFixed(3)})`)
            }
          }
        }
        this.scriptProcessorNode = processor
        this.virtualMicMasterNode.connect(processor)

        // Connect processor to destination through zero gain so Chromium schedules buffer callbacks
        this.zeroGainNode = this.audioContext.createGain()
        this.zeroGainNode.gain.value = 0.0
        processor.connect(this.zeroGainNode)
        this.zeroGainNode.connect(this.audioContext.destination)
      }

      if (this.customAudioSourceNode) {
        this.videoSourceNode = this.customAudioSourceNode
        this.wireVideoAudioGraph()
      } else if (this.attachedMediaStream) {
        this.attachMediaStream(this.attachedMediaStream)
      } else if (this.videoElement) {
        this.attachVideoElement(this.videoElement)
      } else {
        this.wireVideoAudioGraph()
      }
    } catch (err) {
      console.warn('[VirtualStudioStreamer] Error building Web Audio graph:', err)
    }
  }

  private wireVideoAudioGraph(): void {
    if (!this.videoSourceNode) return
    try {
      const bus = this.getDemoAudioBus()
      if (bus && typeof this.videoSourceNode.connect === 'function') {
        if (!this.registeredBusInputs.has(this.videoSourceNode)) {
          try {
            this.videoSourceNode.disconnect(bus)
          } catch {
            // Ignore if not connected
          }
          this.videoSourceNode.connect(bus)
        }
      }
    } catch (err) {
      console.warn('[VirtualStudioStreamer] Error connecting video source to graph:', err)
    }
  }

  private teardownAudioGraph(): void {
    try {
      this.micSourceNode?.disconnect()
      this.micGainNode?.disconnect()
      this.mediaStreamSourceNode?.disconnect()
      if (this.demoAudioBus && this.videoToVirtualMicGain && typeof this.demoAudioBus.disconnect === 'function') {
        try {
          this.demoAudioBus.disconnect(this.videoToVirtualMicGain)
        } catch {
          try {
            this.demoAudioBus.disconnect()
            this.isDemoBusConnectedToMonitoring = false
            if (this.localMonitoringGain && typeof this.demoAudioBus.connect === 'function') {
              this.demoAudioBus.connect(this.localMonitoringGain)
              this.isDemoBusConnectedToMonitoring = true
            }
          } catch {
            // Ignore
          }
        }
      }
      this.videoToVirtualMicGain?.disconnect()
      this.virtualMicMasterNode?.disconnect()
      if (this.audioWorkletNode) {
        if (this.audioWorkletNode.port) {
          this.audioWorkletNode.port.onmessage = null
          if (typeof this.audioWorkletNode.port.close === 'function') {
            this.audioWorkletNode.port.close()
          }
        }
        this.audioWorkletNode.disconnect()
      }
      if (this.scriptProcessorNode && 'onaudioprocess' in this.scriptProcessorNode) {
        ;(this.scriptProcessorNode as ScriptProcessorNode).onaudioprocess = null
        this.scriptProcessorNode.disconnect()
      }
      this.zeroGainNode?.disconnect()
    } catch {
      // Ignore disconnect errors
    }

    if (this.audioWorkletBlobUrl) {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        try {
          URL.revokeObjectURL(this.audioWorkletBlobUrl)
        } catch {
          // Ignore in environments where revokeObjectURL is not supported
        }
      }
      this.audioWorkletBlobUrl = null
    }

    this.micStream = null
    this.micSourceNode = null
    this.micGainNode = null
    this.mediaStreamSourceNode = null
    // Keep this.customAudioSourceNode and this.videoSourceNode references if attached so buildAudioGraph() can re-wire them
    this.videoToVirtualMicGain = null
    this.virtualMicMasterNode = null
    this.audioWorkletNode = null
    this.scriptProcessorNode = null
    this.zeroGainNode = null

    // Ensure persistent demoAudioBus remains connected to localMonitoringGain at 1.0 volume for editor playback
    if (this.localMonitoringGain) {
      const time = this.audioContext?.currentTime ?? 0
      if (typeof this.localMonitoringGain.gain.setValueAtTime === 'function') {
        this.localMonitoringGain.gain.setValueAtTime(1.0, time)
      } else {
        this.localMonitoringGain.gain.value = 1.0
      }
    }
  }

  /**
   * Applies Instant Auto-Return rules to the Dual-Output Audio Graph:
   * - When isPlaying: Video plays to virtual mic AND local speakers; physical mic is muted.
   * - When paused: Video audio is 0; physical mic is unmuted (unless user muted mic).
   * - When inactive (!this.active): Video audio to local monitoring is 1.0 so normal editor playback works.
   * Uses exponential cross-fade transitions (15ms) via setTargetAtTime to prevent clicks.
   */
  private applyInstantAutoReturn(): void {
    const time = this.audioContext?.currentTime ?? 0
    const timeConstant = 0.015

    const setParam = (node: GainNode | null, targetVal: number) => {
      if (!node) return
      if (typeof node.gain.setTargetAtTime === 'function') {
        node.gain.setTargetAtTime(targetVal, time, timeConstant)
      } else if (typeof node.gain.setValueAtTime === 'function') {
        node.gain.setValueAtTime(targetVal, time)
      } else {
        node.gain.value = targetVal
      }
    }

    if (!this.active) {
      // Virtual Studio inactive: videoToVirtualMicGain is muted (0.0), localMonitoringGain is 1.0
      // so normal editor playback remains 100% audible when Virtual Studio is stopped!
      setParam(this.videoToVirtualMicGain, 0.0)
      setParam(this.localMonitoringGain, 1.0)
      setParam(this.micGainNode, 0.0)
      return
    }

    if (this.isPlaying) {
      // 1. Video audio to virtual mic is LIVE
      setParam(this.videoToVirtualMicGain, 1.0)

      // 2. Video audio to local monitoring speakers is LIVE
      const monitorVol = this.isLocalAudioMonitoringEnabled ? this.localMonitoringVolume : 0.0
      setParam(this.localMonitoringGain, monitorVol)

      // 3. Default-muted during demo video unless user explicitly clicked unmute:
      const micActive = this.playbackMicUnmuted && !this.isMicMuted
      setParam(this.micGainNode, micActive ? 1.0 : 0.0)
    } else {
      // 1. Video audio to virtual mic is MUTED
      setParam(this.videoToVirtualMicGain, 0.0)

      // 2. Video audio to local monitoring is MUTED
      setParam(this.localMonitoringGain, 0.0)

      // 3. Physical mic is UNMUTED (unless manual mic mute is active)
      setParam(this.micGainNode, this.isMicMuted ? 0.0 : 1.0)
    }
  }

  private interleaveFloatTo16BitPCM(left: Float32Array, right: Float32Array): Uint8Array {
    const length = left.length
    const pcm16 = new Int16Array(length * 2)
    for (let i = 0; i < length; i++) {
      const sL = Math.max(-1, Math.min(1, left[i]))
      pcm16[i * 2] = sL < 0 ? sL * 0x8000 : sL * 0x7fff
      const sR = Math.max(-1, Math.min(1, right[i]))
      pcm16[i * 2 + 1] = sR < 0 ? sR * 0x8000 : sR * 0x7fff
    }
    return new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength)
  }

  // --- Internal Video & Device Engine ---

  private async startWebcam(): Promise<void> {
    if (!this.mediaDevices?.getUserMedia) return

    try {
      if (this.webcamStream) {
        this.webcamStream.getTracks().forEach((track) => track.stop())
        this.webcamStream = null
      }

      const constraints: MediaStreamConstraints = {
        video: this.selectedCameraId
          ? { deviceId: { exact: this.selectedCameraId } }
          : { width: { ideal: this.outputResolution.width }, height: { ideal: this.outputResolution.height } },
      }

      this.webcamStream = await this.mediaDevices.getUserMedia(constraints)

      if (!this.webcamVideo) {
        this.webcamVideo = this.createVideo()
        this.webcamVideo.muted = true
        this.webcamVideo.playsInline = true
      }
      this.webcamVideo.srcObject = this.webcamStream
      await this.webcamVideo.play().catch(() => {})
    } catch (err) {
      console.warn('[VirtualStudioStreamer] Failed to capture physical webcam:', err)
    }
  }

  private async startMicrophone(): Promise<void> {
    if (!this.mediaDevices?.getUserMedia || !this.audioContext) return

    try {
      if (this.micStream) {
        this.micStream.getTracks().forEach((track) => track.stop())
        this.micStream = null
      }

      const constraints: MediaStreamConstraints = {
        audio: this.selectedMicId ? { deviceId: { exact: this.selectedMicId } } : true,
      }

      this.micStream = await this.mediaDevices.getUserMedia(constraints)
      this.micSourceNode = this.audioContext.createMediaStreamSource(this.micStream)
      if (this.micGainNode) {
        this.micSourceNode.connect(this.micGainNode)
      }
    } catch (err) {
      console.warn('[VirtualStudioStreamer] Failed to capture physical microphone:', err)
    }
  }

  private stopWebcam(): void {
    if (this.webcamStream) {
      this.webcamStream.getTracks().forEach((track) => track.stop())
      this.webcamStream = null
    }
    if (this.webcamVideo) {
      this.webcamVideo.srcObject = null
      this.webcamVideo = null
    }
  }

  private stopMicrophone(): void {
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop())
      this.micStream = null
    }
    if (this.micSourceNode) {
      try {
        this.micSourceNode.disconnect()
      } catch {
        // Ignore disconnect errors
      }
      this.micSourceNode = null
    }
  }

  private startFrameLoop(): void {
    this.stopFrameLoop()
    if (this.activeSource === 'canvas') {
      return
    }

    const fps =
      Number.isFinite(this.outputResolution.fps) && this.outputResolution.fps > 0 ? this.outputResolution.fps : 30
    const frameInterval = 1000 / fps
    this.nextFrameTime = performance.now() + frameInterval

    const scheduleNext = () => {
      if (!this.active || this.activeSource === 'canvas') return
      this.captureTick()

      this.nextFrameTime += frameInterval
      const now = performance.now()
      if (now - this.nextFrameTime > frameInterval * 2) {
        this.nextFrameTime = now + frameInterval
      }

      const delay = Math.max(0, this.nextFrameTime - performance.now())
      this.frameTimer = setTimeout(scheduleNext, delay)
    }

    const initialDelay = Math.max(0, Math.round(frameInterval))
    this.frameTimer = setTimeout(scheduleNext, initialDelay)
  }

  private stopFrameLoop(): void {
    if (this.frameTimer) {
      clearTimeout(this.frameTimer)
      this.frameTimer = null
    }
  }

  private drawSourceCanvasAspectFit(width: number, height: number): void {
    if (!this.scratchCtx) return
    if (this.sourceCanvas && this.sourceCanvas.width > 0 && this.sourceCanvas.height > 0) {
      try {
        const cw = this.sourceCanvas.width
        const ch = this.sourceCanvas.height

        if (cw === width && ch === height) {
          // Native 1080p 1:1 canvas extraction without 0.6667x fractional scaling downsample blur.
          // Direct draw without redundant fillRect when dimensions match exactly.
          this.scratchCtx.drawImage(this.sourceCanvas, 0, 0, width, height)
          return
        }

        const scale = Math.min(width / cw, height / ch)
        const dw = cw * scale
        const dh = ch * scale
        const dx = (width - dw) / 2
        const dy = (height - dh) / 2

        this.scratchCtx.fillStyle = DEFAULT_VIRTUAL_STUDIO_FALLBACK_COLOR
        this.scratchCtx.fillRect(0, 0, width, height)
        this.scratchCtx.drawImage(this.sourceCanvas, dx, dy, dw, dh)
      } catch {
        this.scratchCtx.fillStyle = DEFAULT_VIRTUAL_STUDIO_FALLBACK_COLOR
        this.scratchCtx.fillRect(0, 0, width, height)
      }
    } else {
      this.scratchCtx.fillStyle = DEFAULT_VIRTUAL_STUDIO_FALLBACK_COLOR
      this.scratchCtx.fillRect(0, 0, width, height)
    }
  }

  /**
   * Captures a single frame from the active source and delivers to the virtual camera sink.
   */
  public captureTick(timestamp?: number): void {
    if (!this.active || !this.scratchCanvas || !this.scratchCtx) return

    const { width, height } = this.outputResolution
    if (width <= 0 || height <= 0) return

    this.scratchCtx.imageSmoothingEnabled = true
    this.scratchCtx.imageSmoothingQuality = 'high'

    if (this.isMirrored && typeof this.scratchCtx.save === 'function') {
      this.scratchCtx.save()
      this.scratchCtx.translate(width, 0)
      this.scratchCtx.scale(-1, 1)
    }

    try {
      if (this.activeSource === 'canvas') {
        this.drawSourceCanvasAspectFit(width, height)
      } else {
        // Physical Webcam Mode with Last-Frame Hold Fallback
        if (this.webcamVideo && this.webcamVideo.videoWidth > 0 && this.webcamVideo.videoHeight > 0) {
          try {
            const vw = this.webcamVideo.videoWidth
            const vh = this.webcamVideo.videoHeight
            const scale = Math.max(width / vw, height / vh)
            const dw = vw * scale
            const dh = vh * scale
            const dx = (width - dw) / 2
            const dy = (height - dh) / 2
            this.scratchCtx.drawImage(this.webcamVideo, dx, dy, dw, dh)
          } catch {
            this.drawSourceCanvasAspectFit(width, height)
          }
        } else {
          this.drawSourceCanvasAspectFit(width, height)
        }
      }
    } finally {
      if (this.isMirrored && typeof this.scratchCtx.restore === 'function') {
        this.scratchCtx.restore()
      }
    }

    try {
      // Extract frame pixels and push directly without redundant memcpy
      const imgData = this.scratchCtx.getImageData(0, 0, width, height)
      this.ipcBridge.pushFrame({
        data: new Uint8Array(imgData.data.buffer),
        width,
        height,
        format: 'rgba',
        timestamp: timestamp ?? performance.now(),
      })
    } catch (err) {
      console.warn('[VirtualStudioStreamer] Error extracting or pushing frame:', err)
    }

    // Broadcast live thumbnail frame to IPC for the standalone desktop Mini-HUD window.
    // Rendered into cached 320x180 thumbnail canvas to reduce JPEG compression overhead by 36x (<0.5ms) and eliminate UI stutter.
    // Only generate and push Mini-HUD preview thumbnails if Mini-HUD is active/listening.
    const isHudActive = this.isMiniHudVisible || this.previewListeners.size > 0
    if (isHudActive) {
      const now = performance.now()
      if (this.lastThumbnailTime < 0 || now - this.lastThumbnailTime >= 350) {
        this.lastThumbnailTime = now
        try {
          if (!this.hudThumbnailCanvas) {
            this.hudThumbnailCanvas = this.createCanvas()
            this.hudThumbnailCanvas.width = 320
            this.hudThumbnailCanvas.height = 180
            this.hudThumbnailCtx = this.hudThumbnailCanvas.getContext?.('2d') ?? null
          }
          if (this.hudThumbnailCtx && typeof this.hudThumbnailCtx.drawImage === 'function') {
            this.hudThumbnailCtx.drawImage(this.scratchCanvas, 0, 0, 320, 180)
            if (typeof this.hudThumbnailCanvas.toDataURL === 'function') {
              const thumbnail = this.hudThumbnailCanvas.toDataURL('image/jpeg', 0.5)
              this.ipcBridge.pushPreviewFrame?.(thumbnail)
            }
          } else if (typeof this.scratchCanvas.toDataURL === 'function') {
            const thumbnail = this.scratchCanvas.toDataURL('image/jpeg', 0.5)
            this.ipcBridge.pushPreviewFrame?.(thumbnail)
          }
        } catch {
          // Ignore canvas read/data URL errors
        }
      }
    }

    // Notify preview thumbnail listeners (Mini-HUD)
    for (const listener of this.previewListeners) {
      try {
        listener(this.scratchCanvas)
      } catch (err) {
        console.warn('[VirtualStudioStreamer] Error in preview listener:', err)
      }
    }
  }

  /**
   * Synchronizes streamer state automatically with the Zustand editor store and System Tray events.
   */
  public syncWithStore(): () => void {
    const unsubStore = useEditorStore.subscribe((state, prevState) => {
      if (state.isPlaying !== prevState.isPlaying) {
        this.setPlaying(state.isPlaying)
      }
      if (state.isMicMuted !== prevState.isMicMuted) {
        this.setMicMuted(state.isMicMuted)
      }
      if (state.localMonitoringVolume !== prevState.localMonitoringVolume) {
        this.setLocalMonitoringVolume(state.localMonitoringVolume)
      }
      if (state.isLocalAudioMonitoringEnabled !== prevState.isLocalAudioMonitoringEnabled) {
        this.setLocalAudioMonitoringEnabled(state.isLocalAudioMonitoringEnabled)
      }
      if (state.enableCamera !== prevState.enableCamera) {
        void this.setEnableCamera(state.enableCamera)
      }
      if (state.enableMic !== prevState.enableMic) {
        void this.setEnableMic(state.enableMic)
      }
      if (state.selectedCameraId !== prevState.selectedCameraId) {
        void this.setSelectedCamera(state.selectedCameraId)
      }
      if (state.selectedMicId !== prevState.selectedMicId) {
        void this.setSelectedMic(state.selectedMicId)
      }
      const stateAny = state as unknown as { isMirrored?: boolean; isMiniHudVisible?: boolean }
      const prevStateAny = prevState as unknown as { isMirrored?: boolean; isMiniHudVisible?: boolean }
      if (stateAny.isMirrored !== undefined && stateAny.isMirrored !== prevStateAny.isMirrored) {
        this.setMirrored(stateAny.isMirrored)
      }
      if (stateAny.isMiniHudVisible !== undefined && stateAny.isMiniHudVisible !== prevStateAny.isMiniHudVisible) {
        this.setMiniHudVisible(stateAny.isMiniHudVisible)
      }
      if (state.isVirtualStudioActive !== prevState.isVirtualStudioActive) {
        if (state.isVirtualStudioActive) {
          void this.start({
            enableCamera: state.enableCamera,
            enableMic: state.enableMic,
            selectedWebcamId: state.selectedCameraId ?? undefined,
            selectedMicId: state.selectedMicId ?? undefined,
            enableLocalAudioMonitoring: state.isLocalAudioMonitoringEnabled,
            localMonitoringVolume: state.localMonitoringVolume,
            isMirrored: stateAny.isMirrored ?? false,
            isMiniHudVisible: stateAny.isMiniHudVisible ?? true,
          } as Partial<VirtualStudioConfig>)
        } else {
          void this.stop()
        }
      }
    })

    const unsubTray = this.ipcBridge.onTrayAction?.((action) => {
      useEditorStore.getState().handleTrayAction(action)
    })

    const unsubStatus = this.ipcBridge.onStatusChange?.((status) => {
      useEditorStore.getState().setVirtualStudioStatus(status)
      if (status.isMiniHudVisible !== undefined) {
        this.setMiniHudVisible(status.isMiniHudVisible)
      }
    })

    return () => {
      unsubStore()
      unsubTray?.()
      unsubStatus?.()
    }
  }
}

export const virtualStudioStreamer = new VirtualStudioStreamer()
