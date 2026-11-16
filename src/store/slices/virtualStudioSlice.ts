import type { Slice, VirtualStudioState, VirtualStudioActions } from '../../types'
import type { VirtualStudioStatus, TrayQuickAction } from '../../../shared/virtual-camera-types'

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
  cameraDriverInstalled: false,
  micDriverInstalled: false,
  isDriverInstalling: false,
  studioError: null,
}

export const createVirtualStudioSlice: Slice<VirtualStudioState, VirtualStudioActions> = (set, get) => ({
  ...initialVirtualStudioState,
  setVirtualStudioActive: (active: boolean) => {
    set((state) => {
      state.isVirtualStudioActive = active
      if (active) {
        state.activeSource = state.isPlaying ? 'canvas' : 'webcam'
      }
    })
  },
  setEnableCamera: (enable: boolean) => {
    set((state) => {
      state.enableCamera = enable
    })
  },
  setEnableMic: (enable: boolean) => {
    set((state) => {
      state.enableMic = enable
    })
  },
  setActiveSource: (source: 'webcam' | 'canvas') => {
    set((state) => {
      state.activeSource = source
    })
  },
  toggleMicMute: () => {
    set((state) => {
      state.isMicMuted = !state.isMicMuted
    })
  },
  setMicMuted: (muted: boolean) => {
    set((state) => {
      state.isMicMuted = muted
    })
  },
  setMiniHudVisible: (visible: boolean) => {
    set((state) => {
      state.isMiniHudVisible = visible
    })
  },
  toggleMiniHud: () => {
    set((state) => {
      state.isMiniHudVisible = !state.isMiniHudVisible
    })
  },
  setLocalAudioMonitoringEnabled: (enabled: boolean) => {
    set((state) => {
      state.isLocalAudioMonitoringEnabled = enabled
    })
  },
  toggleLocalAudioMonitoring: () => {
    set((state) => {
      state.isLocalAudioMonitoringEnabled = !state.isLocalAudioMonitoringEnabled
    })
  },
  setLocalMonitoringVolume: (volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume))
    set((state) => {
      state.localMonitoringVolume = clamped
    })
  },
  setIsMirrored: (mirrored: boolean) => {
    set((state) => {
      state.isMirrored = mirrored
    })
  },
  toggleMirror: () => {
    set((state) => {
      state.isMirrored = !state.isMirrored
    })
  },
  setSelectedCameraId: (id: string | null) => {
    set((state) => {
      state.selectedCameraId = id
    })
  },
  setSelectedMicId: (id: string | null) => {
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
    set((state) => {
      state.isDriverInstalling = installing
    })
  },
  setStudioError: (error: string | null) => {
    set((state) => {
      state.studioError = error
    })
  },
  handleTrayAction: (action: TrayQuickAction) => {
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
