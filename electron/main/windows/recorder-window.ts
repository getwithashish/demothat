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

  log.info(
    `[RecorderWindow] Creating recorder BrowserWindow at (${x}, ${y}), size ${windowWidth}x${windowHeight} (WorkArea: ${screenWidth}x${screenHeight})`,
  )

  const win = new BrowserWindow({
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
  appState.recorderWin = win
  log.info(`[RecorderWindow] BrowserWindow instance created (ID: ${win.id})`)

  // Window state and lifecycle listeners
  win.on('show', () => {
    log.info('[RecorderWindow] Window event: show')
  })
  win.on('hide', () => {
    log.info('[RecorderWindow] Window event: hide')
  })
  win.on('focus', () => {
    log.debug('[RecorderWindow] Window event: focus')
  })
  win.on('blur', () => {
    log.debug('[RecorderWindow] Window event: blur')
  })
  win.on('minimize', () => {
    log.info('[RecorderWindow] Window event: minimize')
  })
  win.on('restore', () => {
    log.info('[RecorderWindow] Window event: restore')
  })
  win.on('unresponsive', () => {
    log.warn('[RecorderWindow] Window became unresponsive')
  })
  win.on('responsive', () => {
    log.info('[RecorderWindow] Window responsive again')
  })

  // WebContents lifecycle and crash events
  win.webContents.on('did-start-loading', () => {
    log.info('[RecorderWindow] webContents: did-start-loading')
  })
  win.webContents.on('did-finish-load', () => {
    log.info(`[RecorderWindow] webContents: did-finish-load (URL: ${win.webContents.getURL()})`)
  })
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log.error(
      `[RecorderWindow] webContents: did-fail-load (code: ${errorCode}, error: ${errorDescription}, URL: ${validatedURL})`,
    )
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    log.error(
      `[RecorderWindow] webContents: render-process-gone (reason: ${details.reason}, exitCode: ${details.exitCode})`,
    )
  })
  win.webContents.on('unresponsive', () => {
    log.warn('[RecorderWindow] webContents became unresponsive')
  })
  win.webContents.on('responsive', () => {
    log.info('[RecorderWindow] webContents responsive again')
  })

  if (VITE_DEV_SERVER_URL) {
    log.info(`[RecorderWindow] Loading dev server URL: ${VITE_DEV_SERVER_URL}`)
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    const indexPath = path.join(RENDERER_DIST, 'index.html')
    log.info(`[RecorderWindow] Loading file: ${indexPath}`)
    win.loadFile(indexPath)
  }

  win.on('close', (event) => {
    if (appState.ffmpegProcess) {
      log.warn('[RecorderWindow] Close requested during active recording. Aborting and cleaning up...')
      event.preventDefault()
      cleanupAndDiscard().then(() => {
        if (appState.recorderWin && !appState.recorderWin.isDestroyed()) {
          log.info('[RecorderWindow] Recording cleaned up. Destroying window.')
          appState.recorderWin.close()
        }
      })
    } else {
      log.info('[RecorderWindow] Closed normally before recording. Resetting cursor scale.')
      resetCursorScale()
    }
  })

  win.on('closed', () => {
    log.info('[RecorderWindow] Window closed. Nulling appState.recorderWin.')
    appState.recorderWin = null
  })

  // The renderer sizes the window to its dock content; keep it centred
  // horizontally and never wider than the work area.
  // removeAllListeners first: the window can be recreated (see "New recording"),
  // and ipcMain.on would otherwise stack a duplicate handler per creation.
  ipcMain.removeAllListeners('recorder:set-size')
  ipcMain.on('recorder:set-size', (_event, { width, height }: { width: number; height: number }) => {
    const activeWin = appState.recorderWin
    if (!activeWin || activeWin.isDestroyed()) return

    const workArea = screen.getPrimaryDisplay().workAreaSize
    const nextWidth = Math.max(320, Math.min(Math.round(width), workArea.width))
    const nextHeight = Math.max(120, Math.min(Math.round(height), workArea.height))
    const nextX = Math.max(0, Math.round((workArea.width - nextWidth) / 2))
    const nextY = activeWin.getBounds().y
    log.info(`[RecorderWindow] Resizing to ${nextWidth}x${nextHeight} at x=${nextX}`)
    activeWin.setBounds({ x: nextX, y: nextY, width: nextWidth, height: nextHeight })
  })

  ipcMain.on('recorder:click-through', () => {
    const activeWin = appState.recorderWin
    if (activeWin && !activeWin.isDestroyed()) {
      log.info('[RecorderWindow] Enabling temporary mouse click-through (100ms)')
      // Use Electron's built-in solution for Windows & macOS
      activeWin.setIgnoreMouseEvents(true, { forward: true })
      setTimeout(() => {
        if (activeWin && !activeWin.isDestroyed()) {
          activeWin.setIgnoreMouseEvents(false)
          log.info('[RecorderWindow] Mouse click-through restored to normal.')
        }
      }, 100)
    }
  })
}
