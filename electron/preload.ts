/* eslint-disable @typescript-eslint/no-explicit-any */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  ActivationResult,
  CheckoutStartResult,
  DeactivationResult,
  DeviceView,
  LicenseSummary,
  PurchaseEvent,
} from '../shared/license'
import type { Product } from '../shared/pricing'

// Define the type for the callback value
type RecordingResult = {
  canceled: boolean
  filePath: string | undefined
}

type ProjectPayload = {
  videoPath: string
  metadataPath: string
  webcamVideoPath?: string
}

type ExportPayload = {
  projectState: any
  exportSettings: any
  outputPath: string
}
// Payload received from process
type ProgressPayload = {
  progress: number // 0-100
  stage: string
  /** Cloud stages: percent within the stage, before the overall mapping. */
  stagePercent?: number
  framesDone?: number
  totalFrames?: number
  /** Credits held for this job (cloud). */
  reserved?: number
  /** Credits used so far, from the server (cloud). */
  consumed?: number
  etaSeconds?: number | null
  /** The server's minimum charge once GPU work has begun (cloud). */
  minChargeCredits?: number
}
// Payload when completed
type CompletePayload = {
  success: boolean
  outputPath?: string
  error?: string
  /** The server's settled numbers after a cloud export. */
  charge?: number
  refund?: number
  /** Why the cloud step ended, when it did not succeed. */
  cloudReason?: string
  /** The price the server quoted when it refused the job. */
  cost?: number
  /** Balance the server reported on a refusal. */
  balance?: number
  /** The local render, kept so a failed cloud step needs no second render. */
  intermediatePath?: string
  canRetryCloud?: boolean
  /** Everything a cloud retry needs (target size, fps, clip length). */
  cloudRetry?: { targetWidth: number; targetHeight: number; fps: number; durationSec: number }
}

// Payload for worker render
type RenderStartPayload = {
  projectState: any
  exportSettings: any
}

type WindowSource = {
  id: string
  name: string
  thumbnailUrl: string
  geometry?: {
    x: number
    y: number
    width: number
    height: number
  }
}

// --- Presets ---
type Preset = any

type DisplayInfo = {
  id: number
  name: string
  bounds: { x: number; y: number; width: number; height: number }
  isPrimary: boolean
}

// --- Update ---
type UpdateInfo = {
  version: string
  url: string
}

// --- Dshow Devices ---
type DshowDevice = {
  name: string
  alternativeName: string
}

// --- Cursor Theme ---
type CursorTheme = any

