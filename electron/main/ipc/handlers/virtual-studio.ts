import { ipcMain } from 'electron'
import log from 'electron-log/main'
import type {
  VirtualStudioConfig,
  VirtualFramePayload,
  TrayQuickAction,
  VirtualStudioStatus,
} from '../../../../shared/virtual-camera-types'
import { virtualStudioManager } from '../../features/virtual-studio/virtual-studio-manager'
import { showHudWindow, hideHudWindow, toggleHudWindow } from '../../windows/hud-window'

export function registerVirtualStudioHandlers(): void {
  log.info('[VirtualStudioIPC] Registering Virtual Studio IPC handlers...')

  ipcMain.handle('virtual-studio:get-status', async () => {
    const status = await virtualStudioManager.getStatus()
    log.info(
      `[VirtualStudioIPC] get-status: isStreaming=${status.isStreaming}, isCameraActive=${status.isCameraActive}, isMicActive=${status.isMicActive}, activeSource=${status.activeSource}`,
    )
    return status
  })

  ipcMain.handle('virtual-studio:install-driver', async () => {
    log.info('[VirtualStudioIPC] Installing virtual camera driver...')
    const result = await virtualStudioManager.installDriver()
    log.info(`[VirtualStudioIPC] Driver installation complete: success=${result.success}`)
    return result
  })

  ipcMain.handle('virtual-studio:start', async (_event, config: VirtualStudioConfig) => {
    const res = config.outputResolution
    log.info(
      `[VirtualStudioIPC] Starting Virtual Studio (Resolution: ${res?.width ?? 1920}x${res?.height ?? 1080} @ ${res?.fps ?? 30}fps, enableCamera: ${config.enableCamera}, enableMic: ${config.enableMic})`,
    )
    const result = await virtualStudioManager.start(config)
    log.info(`[VirtualStudioIPC] Virtual Studio start result: success=${result.success}`)
    return result
  })

  ipcMain.handle('virtual-studio:stop', async () => {
    log.info('[VirtualStudioIPC] Stopping Virtual Studio...')
    const result = await virtualStudioManager.stop()
    log.info(`[VirtualStudioIPC] Virtual Studio stop result: success=${result.success}`)
    return result
  })

  ipcMain.on('virtual-studio:push-frame', (_event, payload: VirtualFramePayload) => {
    void virtualStudioManager.pushFrame(payload).catch((err) => {
      log.warn('[VirtualStudioIPC] Error pushing frame:', err)
    })
  })

  ipcMain.on('virtual-studio:push-audio', (_event, buffer: Uint8Array | ArrayBuffer) => {
    void virtualStudioManager.pushAudio(buffer).catch((err) => {
      log.warn('[VirtualStudioIPC] Error pushing audio:', err)
    })
  })

  ipcMain.handle('virtual-studio:trigger-action', async (_event, action: TrayQuickAction) => {
    log.info(`[VirtualStudioIPC] Triggering action: ${action}`)
    return virtualStudioManager.triggerAction(action)
  })

  ipcMain.on('virtual-studio:update-status', (_event, patch: Partial<VirtualStudioStatus>) => {
    log.info('[VirtualStudioIPC] Updating status patch:', patch)
    void virtualStudioManager.updateStatus(patch)
  })

  ipcMain.on('virtual-studio:push-preview-frame', (_event, dataUrl: string) => {
    virtualStudioManager.pushPreviewFrame(dataUrl)
  })

  ipcMain.on('virtual-studio:show-hud', () => {
    log.info('[VirtualStudioIPC] show-hud event received')
    showHudWindow()
  })

  ipcMain.on('virtual-studio:hide-hud', () => {
    log.info('[VirtualStudioIPC] hide-hud event received')
    hideHudWindow()
  })

  ipcMain.on('virtual-studio:toggle-hud', () => {
    log.info('[VirtualStudioIPC] toggle-hud event received')
    toggleHudWindow()
  })
}
