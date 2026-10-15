// Entry point of the Electron application.

import {
  app,
  BrowserWindow,
  protocol,
  ProtocolRequest,
  ProtocolResponse,
  Menu,
  screen,
  dialog,
  desktopCapturer,
} from 'electron'
import { initMain as initAudioLoopback } from 'electron-audio-loopback'
import log from 'electron-log/main'
import path from 'node:path'
import fsSync from 'node:fs'
import { VITE_PUBLIC } from './lib/constants'
import { setupLogging } from './lib/logging'
import { registerIpcHandlers } from './ipc'
import { createRecorderWindow } from './windows/recorder-window'
import { onAppQuit, startRecording, loadVideoFromFile } from './features/recording-manager'
import { registerRecordingShortcuts, unregisterRecordingShortcuts } from './features/shortcuts'
import { findProjectArg, markAppReadyForProjects, promptOpenProject, requestOpenProject } from './features/project-open'
import { initializeMouseTrackerDependencies } from './features/mouse-tracker'
import { confirmReplaceSession, isQuitApproved, markQuitApproved } from './features/session-guard'
import { appState } from './state'

// --- Initialization ---
setupLogging()

// Enable system audio loopback capture on macOS (12.3+ via ScreenCaptureKit,
// 14.4+ via CoreAudio Taps with `forceCoreAudioTap: true`). Must run before
// `app.whenReady()` because it appends Chromium feature flags.
// See: https://github.com/alectrocute/electron-audio-loopback
initAudioLoopback({ forceCoreAudioTap: true })

// --- Single instance ---
// A second launch (for example from a `.dthat` file association) must hand the
// path to the running instance instead of starting a rival copy.
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  log.info('[App] Another instance is already running. Quitting this one.')
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const projectPath = findProjectArg(argv)
    if (projectPath) {
      log.info(`[App] Second instance requested to open a project: ${projectPath}`)
      requestOpenProject(projectPath)
      return
    }
    // No project argument: just surface the existing window.
    const win = appState.editorWin ?? appState.recorderWin
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  // macOS delivers double-clicked documents through `open-file`. This must be
  // registered before the app is ready; requests are queued until then.
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    log.info(`[App] open-file received: ${filePath}`)
    requestOpenProject(filePath)
  })
}

// --- App Lifecycle Events ---
app.on('window-all-closed', () => {
  log.info('[App] All windows closed. Quitting.')
  app.quit()
})

app.on('before-quit', onAppQuit)

// Quitting is the other data-loss point. The guard runs once per quit; the
// window's own close handler then lets the window go without asking again.
app.on('before-quit', (event) => {
  if (isQuitApproved()) return
  const editor = appState.editorWin
  if (!editor || editor.isDestroyed()) return

  event.preventDefault()
  void confirmReplaceSession('quit').then((proceed) => {
    if (!proceed) return
    markQuitApproved()
    app.quit()
  })
})

app.on('will-quit', () => {
  // Release the global recording shortcuts before the process goes away.
  unregisterRecordingShortcuts()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createRecorderWindow()
  }
})

app.whenReady().then(async () => {
  if (!gotTheLock) return
  log.info('[App] Ready. Initializing...')

  // Set Dock Menu on macOS
  if (process.platform === 'darwin') {
    const dockMenu = Menu.buildFromTemplate([
      {
        label: 'New Default Recording',
        click: () => {
          if (appState.editorWin && !appState.editorWin.isDestroyed()) {
            dialog.showErrorBox(
              'Action Not Allowed',
              'Please close the current editor session to start a new recording.',
            )
            appState.editorWin.focus()
            return
          }
          if (appState.currentRecordingSession) {
            dialog.showErrorBox('Recording in Progress', 'A recording is already in progress.')
            return
          }

          if (!appState.recorderWin || appState.recorderWin.isDestroyed()) {
            createRecorderWindow()
          }
          appState.recorderWin?.show()

          const primaryDisplay = screen.getPrimaryDisplay()
          startRecording({
            source: 'fullscreen',
            displayId: primaryDisplay.id,
            mic: undefined,
            webcam: undefined,
          })
        },
      },
      {
        label: 'Import Video File...',
        click: () => {
          if (appState.editorWin && !appState.editorWin.isDestroyed()) {
            dialog.showErrorBox('Action Not Allowed', 'Please close the current editor session to import a new video.')
            appState.editorWin.focus()
            return
          }
          if (appState.currentRecordingSession) {
            dialog.showErrorBox('Recording in Progress', 'A recording is already in progress.')
            return
          }

          if (!appState.recorderWin || appState.recorderWin.isDestroyed()) {
            createRecorderWindow()
          }
          appState.recorderWin?.show()
          loadVideoFromFile()
        },
      },
      {
        label: 'Open Project...',
        click: () => {
          void promptOpenProject()
        },
      },
    ])
    app.dock.setMenu(dockMenu)
  }

  // Initialize platform-specific dependencies asynchronously
  initializeMouseTrackerDependencies()

  // Proactively register this app with macOS Screen Recording TCC so it
  // appears in System Settings → Privacy & Security → Screen Recording.
  // This must run after the window is ready.
  if (process.platform === 'darwin') {
    desktopCapturer.getSources({ types: ['screen'] }).catch((e) => {
      log.warn('[Permission] desktopCapturer.getSources failed at startup:', e)
    })
  }

  // Register custom protocol for media files
  protocol.registerFileProtocol(
    'media',
    (request: ProtocolRequest, callback: (response: string | ProtocolResponse) => void) => {
      const url = request.url.replace('media://', '')
      const decodedUrl = decodeURIComponent(url)
      const resourcePath = path.join(VITE_PUBLIC, decodedUrl)

      if (path.isAbsolute(decodedUrl) && fsSync.existsSync(decodedUrl)) {
        return callback(decodedUrl)
      }
      if (fsSync.existsSync(resourcePath)) {
        return callback(resourcePath)
      }
      log.error(`[Protocol] Could not find file: ${decodedUrl}`)
      return callback({ error: -6 }) // FILE_NOT_FOUND
    },
  )

  registerIpcHandlers()
  registerRecordingShortcuts()
  createRecorderWindow()

  // Flush any project queued before ready (open-file / argv) and open a `.dthat`
  // passed on this launch.
  markAppReadyForProjects()
  const startupProject = findProjectArg(process.argv)
  if (startupProject) requestOpenProject(startupProject)
})
