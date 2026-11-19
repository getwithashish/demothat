export interface VirtualStudioStatus {
  cameraDriverInstalled: boolean
  micDriverInstalled: boolean
  isStreaming: boolean
  isCameraActive: boolean
  isMicActive: boolean
  activeSource: 'webcam' | 'canvas'
  webcamDeviceId: string | null
  micDeviceId: string | null
  isMicMuted: boolean
  isPlaying: boolean
  isLocalAudioMonitoringEnabled: boolean
  localMonitoringVolume: number
  isMirrored: boolean
  isMiniHudVisible?: boolean
  avSyncOffsetMs?: number
  error?: string | null
}

export interface VirtualStudioConfig {
  enableCamera: boolean
  enableMic: boolean
  selectedWebcamId?: string
  selectedMicId?: string
  outputResolution: { width: number; height: number; fps: number }
  inputResolution?: { width: number; height: number }
  enableLocalAudioMonitoring: boolean
  localMonitoringVolume: number
  isMirrored?: boolean
  avSyncOffsetMs?: number
}

export const DEFAULT_VIRTUAL_STUDIO_RESOLUTION = {
  width: 1920,
  height: 1080,
  fps: 30,
} as const

export const DEFAULT_VIRTUAL_STUDIO_STREAM_RESOLUTION = {
  width: 1280,
  height: 720,
} as const

export const DEFAULT_AV_SYNC_OFFSET_MS = 0
export const MIN_AV_SYNC_OFFSET_MS = -1000
export const MAX_AV_SYNC_OFFSET_MS = 1000

export const DEFAULT_VIRTUAL_STUDIO_FALLBACK_COLOR = '#17181b'

export interface VirtualFramePayload {
  data: Uint8Array | ArrayBuffer | Uint8ClampedArray
  width: number
  height: number
  format?: 'rgba' | 'bgra' | 'jpeg' | 'yuv420p'
  timestamp?: number
}

export interface VirtualAudioPayload {
  data: Uint8Array | ArrayBuffer
  sampleRate?: number
  channels?: number
}

export type TrayQuickAction =
  'toggle-playback' | 'toggle-mic-mute' | 'toggle-hud' | 'stop-studio' | 'toggle-mirror' | 'toggle-audio-monitor'

export interface VirtualStudioActionResult {
  success: boolean
  error?: string
}
