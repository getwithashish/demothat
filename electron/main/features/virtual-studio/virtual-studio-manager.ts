import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import type {
  VirtualStudioConfig,
  VirtualStudioStatus,
  VirtualFramePayload,
  TrayQuickAction,
  VirtualStudioActionResult,
} from '../../../../shared/virtual-camera-types'
import { DEFAULT_VIRTUAL_STUDIO_RESOLUTION } from '../../../../shared/virtual-camera-types'
import {
  checkVirtualDrivers,
  installVirtualDrivers,
  ensureLinuxCameraDriver,
  ensureLinuxAudioSink,
  teardownLinuxCameraDriver,
  teardownLinuxAudioSink,
} from './driver-setup'
import { virtualCameraSink, VirtualCameraSink } from './virtual-camera-sink'
import { virtualAudioSink, VirtualAudioSink } from './virtual-audio-sink'
import { virtualStudioTray, VirtualStudioTray } from './virtual-studio-tray'
import { showHudWindow, hideHudWindow, destroyHudWindow } from '../../windows/hud-window'

export class VirtualStudioManager {
  private status: VirtualStudioStatus = {
    cameraDriverInstalled: false,
    micDriverInstalled: false,
    isStreaming: false,
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

    // Idempotent guard: if already streaming, update config and delegate to updateStatus to prevent sink restart race
    if (this.status.isStreaming) {
      log.info('[VirtualStudioManager] Virtual Studio is already streaming; updating config without tearing down sinks')
      this.config = config
      await this.updateStatus({
        isCameraActive: config.enableCamera,
        isMicActive: config.enableMic,
        webcamDeviceId: config.selectedWebcamId ?? null,
        micDeviceId: config.selectedMicId ?? null,
        isLocalAudioMonitoringEnabled: config.enableLocalAudioMonitoring,
        localMonitoringVolume: config.localMonitoringVolume,
        isMirrored: config.isMirrored ?? this.status.isMirrored,
      })
      return { success: true }
    }

    this.config = config

    try {
      // 1. Verify/ensure driver status
      if (process.platform === 'linux') {
        await ensureLinuxCameraDriver()
        await ensureLinuxAudioSink()
      }
      const driverCheck = await checkVirtualDrivers()
      this.status.cameraDriverInstalled = driverCheck.cameraDriverInstalled
      this.status.micDriverInstalled = driverCheck.micDriverInstalled

      // 2. Start Camera Sink if enabled
      if (config.enableCamera) {
        const camRes = await this.cameraSink.start({
          width: config.outputResolution?.width || DEFAULT_VIRTUAL_STUDIO_RESOLUTION.width,
          height: config.outputResolution?.height || DEFAULT_VIRTUAL_STUDIO_RESOLUTION.height,
          fps: config.outputResolution?.fps || DEFAULT_VIRTUAL_STUDIO_RESOLUTION.fps,
          inputWidth: config.inputResolution?.width,
          inputHeight: config.inputResolution?.height,
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
      this.status.isMirrored = config.isMirrored ?? this.status.isMirrored ?? false
      this.status.activeSource = 'webcam'
      this.status.isPlaying = false
      this.status.isMicMuted = false
      this.status.error = null

      if (this.status.isMiniHudVisible !== false) {
        showHudWindow()
      }

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
      await this.cameraSink.stop({ fallbackToStandby: false })
      await this.audioSink.stop()
      this.tray.destroy()
      hideHudWindow()

      this.status.isStreaming = false
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
   * Complete lifecycle cleanup invoked on application quit.
   * Stops sinks, closes overlay windows, and dynamically unloads OS virtual devices.
   */
  public async cleanupOnExit(): Promise<void> {
    log.info('[VirtualStudioManager] Executing application exit cleanup')
    try {
      await this.cameraSink.stop({ fallbackToStandby: false })
      await this.audioSink.stop()
      this.tray.destroy()
      destroyHudWindow()

      this.status.isStreaming = false
      this.status.isPlaying = false

      if (process.platform === 'linux') {
        await teardownLinuxCameraDriver()
        await teardownLinuxAudioSink()
      }
    } catch (err: unknown) {
      log.warn('[VirtualStudioManager] Error during cleanupOnExit:', err)
    }
  }

  /**
   * Feeds video frames directly into camera sink.
   */
  public async pushFrame(payload: VirtualFramePayload): Promise<VirtualStudioActionResult> {
    if (!this.status.isStreaming) {
      return { success: false, error: 'Virtual Studio is not streaming' }
    }
    if (!payload || !payload.data) {
      return { success: false, error: 'Invalid frame payload' }
    }

    try {
      const ok = await this.cameraSink.pushFrame(payload)
      return { success: ok }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err)
      log.warn('[VirtualStudioManager] pushFrame error:', error)
      return { success: false, error }
    }
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
   * Forwards live thumbnail preview frame (Base64 data URL) to floating Mini-HUD overlay window.
   */
  public pushPreviewFrame(dataUrl: string): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('virtual-studio:preview-frame', dataUrl)
      }
    }
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
   * Synchronizes status updates from renderer and dynamically starts/stops sinks.
   */
  public async updateStatus(patch: Partial<VirtualStudioStatus>): Promise<void> {
    const prevCameraActive = this.status.isCameraActive
    const prevMicActive = this.status.isMicActive

    this.status = { ...this.status, ...patch }

    // Dynamic start/stop when streaming
    if (this.status.isStreaming) {
      if (patch.isCameraActive !== undefined && patch.isCameraActive !== prevCameraActive) {
        if (patch.isCameraActive) {
          log.info('[VirtualStudioManager] Dynamically starting camera sink while streaming')
          await this.cameraSink.start({
            width: this.config?.outputResolution?.width || DEFAULT_VIRTUAL_STUDIO_RESOLUTION.width,
            height: this.config?.outputResolution?.height || DEFAULT_VIRTUAL_STUDIO_RESOLUTION.height,
            fps: this.config?.outputResolution?.fps || DEFAULT_VIRTUAL_STUDIO_RESOLUTION.fps,
            inputWidth: this.config?.inputResolution?.width,
            inputHeight: this.config?.inputResolution?.height,
          })
        } else {
          log.info('[VirtualStudioManager] Dynamically stopping camera sink while streaming')
          await this.cameraSink.stop()
        }
      }

      if (patch.isMicActive !== undefined && patch.isMicActive !== prevMicActive) {
        if (patch.isMicActive) {
          log.info('[VirtualStudioManager] Dynamically starting audio sink while streaming')
          await this.audioSink.start()
        } else {
          log.info('[VirtualStudioManager] Dynamically stopping audio sink while streaming')
          await this.audioSink.stop()
        }
      }
    }

    if (patch.isMiniHudVisible !== undefined) {
      if (patch.isMiniHudVisible) {
        showHudWindow()
      } else {
        hideHudWindow()
      }
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
        this.tray.updateState(this.status)
        this.broadcastAction(action)
        this.broadcastStatus()
        break
      }
      case 'toggle-mirror': {
        const nextMirrored = !this.status.isMirrored
        this.status.isMirrored = nextMirrored
        this.tray.updateState(this.status)
        this.broadcastAction(action)
        this.broadcastStatus()
        break
      }
      case 'toggle-audio-monitor': {
        const nextMonitor = !this.status.isLocalAudioMonitoringEnabled
        this.status.isLocalAudioMonitoringEnabled = nextMonitor
        this.tray.updateState(this.status)
        this.broadcastAction(action)
        this.broadcastStatus()
        break
      }
      case 'toggle-hud': {
        const nextHud = !(this.status.isMiniHudVisible ?? true)
        this.status.isMiniHudVisible = nextHud
        if (nextHud) {
          showHudWindow()
        } else {
          hideHudWindow()
        }
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
