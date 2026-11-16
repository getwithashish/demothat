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

export interface VirtualStudioIPC {
  getStatus: () => Promise<VirtualStudioStatus>
  installDriver: () => Promise<VirtualStudioActionResult>
  start: (config: VirtualStudioConfig) => Promise<VirtualStudioActionResult>
  stop: () => Promise<VirtualStudioActionResult>
  pushFrame: (payload: VirtualFramePayload) => Promise<VirtualStudioActionResult>
  pushAudio: (buffer: Uint8Array | ArrayBuffer) => Promise<VirtualStudioActionResult>
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
  pushFrame: (payload: VirtualFramePayload) =>
    getVirtualStudioAPI()?.pushFrame(payload) ?? Promise.resolve({ success: true }),
  pushAudio: (buffer: Uint8Array | ArrayBuffer) =>
    getVirtualStudioAPI()?.pushAudio(buffer) ?? Promise.resolve({ success: true }),
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
  private lastThumbnailTime = 0
  private isPushingFrame = false

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
  private frameTimer: ReturnType<typeof setInterval> | null = null
  private previewListeners: Set<PreviewFrameCallback> = new Set()

  // Dual-Output Audio Graph State
  private micStream: MediaStream | null = null
  private micSourceNode: MediaStreamAudioSourceNode | AudioNode | null = null
  private micGainNode: GainNode | null = null
  private videoSourceNode: MediaElementAudioSourceNode | MediaStreamAudioSourceNode | AudioNode | null = null
  private mediaStreamSourceNode: MediaStreamAudioSourceNode | AudioNode | null = null
  private attachedMediaStream: MediaStream | null = null
  private videoElement: HTMLMediaElement | null = null
  private videoToVirtualMicGain: GainNode | null = null
  private localMonitoringGain: GainNode | null = null
  private virtualMicMasterNode: GainNode | null = null
  private scriptProcessorNode: ScriptProcessorNode | AudioNode | null = null
  private zeroGainNode: GainNode | null = null
  private elementSourceMap: WeakMap<HTMLMediaElement, MediaElementAudioSourceNode> = new WeakMap()

  constructor(deps: StreamerDependencies = {}) {
    this.audioContext = deps.audioContext ?? null
    this.mediaDevices = deps.mediaDevices ?? (typeof navigator !== 'undefined' ? navigator.mediaDevices : null)
    this.ipcBridge = deps.ipcBridge ?? defaultIpcBridge
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
   * Attaches video element for audio extraction into the Dual-Output Audio Graph.
   */
  public attachVideoElement(video: HTMLMediaElement): void {
    this.videoElement = video
    if (this.attachedMediaStream) {
      // Multi-track mixer stream takes precedence over raw video element
      return
    }
    if (!this.audioContext) {
      this.initAudioContext()
    }
    if (!this.audioContext) return

    try {
      let sourceNode = this.elementSourceMap.get(video)
      if (!sourceNode) {
        sourceNode = this.audioContext.createMediaElementSource(video)
        this.elementSourceMap.set(video, sourceNode)
      }
      this.attachAudioSource(sourceNode)
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
        this.mediaStreamSourceNode = null
      }
      const sourceNode = this.audioContext.createMediaStreamSource(stream)
      this.mediaStreamSourceNode = sourceNode
      this.attachAudioSource(sourceNode)
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
      this.mediaStreamSourceNode = null
    }
    if (this.videoElement) {
      this.attachVideoElement(this.videoElement)
    } else {
      this.detachVideoElement()
    }
  }

  /**
   * Attaches an AudioNode or MediaStream to the Dual-Output Audio Graph.
   */
  public attachAudioSource(source: AudioNode): void {
    if (!this.audioContext) {
      this.initAudioContext()
    }
    if (this.videoSourceNode && this.videoSourceNode !== source) {
      try {
        this.videoSourceNode.disconnect()
      } catch {
        // Ignore disconnect errors
      }
    }
    this.videoSourceNode = source
    this.wireVideoAudioGraph()
  }

