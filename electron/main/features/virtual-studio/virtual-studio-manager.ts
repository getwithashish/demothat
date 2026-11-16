import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import type {
  VirtualStudioConfig,
  VirtualStudioStatus,
  VirtualFramePayload,
  TrayQuickAction,
  VirtualStudioActionResult,
} from '../../../../shared/virtual-camera-types'
import { checkVirtualDrivers, installVirtualDrivers } from './driver-setup'
import { virtualCameraSink, VirtualCameraSink } from './virtual-camera-sink'
import { virtualAudioSink, VirtualAudioSink } from './virtual-audio-sink'
import { virtualStudioTray, VirtualStudioTray } from './virtual-studio-tray'

export class VirtualStudioManager {
  private status: VirtualStudioStatus = {
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
    isMiniHudVisible: true,
    error: null,
  }

  private config: VirtualStudioConfig | null = null

  constructor(
    private cameraSink: VirtualCameraSink = virtualCameraSink,
    private audioSink: VirtualAudioSink = virtualAudioSink,
    private tray: VirtualStudioTray = virtualStudioTray,
  ) {}

  public getConfig(): VirtualStudioConfig | null {
    return this.config
  }

  /**
   * Returns current studio status and refreshes driver detection.
   */
  public async getStatus(): Promise<VirtualStudioStatus> {
    try {
      const driverResult = await checkVirtualDrivers()
      this.status.cameraDriverInstalled = driverResult.cameraDriverInstalled
      this.status.micDriverInstalled = driverResult.micDriverInstalled
    } catch (err: unknown) {
      log.warn('[VirtualStudioManager] Error checking drivers during getStatus:', err)
    }

    return { ...this.status }
  }

