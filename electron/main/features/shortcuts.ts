// Global keyboard shortcuts for starting and stopping a recording.
//
// The recorder window is minimized while a recording is in progress
// (see recording-manager startActualRecording), so a window-scoped shortcut
// could never stop it. These are registered as *global* shortcuts so they work
// from any window, even when DemoThat is not focused.

import log from 'electron-log/main'
import { dialog, globalShortcut } from 'electron'
import { appState } from '../state'
import { RECORDING_SHORTCUTS } from '../lib/constants'
import { requiresPortalCapture } from '../lib/capture-backend'
import { stopRecording } from './recording-manager'
import { createRecorderWindow } from '../windows/recorder-window'

function isRecordingInProgress(): boolean {
  // currentRecordingSession is created as soon as capture starts; selectionWin
  // covers the area-selection step that runs before the session exists.
  return appState.currentRecordingSession !== null || appState.selectionWin !== null
}

/**
 * Registers the global start/stop recording shortcuts. Call once after
 * app.whenReady(); unregister on quit.
 */
export function registerRecordingShortcuts(): void {
  const wayland = requiresPortalCapture()
  const startRegistered = globalShortcut.register(RECORDING_SHORTCUTS.start, () => {
    handleStartShortcut()
  })
  if (!startRegistered) {
    log.warn(
      wayland
        ? `[Shortcuts] Could not register ${RECORDING_SHORTCUTS.start}. On Wayland this needs the desktop's shortcut portal (GNOME 46+, KDE 6+); the recorder's own buttons still work.`
        : `[Shortcuts] Could not register start shortcut ${RECORDING_SHORTCUTS.start} (already in use?)`,
    )
  }

  const stopRegistered = globalShortcut.register(RECORDING_SHORTCUTS.stop, () => {
    void handleStopShortcut()
  })
  if (!stopRegistered) {
    log.warn(
      wayland
        ? `[Shortcuts] Could not register ${RECORDING_SHORTCUTS.stop}. On Wayland this needs the desktop's shortcut portal (GNOME 46+, KDE 6+); the recorder's own buttons still work.`
        : `[Shortcuts] Could not register stop shortcut ${RECORDING_SHORTCUTS.stop} (already in use?)`,
    )
  }
}

/** Releases the global shortcuts. Call on app quit. */
export function unregisterRecordingShortcuts(): void {
  globalShortcut.unregister(RECORDING_SHORTCUTS.start)
  globalShortcut.unregister(RECORDING_SHORTCUTS.stop)
}

function handleStartShortcut(): void {
  if (isRecordingInProgress()) {
    log.info('[Shortcuts] Start shortcut ignored — a recording is already in progress.')
    return
  }

  // Mirror the dock menu: never start a new recording over an open editor
  // session, or the editor's media files would be replaced underneath it.
  if (appState.editorWin && !appState.editorWin.isDestroyed()) {
    dialog.showErrorBox('Action Not Allowed', 'Please close the current editor session to start a new recording.')
    appState.editorWin.focus()
    return
  }

  if (!appState.recorderWin || appState.recorderWin.isDestroyed()) {
    createRecorderWindow()
  }
  const win = appState.recorderWin
  if (!win) return
  win.show()
  win.focus()

  // Let the recorder run its own start flow so it uses the user's current
  // source / device selections instead of hardcoding a capture.
  sendToRecorderWhenReady(win, 'recorder:trigger-start')
}

async function handleStopShortcut(): Promise<void> {
  if (!isRecordingInProgress()) {
    log.info('[Shortcuts] Stop shortcut ignored — no recording in progress.')
    return
  }
  await stopRecording()
}

/** Sends an IPC message once the recorder's renderer has finished loading. */
function sendToRecorderWhenReady(win: Electron.BrowserWindow, channel: string): void {
  const wc = win.webContents
  if (wc.isLoading()) {
    wc.once('did-finish-load', () => {
      if (!win.isDestroyed()) wc.send(channel)
    })
  } else {
    wc.send(channel)
  }
}