  public detachVideoElement(): void {
    this.videoElement = null
    if (this.videoSourceNode) {
      try {
        this.videoSourceNode.disconnect()
      } catch {
        // Disconnect can throw if already disconnected
      }
      this.videoSourceNode = null
    }
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
    const configAny = config as unknown as { isMirrored?: boolean }
    if (configAny.isMirrored !== undefined) {
      this.isMirrored = configAny.isMirrored
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

    // Initialize Audio Graph
    this.initAudioContext()
    this.buildAudioGraph()

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

    this.applyInstantAutoReturn()

    // Synchronize status with main process
    this.ipcBridge.updateStatus({
      isPlaying: this.isPlaying,
      activeSource: this.activeSource,
      isMicMuted: this.isMicMuted,
    })

    // Immediately trigger a frame render
    this.captureTick()
  }

  /**
   * Mutes or un-mutes the physical microphone.
   */
  public setMicMuted(muted: boolean): void {
    this.isMicMuted = muted
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

  private buildAudioGraph(): void {
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

      // 3. Video Audio to Virtual Mic Gain Node
      this.videoToVirtualMicGain = this.audioContext.createGain()
      this.videoToVirtualMicGain.gain.value = 0.0
      this.videoToVirtualMicGain.connect(this.virtualMicMasterNode)

      // 4. Video Audio Local Monitoring Gain Node -> local destination (speakers)
      this.localMonitoringGain = this.audioContext.createGain()
      this.localMonitoringGain.gain.value = 0.0
      this.localMonitoringGain.connect(this.audioContext.destination)

      // 5. Virtual Mic Sink Audio Processor Node (pushes PCM via IPC)
      if (typeof this.audioContext.createScriptProcessor === 'function') {
        const processor = this.audioContext.createScriptProcessor(4096, 2, 2)
        processor.onaudioprocess = (event: AudioProcessingEvent) => {
          if (!this.active) return
          const input = event.inputBuffer
          const left = input.getChannelData(0)
          const right = input.numberOfChannels > 1 ? input.getChannelData(1) : left

          const pcmBytes = this.interleaveFloatTo16BitPCM(left, right)
          void this.ipcBridge.pushAudio(pcmBytes)
        }
        this.scriptProcessorNode = processor
        this.virtualMicMasterNode.connect(processor)

        // Connect processor to destination through zero gain so Chromium schedules buffer callbacks
        this.zeroGainNode = this.audioContext.createGain()
        this.zeroGainNode.gain.value = 0.0
        processor.connect(this.zeroGainNode)
        this.zeroGainNode.connect(this.audioContext.destination)
      }

      this.wireVideoAudioGraph()
    } catch (err) {
      console.warn('[VirtualStudioStreamer] Error building Web Audio graph:', err)
    }
  }

  private wireVideoAudioGraph(): void {
    if (!this.videoSourceNode) return
    try {
      if (this.videoToVirtualMicGain) {
        this.videoSourceNode.connect(this.videoToVirtualMicGain)
      }
      if (this.localMonitoringGain) {
        this.videoSourceNode.connect(this.localMonitoringGain)
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
      this.videoSourceNode?.disconnect()
      this.videoToVirtualMicGain?.disconnect()
      this.localMonitoringGain?.disconnect()
      this.virtualMicMasterNode?.disconnect()
      if (this.scriptProcessorNode && 'onaudioprocess' in this.scriptProcessorNode) {
        ;(this.scriptProcessorNode as ScriptProcessorNode).onaudioprocess = null
        this.scriptProcessorNode.disconnect()
      }
      this.zeroGainNode?.disconnect()
    } catch {
      // Ignore disconnect errors
    }

    this.micStream = null
    this.micSourceNode = null
    this.micGainNode = null
    this.mediaStreamSourceNode = null
    this.attachedMediaStream = null
    this.videoSourceNode = null
    this.videoElement = null
    this.videoToVirtualMicGain = null
    this.localMonitoringGain = null
    this.virtualMicMasterNode = null
    this.scriptProcessorNode = null
    this.zeroGainNode = null
  }

  /**
   * Applies Instant Auto-Return rules to the Dual-Output Audio Graph:
   * - When isPlaying: Video plays to virtual mic AND local speakers; physical mic is muted.
   * - When paused: Video audio is 0; physical mic is unmuted (unless user muted mic).
   * Uses exponential cross-fade transitions (15ms) via setTargetAtTime to prevent clicks.
   */
  private applyInstantAutoReturn(): void {
    const time = this.audioContext?.currentTime ?? 0
    const timeConstant = 0.015

    const setParam = (node: GainNode | null, targetVal: number) => {
      if (!node) return
      if (typeof node.gain.setTargetAtTime === 'function') {
        node.gain.setTargetAtTime(targetVal, time, timeConstant)
      } else {
        node.gain.setValueAtTime(targetVal, time)
      }
    }

    if (this.isPlaying) {
      // 1. Video audio to virtual mic is LIVE
      setParam(this.videoToVirtualMicGain, 1.0)

      // 2. Video audio to local monitoring speakers is LIVE
      const monitorVol = this.isLocalAudioMonitoringEnabled ? this.localMonitoringVolume : 0.0
      setParam(this.localMonitoringGain, monitorVol)

      // 3. Physical mic is MUTED during playback
      setParam(this.micGainNode, 0.0)
    } else {
      // 1. Video audio to virtual mic is MUTED
      setParam(this.videoToVirtualMicGain, 0.0)

      // 2. Video audio to local monitoring is MUTED
      setParam(this.localMonitoringGain, 0.0)

      // 3. Physical mic is UNMUTED (unless manual mic mute is active)
      const micVol = this.isMicMuted ? 0.0 : 1.0
      setParam(this.micGainNode, micVol)
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
    const intervalMs = Math.round(1000 / (this.outputResolution.fps || 30))
    this.frameTimer = setInterval(() => {
      this.captureTick()
    }, intervalMs)
  }

  private stopFrameLoop(): void {
    if (this.frameTimer) {
      clearInterval(this.frameTimer)
      this.frameTimer = null
    }
  }

  private drawSourceCanvasAspectFit(width: number, height: number): void {
    if (!this.scratchCtx) return
    if (this.sourceCanvas && this.sourceCanvas.width > 0 && this.sourceCanvas.height > 0) {
      try {
        const cw = this.sourceCanvas.width
        const ch = this.sourceCanvas.height
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
  public captureTick(): void {
    if (!this.active || !this.scratchCanvas || !this.scratchCtx) return

    // Drop frame if previous IPC push is still in-flight, preventing IPC queue buildup
    if (this.isPushingFrame) {
      return
    }

    const { width, height } = this.outputResolution
    if (width <= 0 || height <= 0) return

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
      // Extract frame pixels
      const imgData = this.scratchCtx.getImageData(0, 0, width, height)
      this.isPushingFrame = true
      void this.ipcBridge
        .pushFrame({
          data: new Uint8Array(imgData.data.buffer, imgData.data.byteOffset, imgData.data.byteLength),
          width,
          height,
          format: 'rgba',
          timestamp: performance.now(),
        })
        .finally(() => {
          this.isPushingFrame = false
        })
    } catch (err) {
      this.isPushingFrame = false
      console.warn('[VirtualStudioStreamer] Error extracting or pushing frame:', err)
    }

    // Broadcast live thumbnail frame to IPC for the standalone desktop Mini-HUD window
    const now = performance.now()
    if (now - this.lastThumbnailTime >= 100) {
      this.lastThumbnailTime = now
      try {
        if (typeof this.scratchCanvas.toDataURL === 'function') {
          const thumbnail = this.scratchCanvas.toDataURL('image/jpeg', 0.5)
          this.ipcBridge.pushPreviewFrame?.(thumbnail)
        }
      } catch {
        // Ignore canvas read/data URL errors
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
      const stateAny = state as unknown as { isMirrored?: boolean }
      const prevStateAny = prevState as unknown as { isMirrored?: boolean }
      if (stateAny.isMirrored !== undefined && stateAny.isMirrored !== prevStateAny.isMirrored) {
        this.setMirrored(stateAny.isMirrored)
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
    })

    return () => {
      unsubStore()
      unsubTray?.()
      unsubStatus?.()
    }
  }
}

export const virtualStudioStreamer = new VirtualStudioStreamer()
