import { ipcMain } from 'electron'
import type {
  VirtualStudioConfig,
  VirtualFramePayload,
  TrayQuickAction,
  VirtualStudioStatus,
} from '../../../../shared/virtual-camera-types'
import { virtualStudioManager } from '../../features/virtual-studio/virtual-studio-manager'
import { showHudWindow, hideHudWindow, toggleHudWindow } from '../../windows/hud-window'

export function registerVirtualStudioHandlers(): void {
  ipcMain.handle('virtual-studio:get-status', async () => {
    return virtualStudioManager.getStatus()
  })

  ipcMain.handle('virtual-studio:install-driver', async () => {
    return virtualStudioManager.installDriver()
  })

  ipcMain.handle('virtual-studio:start', async (_event, config: VirtualStudioConfig) => {
    return virtualStudioManager.start(config)
  })

  ipcMain.handle('virtual-studio:stop', async () => {
    return virtualStudioManager.stop()
  })

  ipcMain.handle('virtual-studio:push-frame', async (_event, payload: VirtualFramePayload) => {
    return virtualStudioManager.pushFrame(payload)
  })

  ipcMain.handle('virtual-studio:push-audio', async (_event, buffer: Uint8Array | ArrayBuffer) => {
    return virtualStudioManager.pushAudio(buffer)
  })

  ipcMain.handle('virtual-studio:trigger-action', async (_event, action: TrayQuickAction) => {
    return virtualStudioManager.triggerAction(action)
  })

  ipcMain.on('virtual-studio:update-status', (_event, patch: Partial<VirtualStudioStatus>) => {
    void virtualStudioManager.updateStatus(patch)
  })

  ipcMain.on('virtual-studio:push-preview-frame', (_event, dataUrl: string) => {
    virtualStudioManager.pushPreviewFrame(dataUrl)
  })

  ipcMain.on('virtual-studio:show-hud', () => {
    showHudWindow()
  })

  ipcMain.on('virtual-studio:hide-hud', () => {
    hideHudWindow()
  })

  ipcMain.on('virtual-studio:toggle-hud', () => {
    toggleHudWindow()
  })
}