  /**
   * Triggers 1-click driver installation for host OS.
   */
  public async installDriver(): Promise<VirtualStudioActionResult> {
    log.info('[VirtualStudioManager] Installing virtual camera/mic drivers')
    try {
      const res = await installVirtualDrivers()
      const driverResult = await checkVirtualDrivers()
      this.status.cameraDriverInstalled = driverResult.cameraDriverInstalled
      this.status.micDriverInstalled = driverResult.micDriverInstalled

      this.broadcastStatus()
      return res
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err)
      log.error('[VirtualStudioManager] Driver installation error:', error)
      return { success: false, error }
    }
  }

  /**
   * Starts virtual studio streaming and initializes persistent system tray.
   */
  public async start(config: VirtualStudioConfig): Promise<VirtualStudioActionResult> {
    log.info('[VirtualStudioManager] Starting Virtual Studio with config:', config)
    this.config = config

    try {
      // 1. Verify driver status
      const driverCheck = await checkVirtualDrivers()
      this.status.cameraDriverInstalled = driverCheck.cameraDriverInstalled
      this.status.micDriverInstalled = driverCheck.micDriverInstalled

      // 2. Start Camera Sink if enabled
      if (config.enableCamera) {
        const camRes = await this.cameraSink.start({
          width: config.outputResolution.width,
          height: config.outputResolution.height,
          fps: config.outputResolution.fps,
        })
        if (!camRes.success) {
          log.warn('[VirtualStudioManager] Camera sink start warning:', camRes.error)
        }
      }

      // 3. Start Audio Sink if enabled
      if (config.enableMic) {
        const audioRes = await this.audioSink.start()
        if (!audioRes.success) {
          log.warn('[VirtualStudioManager] Audio sink start warning:', audioRes.error)
        }
      }

      // 4. Initialize persistent System Tray
      this.tray.init({
        onAction: (action) => this.handleTrayAction(action),
      })

      // 5. Update state
      this.status.isStreaming = true
      this.status.isCameraActive = config.enableCamera
      this.status.isMicActive = config.enableMic
      this.status.webcamDeviceId = config.selectedWebcamId ?? null
      this.status.micDeviceId = config.selectedMicId ?? null
      this.status.isLocalAudioMonitoringEnabled = config.enableLocalAudioMonitoring
      this.status.localMonitoringVolume = config.localMonitoringVolume
      this.status.activeSource = 'webcam'
      this.status.isPlaying = false
      this.status.isMicMuted = false
      this.status.error = null

      this.tray.updateState(this.status)
      this.broadcastStatus()

      return { success: true }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err)
      this.status.error = error
      this.broadcastStatus()
      return { success: false, error }
    }
  }

  /**
   * Stops virtual studio streaming and destroys tray.
   */
  public async stop(): Promise<VirtualStudioActionResult> {
    log.info('[VirtualStudioManager] Stopping Virtual Studio')

    try {
      await this.cameraSink.stop()
      await this.audioSink.stop()
      this.tray.destroy()

      this.status.isStreaming = false
      this.status.isCameraActive = false
      this.status.isMicActive = false
      this.status.isPlaying = false
      this.status.activeSource = 'webcam'
      this.status.error = null

      this.broadcastStatus()
      return { success: true }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err)
      return { success: false, error }
    }
  }

  /**
   * Feeds video frames directly into camera sink.
   */
  public async pushFrame(payload: VirtualFramePayload): Promise<VirtualStudioActionResult> {
    if (!this.status.isStreaming) {
      return { success: false, error: 'Virtual Studio is not streaming' }
    }

    const ok = await this.cameraSink.pushFrame(payload)
    return { success: ok }
  }

  /**
   * Feeds audio chunks into microphone sink.
   */
  public async pushAudio(buffer: Uint8Array | ArrayBuffer | Buffer): Promise<VirtualStudioActionResult> {
    if (!this.status.isStreaming) {
      return { success: false, error: 'Virtual Studio is not streaming' }
    }

    const ok = await this.audioSink.pushAudio(buffer)
    return { success: ok }
  }

  /**
   * Triggers a quick action from System Tray or UI.
   */
  public async triggerAction(action: TrayQuickAction): Promise<VirtualStudioActionResult> {
    log.info(`[VirtualStudioManager] triggerAction: ${action}`)
    this.handleTrayAction(action)
    return { success: true }
  }

  /**
   * Synchronizes status updates from renderer (such as isPlaying, activeSource, or isMicMuted).
   */
  public updateStatus(patch: Partial<VirtualStudioStatus>): void {
    this.status = { ...this.status, ...patch }

    if (patch.isMicMuted !== undefined) {
      this.audioSink.setMuted(patch.isMicMuted)
    }

    this.tray.updateState(this.status)
    this.broadcastStatus()
  }

  /**
   * Handles actions coming from Tray 1-click interactions or context menu.
   */
  public handleTrayAction(action: TrayQuickAction): void {
    log.info(`[VirtualStudioManager] Handling tray action: ${action}`)

    switch (action) {
      case 'toggle-playback': {
        const nextPlaying = !this.status.isPlaying
        this.status.isPlaying = nextPlaying
        this.status.activeSource = nextPlaying ? 'canvas' : 'webcam'
        this.tray.updateState(this.status)
        this.broadcastAction(action)
        this.broadcastStatus()
        break
      }
      case 'toggle-mic-mute': {
        const nextMuted = !this.status.isMicMuted
        this.status.isMicMuted = nextMuted
        this.audioSink.setMuted(nextMuted)
        this.tray.updateState(this.status)
        this.broadcastAction(action)
        this.broadcastStatus()
        break
      }
      case 'toggle-hud': {
        const nextHud = !(this.status.isMiniHudVisible ?? true)
        this.status.isMiniHudVisible = nextHud
        this.tray.updateState(this.status)
        this.broadcastAction(action)
        this.broadcastStatus()
        break
      }
      case 'stop-studio': {
        void this.stop()
        this.broadcastAction(action)
        break
      }
    }
  }

  private broadcastStatus(): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('virtual-studio:status-changed', { ...this.status })
      }
    }
  }

  private broadcastAction(action: TrayQuickAction): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('virtual-studio:tray-action', action)
      }
    }
  }
}

export const virtualStudioManager = new VirtualStudioManager()
