import type { Slice, VirtualStudioState, VirtualStudioActions } from '../../types'
import type { VirtualStudioStatus, TrayQuickAction } from '../../../shared/virtual-camera-types'
import {
  DEFAULT_AV_SYNC_OFFSET_MS,
  MIN_AV_SYNC_OFFSET_MS,
  MAX_AV_SYNC_OFFSET_MS,
} from '../../../shared/virtual-camera-types'
import { createScopedLogger } from '../../lib/logger'

const logger = createScopedLogger('store:virtualStudio')

export const initialVirtualStudioState: VirtualStudioState = {
  isVirtualStudioActive: false,
  enableCamera: true,
  enableMic: true,
  activeSource: 'webcam',
  isMicMuted: false,
  isMiniHudVisible: true,
  isLocalAudioMonitoringEnabled: true,
  localMonitoringVolume: 1.0,
  selectedCameraId: null,
  selectedMicId: null,
  isMirrored: false,
  avSyncOffsetMs: DEFAULT_AV_SYNC_OFFSET_MS,
  cameraDriverInstalled: false,
  micDriverInstalled: false,
  isDriverInstalling: false,
  studioError: null,
}

export const createVirtualStudioSlice: Slice<VirtualStudioState, VirtualStudioActions> = (set, get) => ({
  ...initialVirtualStudioState,
  setVirtualStudioActive: (active: boolean) => {
    logger.info(`setVirtualStudioActive: ${active}`)
    set((state) => {
      state.isVirtualStudioActive = active
      if (active) {
        state.activeSource = state.isPlaying ? 'canvas' : 'webcam'
      }
    })
  },
  setEnableCamera: (enable: boolean) => {
    logger.info(`setEnableCamera: ${enable}`)
    set((state) => {
      state.enableCamera = enable
    })
  },
  setEnableMic: (enable: boolean) => {
    logger.info(`setEnableMic: ${enable}`)
    set((state) => {
      state.enableMic = enable
    })
  },
  setActiveSource: (source: 'webcam' | 'canvas') => {
    logger.info(`setActiveSource: ${source}`)
    set((state) => {
      state.activeSource = source
    })
  },
  toggleMicMute: () => {
    logger.info('toggleMicMute')
    set((state) => {
      state.isMicMuted = !state.isMicMuted
    })
  },
  setMicMuted: (muted: boolean) => {
    logger.info(`setMicMuted: ${muted}`)
    set((state) => {
      state.isMicMuted = muted
    })
  },
  setMiniHudVisible: (visible: boolean) => {
    logger.info(`setMiniHudVisible: ${visible}`)
    set((state) => {
      state.isMiniHudVisible = visible
    })
  },
  toggleMiniHud: () => {
    logger.info('toggleMiniHud')
    set((state) => {
      state.isMiniHudVisible = !state.isMiniHudVisible
    })
  },
  setLocalAudioMonitoringEnabled: (enabled: boolean) => {
    logger.info(`setLocalAudioMonitoringEnabled: ${enabled}`)
    set((state) => {
      state.isLocalAudioMonitoringEnabled = enabled
    })
  },
  toggleLocalAudioMonitoring: () => {
    logger.info('toggleLocalAudioMonitoring')
    set((state) => {
      state.isLocalAudioMonitoringEnabled = !state.isLocalAudioMonitoringEnabled
    })
  },
  setLocalMonitoringVolume: (volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume))
    logger.debug(`setLocalMonitoringVolume: ${clamped}`)
    set((state) => {
      state.localMonitoringVolume = clamped
    })
  },
  setIsMirrored: (mirrored: boolean) => {
    logger.info(`setIsMirrored: ${mirrored}`)
    set((state) => {
      state.isMirrored = mirrored
    })
  },
  toggleMirror: () => {
    logger.info('toggleMirror')
    set((state) => {
      state.isMirrored = !state.isMirrored
    })
  },
  setAvSyncOffsetMs: (offset: number) => {
    const clamped = Math.max(MIN_AV_SYNC_OFFSET_MS, Math.min(MAX_AV_SYNC_OFFSET_MS, Math.round(offset)))
    logger.info(`setAvSyncOffsetMs: ${clamped}`)
    set((state) => {
      state.avSyncOffsetMs = clamped
    })
  },
  setSelectedCameraId: (id: string | null) => {
    logger.info(`setSelectedCameraId: ${id}`)
    set((state) => {
      state.selectedCameraId = id
    })
  },
  setSelectedMicId: (id: string | null) => {
    logger.info(`setSelectedMicId: ${id}`)
    set((state) => {
      state.selectedMicId = id
    })
  },
  setVirtualStudioStatus: (status: Partial<VirtualStudioStatus>) => {
    set((state) => {
      if (status.cameraDriverInstalled !== undefined) state.cameraDriverInstalled = status.cameraDriverInstalled
      if (status.micDriverInstalled !== undefined) state.micDriverInstalled = status.micDriverInstalled
      if (status.isStreaming !== undefined) state.isVirtualStudioActive = status.isStreaming
      if (status.activeSource !== undefined) state.activeSource = status.activeSource
      if (status.isMicMuted !== undefined) state.isMicMuted = status.isMicMuted
      if (status.webcamDeviceId !== undefined) state.selectedCameraId = status.webcamDeviceId
      if (status.micDeviceId !== undefined) state.selectedMicId = status.micDeviceId
      if (status.isLocalAudioMonitoringEnabled !== undefined) {
        state.isLocalAudioMonitoringEnabled = status.isLocalAudioMonitoringEnabled
      }
      if (status.isMirrored !== undefined) {
        state.isMirrored = status.isMirrored
      }
      if (status.avSyncOffsetMs !== undefined) {
        const clampedSync = Math.max(
          MIN_AV_SYNC_OFFSET_MS,
          Math.min(MAX_AV_SYNC_OFFSET_MS, Math.round(status.avSyncOffsetMs)),
        )
        if (Math.abs(clampedSync - state.avSyncOffsetMs) > 2) {
          state.avSyncOffsetMs = clampedSync
        }
      }
      if (
        status.localMonitoringVolume !== undefined &&
        Math.abs(status.localMonitoringVolume - state.localMonitoringVolume) > 0.05
      ) {
        state.localMonitoringVolume = Math.max(0, Math.min(1, status.localMonitoringVolume))
      }
      if (status.isMiniHudVisible !== undefined) state.isMiniHudVisible = status.isMiniHudVisible
      if (status.error !== undefined) state.studioError = status.error
    })
  },
  setDriverInstalling: (installing: boolean) => {
    logger.info(`setDriverInstalling: ${installing}`)
    set((state) => {
      state.isDriverInstalling = installing
    })
  },
  setStudioError: (error: string | null) => {
    if (error) {
      logger.error(`setStudioError: ${error}`)
    } else {
      logger.info('setStudioError: cleared')
    }
    set((state) => {
      state.studioError = error
    })
  },
  handleTrayAction: (action: TrayQuickAction) => {
    logger.info(`handleTrayAction: ${action}`)
    switch (action) {
      case 'toggle-playback':
        get().togglePlay()
        break
      case 'toggle-mic-mute':
        get().toggleMicMute()
        break
      case 'toggle-hud':
        get().toggleMiniHud()
        break
      case 'toggle-mirror':
        get().toggleMirror()
        break
      case 'toggle-audio-monitor':
        get().toggleLocalAudioMonitoring()
        break
      case 'stop-studio':
        get().setVirtualStudioActive(false)
        break
    }
  },
})
