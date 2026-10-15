// Logic to create and manage the recorder window.

import log from 'electron-log/main'
import { BrowserWindow, screen, ipcMain } from 'electron'
import path from 'node:path'
import { appState } from '../state'
import { VITE_DEV_SERVER_URL, RENDERER_DIST, PRELOAD_SCRIPT } from '../lib/constants'
import { cleanupAndDiscard } from '../features/recording-manager'
import { resetCursorScale } from '../features/cursor-manager'

export function createRecorderWindow() {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize
  const windowWidth = 900
  const windowHeight = 360
  const x = Math.round((screenWidth - windowWidth) / 2)
  const y = Math.max(0, Math.round(screenHeight / 4))

  appState.recorderWin = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC!, 'demothat-appicon.png'),
    width: windowWidth,
    height: windowHeight,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      preload: PRELOAD_SCRIPT,
      // The recorder window is minimized while a recording is in progress.
      // Without this, macOS throttles renderer JS and the system-audio
      // MediaRecorder underruns, dropping audio chunks.
      backgroundThrottling: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    appState.recorderWin.loadURL(VITE_DEV_SERVER_URL)
  } else {
    appState.recorderWin.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  appState.recorderWin.on('close', (event) => {
    if (appState.ffmpegProcess) {
      log.warn('[RecorderWindow] Closed during recording. Cleaning up...')
      event.preventDefault()
      cleanupAndDiscard().then(() => {
        if (appState.recorderWin && !appState.recorderWin.isDestroyed()) {
          appState.recorderWin.close()
        }
      })
    } else {
      log.info('[RecorderWindow] Closed before recording. Resetting cursor scale.')
      resetCursorScale()
    }
  })

  appState.recorderWin.on('closed', () => {
    appState.recorderWin = null
  })

  // The renderer sizes the window to its dock content; keep it centred
  // horizontally and never wider than the work area.
  ipcMain.on('recorder:set-size', (_event, { width, height }: { width: number; height: number }) => {
    const win = appState.recorderWin
    if (!win || win.isDestroyed()) return

    const workArea = screen.getPrimaryDisplay().workAreaSize
    const nextWidth = Math.max(320, Math.min(Math.round(width), workArea.width))
    const nextHeight = Math.max(120, Math.min(Math.round(height), workArea.height))
    const x = Math.max(0, Math.round((workArea.width - nextWidth) / 2))
    const y = win.getBounds().y
    log.info(`[RecorderWindow] Resizing to ${nextWidth}x${nextHeight} at x=${x}`)
    win.setBounds({ x, y, width: nextWidth, height: nextHeight })
  })

  ipcMain.on('recorder:click-through', () => {
    const win = appState.recorderWin
    if (win && !win.isDestroyed()) {
      // Use Electron's built-in solution for Windows & macOS
      win.setIgnoreMouseEvents(true, { forward: true })
      setTimeout(() => {
        if (win && !win.isDestroyed()) {
          win.setIgnoreMouseEvents(false)
        }
      }, 100)
    }
  })
}
