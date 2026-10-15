// Logic to create and manage the editor window.

import log from 'electron-log/main'
import { BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import Store from 'electron-store'
import { format as formatUrl } from 'node:url'
import { appState } from '../state'
import { cleanupOrphanedRecordings } from '../features/recording-manager'
import { checkForUpdates } from '../features/update-checker'
import { VITE_DEV_SERVER_URL, RENDERER_DIST, PRELOAD_SCRIPT } from '../lib/constants'
import { createEditorMenu, clearMenu } from '../features/app-menu'
import { confirmReplaceSession, isQuitApproved } from '../features/session-guard'
import { RecordingGeometry } from '../state'

const store = new Store() // Can be configured with schema if needed

/**
 * Creates and configures the editor BrowserWindow, loads the editor route and
 * returns the window. Callers attach their own `did-finish-load` handler to
 * deliver the initial payload (a recording session or an opened project).
 */
function setupEditorWindow(): BrowserWindow {
  const bounds = store.get('windowBounds', { width: 1280, height: 800 }) as {
    x?: number
    y?: number
    width: number
    height: number
  }

  const isWindows = process.platform === 'win32'
  let titleBarOptions = {}

  if (isWindows) {
    const appearance = store.get('appearance') as { mode?: 'light' | 'dark' } | undefined
    const isDarkMode = appearance?.mode === 'dark'

    titleBarOptions = {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: isDarkMode ? '#17181b' : '#f6f5f2', // Paper tokens: --sa-panel (dark/light)
        symbolColor: isDarkMode ? '#ebecee' : '#1d1d1b', // Paper tokens: --sa-text (dark/light)
        height: 48, // h-12 in Tailwind
      },
    }
  }

  const win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC!, 'demothat-appicon.png'),
    autoHideMenuBar: true,
    ...bounds,
    minWidth: 1280,
    minHeight: 720,
    frame: false,
    titleBarStyle: 'hidden', // Keep hidden for all platforms
    ...titleBarOptions, // Apply Windows-specific overlay
    show: false,
    webPreferences: {
      preload: PRELOAD_SCRIPT,
      webSecurity: !VITE_DEV_SERVER_URL,
    },
  })
  appState.editorWin = win

  // Set the application menu for the editor window
  createEditorMenu()

  // Add listeners for maximize/unmaximize
  win.on('maximize', () => {
    win.webContents.send('window:state-changed', { isMaximized: true })
  })
  win.on('unmaximize', () => {
    win.webContents.send('window:state-changed', { isMaximized: false })
  })

  win.maximize()

  // Cleanup orphaned recordings
  cleanupOrphanedRecordings()

  // Save bounds logic
  let resizeTimeout: NodeJS.Timeout
  const saveBounds = () => {
    if (!win.isDestroyed() && !win.isMaximized()) {
      store.set('windowBounds', win.getBounds())
    }
  }
  const debouncedSaveBounds = () => {
    clearTimeout(resizeTimeout)
    resizeTimeout = setTimeout(saveBounds, 500)
  }
  win.on('resize', debouncedSaveBounds)
  win.on('move', debouncedSaveBounds)

  // Closing is a data-loss point: let the session guard flush a save (or ask)
  // before the window — and its temp recording files — go away.
  let isCloseApproved = false
  win.on('close', (event) => {
    saveBounds()
    // The quit guard has already asked for this window; do not ask twice.
    if (isCloseApproved || isQuitApproved()) return
    event.preventDefault()
    void confirmReplaceSession('close').then((proceed) => {
      if (!proceed || win.isDestroyed()) return
      isCloseApproved = true
      win.close()
    })
  })

  win.on('closed', () => {
    // Clear the application menu when the editor window is closed
    clearMenu()
    if (appState.currentEditorSessionFiles) {
      cleanupEditorFiles(appState.currentEditorSessionFiles)
      appState.currentEditorSessionFiles = null
    }
    appState.editorWin = null
    appState.editorProjectDirty = false
  })

  win.show()

  const editorUrl = VITE_DEV_SERVER_URL
    ? `${VITE_DEV_SERVER_URL}#editor`
    : formatUrl({ pathname: path.join(RENDERER_DIST, 'index.html'), protocol: 'file:', slashes: true, hash: 'editor' })

  log.info(`[EditorWindow] Loading URL: ${editorUrl}`)
  win.loadURL(editorUrl)

  return win
}

export function createEditorWindow(
  videoPath: string,
  metadataPath: string,
  recordingGeometry: RecordingGeometry,
  webcamVideoPath?: string,
) {
  appState.currentEditorSessionFiles = { screenVideoPath: videoPath, metadataPath, recordingGeometry, webcamVideoPath }
  log.info('[EditorWindow] Stored session files for cleanup:', appState.currentEditorSessionFiles)

  const win = setupEditorWindow()

  win.webContents.on('did-finish-load', () => {
    log.info(`[EditorWindow] Finished loading. Sending project data.`)
    win.webContents.send('project:open', { videoPath, metadataPath, webcamVideoPath })
    checkForUpdates(win)
  })

  return win
}

/**
 * Creates an editor window for an already-opened project. The caller delivers
 * the payload once the renderer is ready (see requestOpenProject).
 */
export function createEditorWindowForProject(): BrowserWindow {
  appState.currentEditorSessionFiles = null
  appState.editorProjectDirty = false
  return setupEditorWindow()
}

export async function cleanupEditorFiles(files: {
  screenVideoPath: string
  metadataPath: string
  webcamVideoPath?: string
  systemAudioPath?: string
  screenWebmPath?: string
  micAudioPath?: string
}) {
  log.info('[EditorWindow] Cleaning up session files:', files)
  const unlinkPromises = [
    files.screenVideoPath,
    files.webcamVideoPath,
    files.metadataPath,
    files.systemAudioPath,
    files.screenWebmPath,
    files.micAudioPath,
  ]
    .filter(Boolean)
    .map((filePath) => (fsSync.existsSync(filePath!) ? fs.unlink(filePath!) : Promise.resolve()))
  try {
    await Promise.all(unlinkPromises)
    log.info('[EditorWindow] Session files deleted successfully.')
  } catch (error) {
    log.error('[EditorWindow] Could not delete session files:', error)
  }
}