// Define API to be exposed to window object
export const electronAPI = {
  // --- Recording ---
  startRecording: (options: {
    source: 'area' | 'fullscreen' | 'window'
    geometry?: WindowSource['geometry']
    windowTitle?: string
    displayId?: number
    webcam?: { deviceId: string; deviceLabel: string; index: number }
    mic?: { deviceId: string; deviceLabel: string; index: number }
    systemAudio?: boolean
    /** Clean Demo Mode: hide the Dock, menu bar, other apps and desktop clutter while recording. */
    cleanDemo?: boolean
  }): Promise<RecordingResult> => ipcRenderer.invoke('recording:start', options),
  stopRecording: (): void => ipcRenderer.send('recording:stop'),
  loadVideoFromFile: (): Promise<RecordingResult> => ipcRenderer.invoke('recording:load-from-file'),

  // --- Interface zoom ---
  zoomIn: (): Promise<number> => ipcRenderer.invoke('window:zoom-in'),
  zoomOut: (): Promise<number> => ipcRenderer.invoke('window:zoom-out'),
  zoomReset: (): Promise<number> => ipcRenderer.invoke('window:zoom-reset'),
  getZoomFactor: (): Promise<number> => ipcRenderer.invoke('window:zoom-factor'),

  /** Brings the recorder window to the front ("New recording"). */
  showRecorderWindow: (): void => ipcRenderer.send('app:show-recorder'),

  getCursorScale: (): Promise<number> => ipcRenderer.invoke('desktop:get-cursor-scale'),
  setCursorScale: (scale: number): void => ipcRenderer.send('desktop:set-cursor-scale', scale),

  // --- System Audio Loopback (macOS) ---
  // electron-audio-loopback registers `enable-loopback-audio` and
  // `disable-loopback-audio` IPC handlers in initMain(). Wrap each
  // getDisplayMedia call between enable/disable so Chromium returns a
  // system-audio track instead of microphone audio.
  enableLoopbackAudio: (): Promise<void> => ipcRenderer.invoke('enable-loopback-audio'),
  disableLoopbackAudio: (): Promise<void> => ipcRenderer.invoke('disable-loopback-audio'),
  writeSystemAudioChunk: (chunk: ArrayBuffer): Promise<number> =>
    ipcRenderer.invoke('recording:write-system-audio', chunk),
  notifySystemAudioStopped: (): Promise<void> => ipcRenderer.invoke('recording:system-audio-stopped'),
  onStopSystemAudio: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('recorder:stop-system-audio', listener)
    return () => ipcRenderer.removeListener('recorder:stop-system-audio', listener)
  },

  // --- Renderer-side Screen Capture (macOS) ---
  // AVFoundation's screen input is non-functional on macOS 14+ (Sequoia),
  // so the screen video is captured in the renderer via getUserMedia
  // (chromeMediaSource: 'desktop'), streamed as WebM/VP9 chunks to the main
  // process, and muxed into the final MP4 alongside the optional mic track.
  getScreenSources: (): Promise<{ id: string; name: string; display_id: string }[]> =>
    ipcRenderer.invoke('recording:get-screen-sources'),
  writeScreenVideoChunk: (chunk: ArrayBuffer): Promise<number> =>
    ipcRenderer.invoke('recording:write-screen-video', chunk),
  notifyScreenCaptureStopped: (): Promise<void> => ipcRenderer.invoke('recording:screen-capture-stopped'),
  onStopScreenCapture: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('recorder:stop-screen-capture', listener)
    return () => ipcRenderer.removeListener('recorder:stop-screen-capture', listener)
  },

  getDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke('desktop:get-displays'),
  /** Resizes the frameless recorder window to fit its dock content. */
  setRecorderWindowSize: (size: { width: number; height: number }): void => ipcRenderer.send('recorder:set-size', size),
  getDshowDevices: (): Promise<{ video: DshowDevice[]; audio: DshowDevice[] }> =>
    ipcRenderer.invoke('desktop:get-dshow-devices'),

  onRecordingStarted: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('recording-started', listener)
    return () => {
      ipcRenderer.removeListener('recording-started', listener)
    }
  },

  onRecordingFinished: (callback: (result: RecordingResult) => void) => {
    const listener = (_event: IpcRendererEvent, result: RecordingResult) => callback(result)
    ipcRenderer.on('recording-finished', listener)

    return () => {
      ipcRenderer.removeListener('recording-finished', listener)
    }
  },
  // Fired by the global start shortcut in the main process; tells the recorder
  // to run its own start flow with the current UI selections.
  onTriggerStart: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('recorder:trigger-start', listener)

    return () => {
      ipcRenderer.removeListener('recorder:trigger-start', listener)
    }
  },
  onReleaseWebcamRequest: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('recorder:release-webcam', listener)
    return () => ipcRenderer.removeListener('recorder:release-webcam', listener)
  },
  sendWebcamReleasedConfirmation: () => ipcRenderer.send('recorder:webcam-released'),

  // --- Editor window ---
  onProjectOpen: (callback: (payload: ProjectPayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload: ProjectPayload) => callback(payload)
    ipcRenderer.on('project:open', listener)

    return () => {
      ipcRenderer.removeListener('project:open', listener)
    }
  },

  // --- Project files (.dthat) ---
  saveProject: (request: {
    project: unknown
    path?: string | null
    auto?: boolean
  }): Promise<{ canceled: boolean; path?: string; recovery?: boolean }> => ipcRenderer.invoke('project:save', request),
  saveProjectAs: (project: unknown): Promise<{ canceled: boolean; path?: string; recovery?: boolean }> =>
    ipcRenderer.invoke('project:save-as', project),
  /** Writes a snapshot to a new file without adopting it as the edited project. */
  saveProjectCopy: (request: {
    project: unknown
    suggestedName?: string
  }): Promise<{ canceled: boolean; path?: string; error?: string }> => ipcRenderer.invoke('project:save-copy', request),
  /** Renames the `.dthat` in place; the renderer repoints the session. */
  renameProject: (request: {
    currentPath: string
    newName: string
  }): Promise<{ ok: boolean; path?: string; error?: string }> => ipcRenderer.invoke('project:rename', request),
  openProjectFile: (options?: {
    path?: string
    /** Quiet: no native dialogs (a missing recent entry is reported, not shouted). */
    quiet?: boolean
  }): Promise<{
    canceled: boolean
    project?: unknown
    manifest?: unknown
    projectPath?: string
    error?: string
    /** True when a path was given but no file is there any more. */
    missing?: boolean
  }> => ipcRenderer.invoke('project:load', options),
  setProjectDirty: (dirty: boolean): void => ipcRenderer.send('project:set-dirty', dirty),
  // --- Session guard: main asks whether the current project may be replaced ---
  onBeforeReplace: (
    callback: (payload: { requestId: string; reason: 'open' | 'close' | 'quit' }) => void,
  ): (() => void) => {
    const listener = (_event: IpcRendererEvent, payload: { requestId: string; reason: 'open' | 'close' | 'quit' }) =>
      callback(payload)
    ipcRenderer.on('project:before-replace', listener)
    return () => ipcRenderer.removeListener('project:before-replace', listener)
  },
  settleBeforeReplace: (payload: { requestId: string; verdict: unknown }): void =>
    ipcRenderer.send('project:before-replace-result', payload),
  /** Main asks the renderer to run a save it cannot perform itself. */
  onPerformSave: (callback: (payload: { requestId: string }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, payload: { requestId: string }) => callback(payload)
    ipcRenderer.on('project:perform-save', listener)
    return () => ipcRenderer.removeListener('project:perform-save', listener)
  },
  settlePerformSave: (payload: { requestId: string; ok: boolean }): void =>
    ipcRenderer.send('project:perform-save-result', payload),
  /** Opens the project file picker (used by the recorder window). */
  promptOpenProject: (): Promise<{ opened: boolean }> => ipcRenderer.invoke('project:prompt-open'),
  /** Whether a crash-recovery copy exists, and when it was written. */
  getRecoveryInfo: (): Promise<{ exists: boolean; modifiedAt: number | null }> =>
    ipcRenderer.invoke('project:recovery-info'),
  /**
   * Opens the recovery copy for an UNSAVED session. The returned projectPath is
   * empty on purpose, so it never becomes the file autosave writes to.
   */
  openRecoveryCopy: (): Promise<{
    canceled: boolean
    project?: unknown
    manifest?: unknown
    projectPath?: string
    recovered?: boolean
    error?: string
  }> => ipcRenderer.invoke('project:open-recovery'),
  /** Removes the recovery copy once its work has been saved for real. */
  discardRecoveryCopy: (): Promise<{ removed: boolean }> => ipcRenderer.invoke('project:recovery-discard'),
  // Fired when a project opened from the OS (file association / CLI) is ready.
  onProjectApply: (
    callback: (payload: { project: unknown; manifest: unknown; projectPath: string; projectDir: string }) => void,
  ) => {
    const listener = (_event: IpcRendererEvent, payload: any) => callback(payload)
    ipcRenderer.on('project:apply', listener)

    return () => {
      ipcRenderer.removeListener('project:apply', listener)
    }
  },
  // Menu items in the main process forward their command here.
  onMenuCommand: (callback: (command: 'save' | 'save-copy' | 'open') => void) => {
    const listener = (_event: IpcRendererEvent, command: 'save' | 'save-copy' | 'open') => callback(command)
    ipcRenderer.on('menu:command', listener)

    return () => {
      ipcRenderer.removeListener('menu:command', listener)
    }
  },

  readFile: (filePath: string): Promise<string> => ipcRenderer.invoke('fs:readFile', filePath),

  // --- Export ---
  startExport: (payload: ExportPayload): Promise<void> => ipcRenderer.invoke('export:start', payload),
  cancelExport: (): void => ipcRenderer.send('export:cancel'),
  cloudStatus: () => ipcRenderer.invoke('cloud:status'),
  setCloudConsent: (accepted: boolean) => ipcRenderer.invoke('cloud:consent', accepted),
  cloudFallback: (payload: unknown) => ipcRenderer.invoke('cloud:fallback', payload),
  cloudRetry: (payload: unknown) => ipcRenderer.invoke('cloud:retry', payload),
  cancelCloudRetry: (): void => ipcRenderer.send('cloud:cancel'),
  /** Pricing table for the credit estimates and the pack notes. */
  getCloudCapabilities: (): Promise<{
    capabilities: { creditsPerFrame?: Record<string, number>; minChargeCredits?: number; targets?: string[] } | null
    error: string | null
  }> => ipcRenderer.invoke('cloud:capabilities'),
  /** A cloud job that outlived the last session, if there is one. */
  getActiveCloudJob: (): Promise<{ jobId: string; outputPath: string } | null> =>
    ipcRenderer.invoke('cloud:active-job'),
  /** Keeps watching that job and downloads its result. */
  resumeCloudWatch: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('cloud:resume-watch'),
  forgetCloudJob: (): Promise<{ forgotten: boolean }> => ipcRenderer.invoke('cloud:forget-job'),
  /** Encoders the bundled FFmpeg has (a missing libx265 disables the 8K option). */
  getExportCapabilities: (): Promise<{ libx265: boolean; hevcEncoders: string[] }> =>
    ipcRenderer.invoke('export:capabilities'),
  /** Local Pro state plus the URL the Unlock action should open. */
  getEntitlement: (): Promise<{ pro: boolean; credits: number; unlockUrl: string }> =>
    ipcRenderer.invoke('entitlement:get'),

  // --- License, credits and devices ---
  /** Plan, balance and devices for the header capsule and the Devices dialog. */
  getLicenseSummary: (): Promise<LicenseSummary> => ipcRenderer.invoke('license:summary'),
  /** Activates this device against a key; failures carry a friendly message. */
  activateLicense: (licenseKey: string): Promise<ActivationResult> =>
    ipcRenderer.invoke('license:activate', licenseKey),
  listLicenseDevices: (): Promise<DeviceView[]> => ipcRenderer.invoke('license:devices'),
  deactivateLicenseDevice: (deviceId: string): Promise<DeactivationResult> =>
    ipcRenderer.invoke('license:deactivate', deviceId),

  // --- Purchases (checkout + poll) ---
  /** Starts checkout for a product id; the main process opens the browser. */
  startCheckout: (productId: string): Promise<CheckoutStartResult> => ipcRenderer.invoke('checkout:start', productId),
  /** Whether a purchase is still pending from an earlier session. */
  getCheckoutStatus: (): Promise<{ pending: boolean; watching: boolean }> => ipcRenderer.invoke('checkout:status'),
  /** Starts watching a pending purchase again. */
  resumeCheckout: (): Promise<{ pending: boolean }> => ipcRenderer.invoke('checkout:resume'),
  /** Drops the pending purchase record. */
  forgetCheckout: (): Promise<{ forgotten: boolean }> => ipcRenderer.invoke('checkout:forget'),
  /** Stops waiting without cancelling the payment itself. */
  cancelCheckout: (): void => ipcRenderer.send('checkout:cancel'),
  /** The catalogue (GET /v1/products); null means "use the offline fallback". */
  listProducts: (): Promise<{ products: Product[] | null; error: string | null }> =>
    ipcRenderer.invoke('products:list'),
  onCheckoutStatus: (callback: (event: PurchaseEvent) => void) => {
    const listener = (_event: IpcRendererEvent, payload: PurchaseEvent) => callback(payload)
    ipcRenderer.on('checkout:status', listener)
    return () => {
      ipcRenderer.removeListener('checkout:status', listener)
    }
  },
  /** Measured export throughput for the render-time estimates. */
  getExportPerfSamples: (): Promise<
    Array<{
      resolution: string
      codec: 'h264' | 'hevc'
      settingFps: number
      width: number
      height: number
      throughput: number
    }>
  > => ipcRenderer.invoke('export:perf'),

  onExportProgress: (callback: (payload: ProgressPayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload: ProgressPayload) => callback(payload)
    ipcRenderer.on('export:progress', listener)
    return () => ipcRenderer.removeListener('export:progress', listener)
  },

  onExportComplete: (callback: (payload: CompletePayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload: CompletePayload) => callback(payload)
    ipcRenderer.on('export:complete', listener)
    return () => ipcRenderer.removeListener('export:complete', listener)
  },

  openAudioFile: (): Promise<{ canceled: boolean; filePath?: string; fileName?: string }> =>
    ipcRenderer.invoke('dialog:openAudioFile'),
  openVideoFiles: (): Promise<{ canceled: boolean; files?: { filePath: string; fileName: string }[] }> =>
    ipcRenderer.invoke('dialog:openVideoFiles'),
  detectSilence: (videoPath: string): Promise<{ start: number; end: number; duration: number }[]> =>
    ipcRenderer.invoke('video:detectSilence', videoPath),

  showSaveDialog: (options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> => {
    return ipcRenderer.invoke('dialog:showSaveDialog', options)
  },

  showMessageBox: (options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> => {
    return ipcRenderer.invoke('dialog:showMessageBox', options)
  },

  checkScreenRecordingPermission: (): Promise<'granted' | 'denied' | 'not-determined'> => {
    return ipcRenderer.invoke('permission:check-screen-recording')
  },

  showItemInFolder: (path: string): void => ipcRenderer.send('shell:showItemInFolder', path),

  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => {
    const listener = (_event: IpcRendererEvent, info: UpdateInfo) => callback(info)
    ipcRenderer.on('update:available', listener)
    return () => {
      ipcRenderer.removeListener('update:available', listener)
    }
  },
  openExternal: (url: string): void => ipcRenderer.send('shell:openExternal', url),

  // --- Render Worker ---
  onRenderStart: (callback: (payload: RenderStartPayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload: RenderStartPayload) => callback(payload)
    ipcRenderer.on('render:start', listener)
    return () => ipcRenderer.removeListener('render:start', listener)
  },
  rendererReady: () => {
    ipcRenderer.send('render:ready')
  },
  sendFrameToMain: (payload: { frame: Uint8Array; progress: number }): Promise<{ aborted: boolean }> =>
    ipcRenderer.invoke('export:frame-data', payload),
  finishRender: () => {
    ipcRenderer.send('export:render-finished')
  },

  // --- Presets & Settings ---
  loadPresets: (): Promise<Record<string, Preset>> => ipcRenderer.invoke('presets:load'),
  savePresets: (presets: Record<string, Preset>): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('presets:save', presets),
  getSetting: <T = any>(key: string): Promise<T> => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: unknown): void => ipcRenderer.send('settings:set', key, value),
  getPath: (name: 'home' | 'userData' | 'desktop'): Promise<string> => ipcRenderer.invoke('app:getPath', name),
  getCursorThemes: (): Promise<string[]> => ipcRenderer.invoke('desktop:get-cursor-themes'),
  loadCursorTheme: (themeName?: string): Promise<CursorTheme | null> =>
    ipcRenderer.invoke('desktop:load-cursor-theme', themeName),
  mapCursorNameToIDC: (name: string): Promise<string> => ipcRenderer.invoke('desktop:map-cursor-name-to-idc', name),

  // --- Window Controls ---
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  recorderClickThrough: () => ipcRenderer.send('recorder:click-through'),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  onWindowStateChange: (callback: (payload: { isMaximized: boolean }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: { isMaximized: boolean }) => callback(payload)
    ipcRenderer.on('window:state-changed', listener)
    return () => {
      ipcRenderer.removeListener('window:state-changed', listener)
    }
  },
  // --- START OF CHANGES ---
  updateTitleBarOverlay: (options: { color: string; symbolColor: string }) => {
    ipcRenderer.send('window:update-title-bar-overlay', options)
  },
  // --- END OF CHANGES ---
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  getPlatform: (): Promise<NodeJS.Platform> => ipcRenderer.invoke('app:getPlatform'),
  getVideoFrame: (options: { videoPath: string; time: number }): Promise<string> =>
    ipcRenderer.invoke('video:get-frame', options),
  videoHasAudio: (videoPath: string): Promise<boolean> => ipcRenderer.invoke('video:has-audio', videoPath),
}

// Expose API safely
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Also need to define types for TypeScript in renderer
declare global {
  interface Window {
    electronAPI: typeof electronAPI
  }
}
