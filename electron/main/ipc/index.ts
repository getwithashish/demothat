import { ipcMain } from 'electron'
import * as appHandlers from './handlers/app'
import * as desktopHandlers from './handlers/desktop'
import * as exportHandlers from './handlers/export'
import * as fsHandlers from './handlers/file-system'
import * as recordingHandlers from './handlers/recording'
import * as projectHandlers from './handlers/project'
import * as settingsHandlers from './handlers/settings'
import * as shellHandlers from './handlers/shell'

export function registerIpcHandlers() {
  // App & Window
  ipcMain.handle('app:getPath', appHandlers.handleGetPath)
  ipcMain.handle('app:getVersion', appHandlers.handleGetVersion)
  ipcMain.handle('app:getPlatform', appHandlers.handleGetPlatform)
  ipcMain.on('window:minimize', appHandlers.minimizeWindow)
  ipcMain.on('window:maximize', appHandlers.maximizeWindow)
  ipcMain.on('window:close', appHandlers.closeWindow)
  ipcMain.handle('window:isMaximized', appHandlers.handleIsMaximized)
  ipcMain.on('window:update-title-bar-overlay', appHandlers.updateTitleBarOverlay)
  ipcMain.on('app:show-recorder', appHandlers.showRecorderWindow)

  // Interface zoom (see desktop handlers)
  ipcMain.handle('window:zoom-in', desktopHandlers.handleZoomIn)
  ipcMain.handle('window:zoom-out', desktopHandlers.handleZoomOut)
  ipcMain.handle('window:zoom-reset', desktopHandlers.handleZoomReset)
  ipcMain.handle('window:zoom-factor', desktopHandlers.handleGetZoomFactor)

  // Desktop
  ipcMain.handle('desktop:get-displays', desktopHandlers.getDisplays)
  ipcMain.handle('desktop:get-dshow-devices', desktopHandlers.getDshowDevices)
  ipcMain.handle('desktop:get-cursor-scale', desktopHandlers.handleGetCursorScale)
  ipcMain.on('desktop:set-cursor-scale', desktopHandlers.handleSetCursorScale)
  ipcMain.handle('dialog:showSaveDialog', desktopHandlers.showSaveDialog)
  ipcMain.handle('dialog:openAudioFile', desktopHandlers.handleOpenAudioFile)
  ipcMain.handle('dialog:openVideoFiles', desktopHandlers.handleOpenVideoFiles)
  ipcMain.handle('video:detectSilence', desktopHandlers.handleDetectSilence)
  ipcMain.handle('dialog:showMessageBox', desktopHandlers.showMessageBox)
  ipcMain.handle('permission:check-screen-recording', desktopHandlers.checkScreenRecordingPermission)
  ipcMain.handle('video:get-frame', desktopHandlers.getVideoFrame)
  ipcMain.handle('video:has-audio', desktopHandlers.videoHasAudio)

  ipcMain.handle('desktop:get-cursor-themes', desktopHandlers.getCursorThemes)
  ipcMain.handle('desktop:load-cursor-theme', desktopHandlers.loadCursorTheme)
  ipcMain.handle('desktop:map-cursor-name-to-idc', desktopHandlers.handleMapCursorNameToIDC)

  // Recording
  ipcMain.handle('recording:start', recordingHandlers.handleStartRecording)
  ipcMain.on('recording:stop', recordingHandlers.handleStopRecording)
  ipcMain.handle('recording:load-from-file', recordingHandlers.handleLoadVideoFromFile)
  ipcMain.handle('recording:write-system-audio', recordingHandlers.handleWriteSystemAudioChunk)
  ipcMain.handle('recording:system-audio-stopped', recordingHandlers.handleSystemAudioStopped)
  ipcMain.handle('recording:write-screen-video', recordingHandlers.handleWriteScreenVideoChunk)
  ipcMain.handle('recording:screen-capture-stopped', recordingHandlers.handleScreenCaptureStopped)
  ipcMain.handle('recording:get-screen-sources', recordingHandlers.handleGetScreenSources)

  // Project files (.dthat)
  ipcMain.handle('project:save', projectHandlers.handleProjectSave)
  ipcMain.handle('project:save-as', projectHandlers.handleProjectSaveAs)
  ipcMain.handle('project:save-copy', projectHandlers.handleProjectSaveCopy)
  ipcMain.handle('project:rename', projectHandlers.handleProjectRename)
  ipcMain.handle('project:load', projectHandlers.handleProjectLoad)
  ipcMain.on('project:set-dirty', projectHandlers.handleProjectSetDirty)
  ipcMain.on('project:before-replace-result', projectHandlers.handleBeforeReplaceResult)
  ipcMain.on('project:perform-save-result', projectHandlers.handlePerformSaveResult)
  ipcMain.handle('project:prompt-open', projectHandlers.handleProjectPromptOpen)
  ipcMain.handle('project:recovery-info', projectHandlers.handleProjectRecoveryInfo)
  ipcMain.handle('project:open-recovery', projectHandlers.handleProjectOpenRecovery)
  ipcMain.handle('project:recovery-discard', projectHandlers.handleProjectDiscardRecovery)

  // Export
  ipcMain.handle('export:start', exportHandlers.handleStartExport)
  ipcMain.handle('export:capabilities', exportHandlers.handleGetExportCapabilities)
  ipcMain.handle('export:perf', exportHandlers.handleGetExportPerf)
  ipcMain.handle('entitlement:get', exportHandlers.handleGetEntitlement)

  // File System
  ipcMain.handle('fs:readFile', fsHandlers.handleReadFile)

  // Settings & Presets
  ipcMain.handle('presets:load', settingsHandlers.loadPresets)
  ipcMain.handle('presets:save', settingsHandlers.savePresets)
  ipcMain.handle('settings:get', settingsHandlers.getSetting)
  ipcMain.on('settings:set', settingsHandlers.setSetting)

  // Shell
  ipcMain.on('shell:showItemInFolder', shellHandlers.showItemInFolder)
  ipcMain.on('shell:openExternal', shellHandlers.openExternal)
}
