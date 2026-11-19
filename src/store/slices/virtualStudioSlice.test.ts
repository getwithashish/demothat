import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from '../editorStore'

describe('virtualStudioSlice', () => {
  beforeEach(() => {
    // Reset virtual studio state to initial defaults
    const state = useEditorStore.getState()
    state.setVirtualStudioActive(false)
    state.setEnableCamera(true)
    state.setEnableMic(true)
    state.setActiveSource('webcam')
    state.setMicMuted(false)
    state.setMiniHudVisible(true)
    state.setLocalAudioMonitoringEnabled(true)
    state.setLocalMonitoringVolume(1.0)
    state.setIsMirrored(false)
    state.setSelectedCameraId(null)
    state.setSelectedMicId(null)
    state.setAvSyncOffsetMs(0)
  })

  it('initializes with camera and microphone enabled by default', () => {
    const state = useEditorStore.getState()
    expect(state.enableCamera).toBe(true)
    expect(state.enableMic).toBe(true)
    expect(state.isVirtualStudioActive).toBe(false)
    expect(state.activeSource).toBe('webcam')
    expect(state.isMicMuted).toBe(false)
    expect(state.isLocalAudioMonitoringEnabled).toBe(true)
    expect(state.localMonitoringVolume).toBe(1.0)
    expect(state.isMirrored).toBe(false)
    expect(state.avSyncOffsetMs).toBe(0)
  })

  it('supports setting and toggling mirroring and audio monitoring directly', () => {
    const { setIsMirrored, toggleMirror, toggleLocalAudioMonitoring } = useEditorStore.getState()

    setIsMirrored(true)
    expect(useEditorStore.getState().isMirrored).toBe(true)

    toggleMirror()
    expect(useEditorStore.getState().isMirrored).toBe(false)

    toggleMirror()
    expect(useEditorStore.getState().isMirrored).toBe(true)

    expect(useEditorStore.getState().isLocalAudioMonitoringEnabled).toBe(true)
    toggleLocalAudioMonitoring()
    expect(useEditorStore.getState().isLocalAudioMonitoringEnabled).toBe(false)
    toggleLocalAudioMonitoring()
    expect(useEditorStore.getState().isLocalAudioMonitoringEnabled).toBe(true)
  })

  it('syncs isMirrored status updates via setVirtualStudioStatus', () => {
    const { setVirtualStudioStatus } = useEditorStore.getState()
    expect(useEditorStore.getState().isMirrored).toBe(false)

    setVirtualStudioStatus({ isMirrored: true })
    expect(useEditorStore.getState().isMirrored).toBe(true)

    setVirtualStudioStatus({ isMirrored: false })
    expect(useEditorStore.getState().isMirrored).toBe(false)
  })

  it('does NOT overwrite enableCamera or enableMic user preferences from isCameraActive/isMicActive', () => {
    const { setVirtualStudioStatus } = useEditorStore.getState()

    // Simulate getStatus or backend broadcast with isCameraActive: false, isMicActive: false
    setVirtualStudioStatus({
      isCameraActive: false,
      isMicActive: false,
      isStreaming: false,
    })

    const state = useEditorStore.getState()
    // User preferences MUST be preserved!
    expect(state.enableCamera).toBe(true)
    expect(state.enableMic).toBe(true)
  })

  it('ignores minor volume fluctuations (<= 0.05) to prevent slider drag oscillation loops', () => {
    const { setLocalMonitoringVolume, setVirtualStudioStatus } = useEditorStore.getState()

    setLocalMonitoringVolume(0.8)
    expect(useEditorStore.getState().localMonitoringVolume).toBe(0.8)

    // A tiny async echo of 0.81 (diff = 0.01 <= 0.05) should be ignored
    setVirtualStudioStatus({ localMonitoringVolume: 0.81 })
    expect(useEditorStore.getState().localMonitoringVolume).toBe(0.8)

    // A significant volume change (diff > 0.05) should be applied
    setVirtualStudioStatus({ localMonitoringVolume: 0.5 })
    expect(useEditorStore.getState().localMonitoringVolume).toBe(0.5)
  })

  it('handles tray quick actions correctly', () => {
    const { handleTrayAction } = useEditorStore.getState()

    // toggle-playback
    expect(useEditorStore.getState().isPlaying).toBe(false)
    handleTrayAction('toggle-playback')
    expect(useEditorStore.getState().isPlaying).toBe(true)
    handleTrayAction('toggle-playback')
    expect(useEditorStore.getState().isPlaying).toBe(false)

    // toggle-mic-mute
    expect(useEditorStore.getState().isMicMuted).toBe(false)
    handleTrayAction('toggle-mic-mute')
    expect(useEditorStore.getState().isMicMuted).toBe(true)
    handleTrayAction('toggle-mic-mute')
    expect(useEditorStore.getState().isMicMuted).toBe(false)

    // toggle-hud
    expect(useEditorStore.getState().isMiniHudVisible).toBe(true)
    handleTrayAction('toggle-hud')
    expect(useEditorStore.getState().isMiniHudVisible).toBe(false)
    handleTrayAction('toggle-hud')
    expect(useEditorStore.getState().isMiniHudVisible).toBe(true)

    // toggle-mirror
    expect(useEditorStore.getState().isMirrored).toBe(false)
    handleTrayAction('toggle-mirror')
    expect(useEditorStore.getState().isMirrored).toBe(true)
    handleTrayAction('toggle-mirror')
    expect(useEditorStore.getState().isMirrored).toBe(false)

    // toggle-audio-monitor
    expect(useEditorStore.getState().isLocalAudioMonitoringEnabled).toBe(true)
    handleTrayAction('toggle-audio-monitor')
    expect(useEditorStore.getState().isLocalAudioMonitoringEnabled).toBe(false)
    handleTrayAction('toggle-audio-monitor')
    expect(useEditorStore.getState().isLocalAudioMonitoringEnabled).toBe(true)

    // stop-studio
    useEditorStore.getState().setVirtualStudioActive(true)
    expect(useEditorStore.getState().isVirtualStudioActive).toBe(true)
    handleTrayAction('stop-studio')
    expect(useEditorStore.getState().isVirtualStudioActive).toBe(false)
  })

  it('sets and clamps avSyncOffsetMs to [-1000, 1000] and syncs from status', () => {
    const { setAvSyncOffsetMs, setVirtualStudioStatus } = useEditorStore.getState()

    setAvSyncOffsetMs(200)
    expect(useEditorStore.getState().avSyncOffsetMs).toBe(200)

    setAvSyncOffsetMs(-150)
    expect(useEditorStore.getState().avSyncOffsetMs).toBe(-150)

    // Clamping to [-1000, 1000]
    setAvSyncOffsetMs(2500)
    expect(useEditorStore.getState().avSyncOffsetMs).toBe(1000)

    setAvSyncOffsetMs(-5000)
    expect(useEditorStore.getState().avSyncOffsetMs).toBe(-1000)

    // Sync from status
    setVirtualStudioStatus({ avSyncOffsetMs: 50 })
    expect(useEditorStore.getState().avSyncOffsetMs).toBe(50)
  })
})
