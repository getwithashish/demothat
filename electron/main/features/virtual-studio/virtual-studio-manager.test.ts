import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockWindow = {
  isDestroyed: vi.fn().mockReturnValue(false),
  webContents: {
    send: vi.fn(),
  },
}

const mockDestroyedWindow = {
  isDestroyed: vi.fn().mockReturnValue(true),
  webContents: {
    send: vi.fn(),
  },
}

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [mockWindow, mockDestroyedWindow]),
  },
  app: {
    isPackaged: false,
  },
}))

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('./driver-setup', () => ({
  checkVirtualDrivers: vi.fn().mockResolvedValue({
    cameraDriverInstalled: true,
    micDriverInstalled: true,
    cameraDevicePath: '/dev/video10',
    details: 'v4l2loopback ready',
  }),
  installVirtualDrivers: vi.fn().mockResolvedValue({ success: true }),
  ensureLinuxCameraDriver: vi.fn().mockResolvedValue({ success: true }),
  teardownLinuxCameraDriver: vi.fn().mockResolvedValue({ success: true }),
  teardownLinuxAudioSink: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('../../windows/hud-window', () => ({
  showHudWindow: vi.fn(),
  hideHudWindow: vi.fn(),
  toggleHudWindow: vi.fn(),
  createHudWindow: vi.fn(),
  getHudWindow: vi.fn(),
  destroyHudWindow: vi.fn(),
}))

import { VirtualStudioManager } from './virtual-studio-manager'
import {
  checkVirtualDrivers,
  installVirtualDrivers,
  teardownLinuxCameraDriver,
  teardownLinuxAudioSink,
} from './driver-setup'
import { showHudWindow, hideHudWindow, destroyHudWindow } from '../../windows/hud-window'
import type { VirtualCameraSink } from './virtual-camera-sink'
import type { VirtualAudioSink } from './virtual-audio-sink'
import type { VirtualStudioTray } from './virtual-studio-tray'
import type { VirtualStudioConfig } from '../../../../shared/virtual-camera-types'

describe('VirtualStudioManager', () => {
  let mockCameraSink: Record<string, ReturnType<typeof vi.fn>>
  let mockAudioSink: Record<string, ReturnType<typeof vi.fn>>
  let mockTray: Record<string, ReturnType<typeof vi.fn>>
  let manager: VirtualStudioManager

  const defaultConfig: VirtualStudioConfig = {
    enableCamera: true,
    enableMic: true,
    outputResolution: { width: 1920, height: 1080, fps: 30 },
    enableLocalAudioMonitoring: true,
    localMonitoringVolume: 0.8,
    selectedWebcamId: 'cam-123',
    selectedMicId: 'mic-456',
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockCameraSink = {
      start: vi.fn().mockResolvedValue({ success: true }),
      stop: vi.fn().mockResolvedValue(undefined),
      pushFrame: vi.fn().mockResolvedValue(true),
      isActive: vi.fn().mockReturnValue(false),
      getFrameCount: vi.fn().mockReturnValue(0),
    }

    mockAudioSink = {
      start: vi.fn().mockResolvedValue({ success: true }),
      stop: vi.fn().mockResolvedValue(undefined),
      pushAudio: vi.fn().mockResolvedValue(true),
      isActive: vi.fn().mockReturnValue(false),
      isMuted: vi.fn().mockReturnValue(false),
      setMuted: vi.fn(),
    }

    mockTray = {
      init: vi.fn(),
      destroy: vi.fn(),
      updateState: vi.fn(),
      isCreated: vi.fn().mockReturnValue(false),
    }

    manager = new VirtualStudioManager(
      mockCameraSink as unknown as VirtualCameraSink,
      mockAudioSink as unknown as VirtualAudioSink,
      mockTray as unknown as VirtualStudioTray,
    )
  })

  it('initializes with default stopped state and active camera/mic user preferences', async () => {
    const status = await manager.getStatus()
    expect(status.isStreaming).toBe(false)
    expect(status.isCameraActive).toBe(true)
    expect(status.isMicActive).toBe(true)
    expect(status.activeSource).toBe('webcam')
    expect(status.isPlaying).toBe(false)
    expect(status.isMirrored).toBe(false)
    expect(status.cameraDriverInstalled).toBe(true)
    expect(status.micDriverInstalled).toBe(true)
  })

  it('starts virtual studio successfully with sinks and system tray', async () => {
    const result = await manager.start(defaultConfig)
    expect(result.success).toBe(true)

    expect(mockCameraSink.start).toHaveBeenCalledWith({
      width: 1920,
      height: 1080,
      fps: 30,
    })
    expect(mockAudioSink.start).toHaveBeenCalled()
    expect(mockTray.init).toHaveBeenCalled()
    expect(showHudWindow).toHaveBeenCalled()

    const status = await manager.getStatus()
    expect(status.isStreaming).toBe(true)
    expect(status.isCameraActive).toBe(true)
    expect(status.isMicActive).toBe(true)
    expect(status.activeSource).toBe('webcam')
    expect(status.webcamDeviceId).toBe('cam-123')
    expect(status.micDeviceId).toBe('mic-456')

    // Broadcasts status to windows
    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      'virtual-studio:status-changed',
      expect.objectContaining({ isStreaming: true }),
    )
  })

  it('falls back to DEFAULT_VIRTUAL_STUDIO_RESOLUTION (1920x1080@30fps) when output resolution is omitted or 0', async () => {
    const configWithoutRes: VirtualStudioConfig = {
      ...defaultConfig,
      outputResolution: { width: 0, height: 0, fps: 0 },
    }
    const result = await manager.start(configWithoutRes)
    expect(result.success).toBe(true)

    expect(mockCameraSink.start).toHaveBeenCalledWith({
      width: 1920,
      height: 1080,
      fps: 30,
    })
  })

  it('stops virtual studio and cleans up sinks and tray', async () => {
    await manager.start(defaultConfig)
    const stopResult = await manager.stop()
    expect(stopResult.success).toBe(true)

    expect(mockCameraSink.stop).toHaveBeenCalled()
    expect(mockAudioSink.stop).toHaveBeenCalled()
    expect(mockTray.destroy).toHaveBeenCalled()
    expect(hideHudWindow).toHaveBeenCalled()

    const status = await manager.getStatus()
    expect(status.isStreaming).toBe(false)
  })

  it('handles frame pushing only when streaming', async () => {
    const framePayload = {
      data: new Uint8Array([1, 2, 3]),
      width: 1920,
      height: 1080,
    }

    // When stopped
    const failRes = await manager.pushFrame(framePayload)
    expect(failRes.success).toBe(false)
    expect(mockCameraSink.pushFrame).not.toHaveBeenCalled()

    // When started
    await manager.start(defaultConfig)
    const successRes = await manager.pushFrame(framePayload)
    expect(successRes.success).toBe(true)
    expect(mockCameraSink.pushFrame).toHaveBeenCalledWith(framePayload)
  })

  it('handles audio pushing only when streaming', async () => {
    const audioChunk = new Uint8Array([0, 1, 0, 1])

    // When stopped
    const failRes = await manager.pushAudio(audioChunk)
    expect(failRes.success).toBe(false)

    // When started
    await manager.start(defaultConfig)
    const successRes = await manager.pushAudio(audioChunk)
    expect(successRes.success).toBe(true)
    expect(mockAudioSink.pushAudio).toHaveBeenCalledWith(audioChunk)
  })

  it('handles tray action: toggle-playback (switches source between webcam and canvas)', async () => {
    await manager.start(defaultConfig)
    let status = await manager.getStatus()
    expect(status.isPlaying).toBe(false)
    expect(status.activeSource).toBe('webcam')

    // Toggle playback -> start playing (canvas active)
    await manager.triggerAction('toggle-playback')
    status = await manager.getStatus()
    expect(status.isPlaying).toBe(true)
    expect(status.activeSource).toBe('canvas')
    expect(mockTray.updateState).toHaveBeenCalledWith(
      expect.objectContaining({ isPlaying: true, activeSource: 'canvas' }),
    )
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('virtual-studio:tray-action', 'toggle-playback')

    // Toggle playback -> pause (webcam returns)
    await manager.triggerAction('toggle-playback')
    status = await manager.getStatus()
    expect(status.isPlaying).toBe(false)
    expect(status.activeSource).toBe('webcam')
  })

  it('handles tray action: toggle-mic-mute without muting audioSink (attendee audio preserved)', async () => {
    await manager.start(defaultConfig)
    let status = await manager.getStatus()
    expect(status.isMicMuted).toBe(false)

    // Mute mic
    await manager.triggerAction('toggle-mic-mute')
    status = await manager.getStatus()
    expect(status.isMicMuted).toBe(true)
    // Physical mic mute is strictly Web Audio; audioSink must NOT drop attendee audio
    expect(mockAudioSink.setMuted).not.toHaveBeenCalled()

    // Unmute mic
    await manager.triggerAction('toggle-mic-mute')
    status = await manager.getStatus()
    expect(status.isMicMuted).toBe(false)
    expect(mockAudioSink.setMuted).not.toHaveBeenCalled()
  })

  it('handles tray action: toggle-mirror', async () => {
    await manager.start(defaultConfig)
    let status = await manager.getStatus()
    expect(status.isMirrored).toBe(false)

    await manager.triggerAction('toggle-mirror')
    status = await manager.getStatus()
    expect(status.isMirrored).toBe(true)
    expect(mockTray.updateState).toHaveBeenCalledWith(expect.objectContaining({ isMirrored: true }))
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('virtual-studio:tray-action', 'toggle-mirror')

    await manager.triggerAction('toggle-mirror')
    status = await manager.getStatus()
    expect(status.isMirrored).toBe(false)
    expect(mockTray.updateState).toHaveBeenCalledWith(expect.objectContaining({ isMirrored: false }))
  })

  it('handles tray action: toggle-audio-monitor', async () => {
    await manager.start(defaultConfig)
    let status = await manager.getStatus()
    expect(status.isLocalAudioMonitoringEnabled).toBe(true)

    await manager.triggerAction('toggle-audio-monitor')
    status = await manager.getStatus()
    expect(status.isLocalAudioMonitoringEnabled).toBe(false)
    expect(mockTray.updateState).toHaveBeenCalledWith(expect.objectContaining({ isLocalAudioMonitoringEnabled: false }))
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('virtual-studio:tray-action', 'toggle-audio-monitor')

    await manager.triggerAction('toggle-audio-monitor')
    status = await manager.getStatus()
    expect(status.isLocalAudioMonitoringEnabled).toBe(true)
    expect(mockTray.updateState).toHaveBeenCalledWith(expect.objectContaining({ isLocalAudioMonitoringEnabled: true }))
  })

  it('handles tray action: toggle-hud and stop-studio', async () => {
    await manager.start(defaultConfig)

    await manager.triggerAction('toggle-hud')
    let status = await manager.getStatus()
    expect(status.isMiniHudVisible).toBe(false)

    await manager.triggerAction('stop-studio')
    status = await manager.getStatus()
    expect(status.isStreaming).toBe(false)
    expect(mockTray.destroy).toHaveBeenCalled()
  })

  it('allows updating status patch from renderer and dynamically toggles sinks while streaming', async () => {
    await manager.start(defaultConfig)

    await manager.updateStatus({
      isMicMuted: true,
      isPlaying: true,
      activeSource: 'canvas',
      isMirrored: true,
    })
    const status = await manager.getStatus()
    expect(status.isMicMuted).toBe(true)
    expect(status.isPlaying).toBe(true)
    expect(status.activeSource).toBe('canvas')
    expect(status.isMirrored).toBe(true)
    expect(mockAudioSink.setMuted).not.toHaveBeenCalled()

    // Dynamic stop of camera sink while streaming
    await manager.updateStatus({ isCameraActive: false })
    expect(mockCameraSink.stop).toHaveBeenCalled()

    // Dynamic start of camera sink while streaming
    await manager.updateStatus({ isCameraActive: true })
    expect(mockCameraSink.start).toHaveBeenCalledTimes(2)

    // Dynamic stop of audio sink while streaming
    await manager.updateStatus({ isMicActive: false })
    expect(mockAudioSink.stop).toHaveBeenCalled()

    // Dynamic start of audio sink while streaming
    await manager.updateStatus({ isMicActive: true })
    expect(mockAudioSink.start).toHaveBeenCalledTimes(2)
  })

  it('forwards preview frames to windows via pushPreviewFrame', () => {
    manager.pushPreviewFrame('data:image/jpeg;base64,mockthumb')
    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      'virtual-studio:preview-frame',
      'data:image/jpeg;base64,mockthumb',
    )
    expect(mockDestroyedWindow.webContents.send).not.toHaveBeenCalledWith(
      'virtual-studio:preview-frame',
      expect.anything(),
    )
  })

  describe('Edge Cases & Driver Scenarios', () => {
    it('handles driver missing state gracefully', async () => {
      vi.mocked(checkVirtualDrivers).mockResolvedValueOnce({
        cameraDriverInstalled: false,
        micDriverInstalled: false,
        details: 'No loopback driver',
      })

      const status = await manager.getStatus()
      expect(status.cameraDriverInstalled).toBe(false)
      expect(status.micDriverInstalled).toBe(false)
    })

    it('handles checkVirtualDrivers throwing an error gracefully', async () => {
      vi.mocked(checkVirtualDrivers).mockRejectedValueOnce(new Error('Driver check timeout'))

      const status = await manager.getStatus()
      // Should not throw and returns existing status
      expect(status).toBeDefined()
    })

    it('installs virtual drivers successfully and updates status', async () => {
      vi.mocked(installVirtualDrivers).mockResolvedValueOnce({ success: true })
      vi.mocked(checkVirtualDrivers).mockResolvedValueOnce({
        cameraDriverInstalled: true,
        micDriverInstalled: true,
        details: 'Installed',
      })

      const res = await manager.installDriver()
      expect(res.success).toBe(true)
      const status = await manager.getStatus()
      expect(status.cameraDriverInstalled).toBe(true)
      expect(status.micDriverInstalled).toBe(true)
    })

    it('handles driver installation failure without crashing', async () => {
      vi.mocked(installVirtualDrivers).mockRejectedValueOnce(new Error('pkexec authorization failed'))

      const res = await manager.installDriver()
      expect(res.success).toBe(false)
      expect(res.error).toContain('pkexec authorization failed')
    })
  })

  describe('Device & Sink Error Handling', () => {
    it('handles camera sink start failure gracefully', async () => {
      mockCameraSink.start.mockRejectedValueOnce(new Error('Failed to open /dev/video10'))

      const res = await manager.start(defaultConfig)
      expect(res.success).toBe(false)
      expect(res.error).toContain('Failed to open /dev/video10')

      const status = await manager.getStatus()
      expect(status.error).toContain('Failed to open /dev/video10')
    })

    it('handles camera sink start returning failure object', async () => {
      mockCameraSink.start.mockResolvedValueOnce({ success: false, error: 'Device busy' })

      const res = await manager.start(defaultConfig)
      expect(res.success).toBe(true) // Manager continues and logs warning
    })

    it('handles audio sink start returning failure object', async () => {
      mockAudioSink.start.mockResolvedValueOnce({ success: false, error: 'PulseAudio not responding' })

      const res = await manager.start(defaultConfig)
      expect(res.success).toBe(true) // Manager continues and logs warning
    })

    it('supports selective startup with camera or mic disabled', async () => {
      const cameraOnlyConfig: VirtualStudioConfig = {
        ...defaultConfig,
        enableCamera: true,
        enableMic: false,
      }

      await manager.start(cameraOnlyConfig)
      expect(mockCameraSink.start).toHaveBeenCalled()
      expect(mockAudioSink.start).not.toHaveBeenCalled()

      let status = await manager.getStatus()
      expect(status.isCameraActive).toBe(true)
      expect(status.isMicActive).toBe(false)

      await manager.stop()

      const micOnlyConfig: VirtualStudioConfig = {
        ...defaultConfig,
        enableCamera: false,
        enableMic: true,
      }

      await manager.start(micOnlyConfig)
      expect(mockCameraSink.start).toHaveBeenCalledTimes(1) // was not called again
      expect(mockAudioSink.start).toHaveBeenCalledTimes(1)

      status = await manager.getStatus()
      expect(status.isCameraActive).toBe(false)
      expect(status.isMicActive).toBe(true)
    })

    it('handles stop failure gracefully if camera sink throws', async () => {
      await manager.start(defaultConfig)
      mockCameraSink.stop.mockRejectedValueOnce(new Error('Sink close error'))

      const stopRes = await manager.stop()
      expect(stopRes.success).toBe(false)
      expect(stopRes.error).toContain('Sink close error')
    })

    it('skips destroyed windows during broadcasts', async () => {
      await manager.start(defaultConfig)

      // mockWindow is active, mockDestroyedWindow is destroyed
      expect(mockWindow.webContents.send).toHaveBeenCalled()
      expect(mockDestroyedWindow.webContents.send).not.toHaveBeenCalled()
    })

    it('handles sink returning false on pushFrame or pushAudio', async () => {
      await manager.start(defaultConfig)

      mockCameraSink.pushFrame.mockResolvedValueOnce(false)
      const frameRes = await manager.pushFrame({
        data: new Uint8Array([1, 2]),
        width: 1920,
        height: 1080,
      })
      expect(frameRes.success).toBe(false)

      mockAudioSink.pushAudio.mockResolvedValueOnce(false)
      const audioRes = await manager.pushAudio(new Uint8Array([0, 1]))
      expect(audioRes.success).toBe(false)
    })

    it('broadcasts preview frame to non-destroyed windows', () => {
      manager.pushPreviewFrame('data:image/jpeg;base64,sample')
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        'virtual-studio:preview-frame',
        'data:image/jpeg;base64,sample',
      )
      expect(mockDestroyedWindow.webContents.send).not.toHaveBeenCalled()
    })

    it('handles duplicate start() calls while already streaming without tearing down sinks', async () => {
      await manager.start(defaultConfig)
      expect(mockCameraSink.start).toHaveBeenCalledTimes(1)
      expect(mockAudioSink.start).toHaveBeenCalledTimes(1)

      // Call start a second time (e.g. from streamer syncWithStore)
      const res = await manager.start({
        ...defaultConfig,
        localMonitoringVolume: 0.5,
      })

      expect(res.success).toBe(true)
      // Sinks should NOT have been restarted (stop was not called, start was not called again)
      expect(mockCameraSink.start).toHaveBeenCalledTimes(1)
      expect(mockAudioSink.start).toHaveBeenCalledTimes(1)
      expect(mockCameraSink.stop).not.toHaveBeenCalled()
    })

    it('cleanupOnExit terminates sinks, tray, HUD window and unloads Linux device nodes', async () => {
      await manager.start(defaultConfig)

      await manager.cleanupOnExit()

      expect(mockCameraSink.stop).toHaveBeenCalled()
      expect(mockAudioSink.stop).toHaveBeenCalled()
      expect(mockTray.destroy).toHaveBeenCalled()
      expect(destroyHudWindow).toHaveBeenCalled()
      if (process.platform === 'linux') {
        expect(teardownLinuxCameraDriver).toHaveBeenCalled()
        expect(teardownLinuxAudioSink).toHaveBeenCalled()
      }

      const status = await manager.getStatus()
      expect(status.isStreaming).toBe(false)
    })
  })
})
