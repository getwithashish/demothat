import { BrowserWindow, screen } from 'electron'
import { format as formatUrl } from 'node:url'
import path from 'node:path'
import log from 'electron-log/main'
import { VITE_DEV_SERVER_URL, RENDERER_DIST, PRELOAD_SCRIPT } from '../lib/constants'

let hudWin: BrowserWindow | null = null

export function createHudWindow(): BrowserWindow {
  if (hudWin && !hudWin.isDestroyed()) {
    return hudWin
  }

  let x: number | undefined
  let y: number | undefined

  try {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize
    const windowWidth = 280
    const windowHeight = 180
    x = Math.max(0, screenWidth - windowWidth - 32)
    y = Math.max(0, screenHeight - windowHeight - 48)
  } catch (err) {
    log.warn('[HudWindow] Could not calculate primary display bounds:', err)
  }

  hudWin = new BrowserWindow({
    width: 280,
    height: 180,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    hasShadow: true,
    webPreferences: {
      preload: PRELOAD_SCRIPT,
      backgroundThrottling: false,
    },
  })
  log.info(`[HudWindow] Mini-HUD BrowserWindow created at (${x ?? 'auto'}, ${y ?? 'auto'})`)

  // Window event listeners
  hudWin.on('show', () => {
    log.info('[HudWindow] Window event: show')
  })
  hudWin.on('hide', () => {
    log.info('[HudWindow] Window event: hide')
  })
  hudWin.on('focus', () => {
    log.debug('[HudWindow] Window event: focus')
  })
  hudWin.on('blur', () => {
    log.debug('[HudWindow] Window event: blur')
  })
  hudWin.on('unresponsive', () => {
    log.warn('[HudWindow] Window became unresponsive')
  })
  hudWin.on('responsive', () => {
    log.info('[HudWindow] Window responsive again')
  })

  // WebContents event listeners (safely guarded for test environments)
  if (hudWin.webContents && typeof hudWin.webContents.on === 'function') {
    hudWin.webContents.on('did-start-loading', () => {
      log.info('[HudWindow] webContents: did-start-loading')
    })
    hudWin.webContents.on('did-finish-load', () => {
      log.info(`[HudWindow] webContents: did-finish-load (URL: ${hudWin?.webContents?.getURL?.() ?? 'unknown'})`)
    })
    hudWin.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      log.error(
        `[HudWindow] webContents: did-fail-load (code: ${errorCode}, error: ${errorDescription}, URL: ${validatedURL})`,
      )
    })
    hudWin.webContents.on('render-process-gone', (_event, details) => {
      log.error(
        `[HudWindow] webContents: render-process-gone (reason: ${details.reason}, exitCode: ${details.exitCode})`,
      )
    })
  }

  hudWin.setAlwaysOnTop(true, 'screen-saver')
  try {
    hudWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } catch {
    // Unsupported on some Linux window managers
  }

  const hudUrl = VITE_DEV_SERVER_URL
    ? `${VITE_DEV_SERVER_URL}#mini-hud`
    : formatUrl({
        pathname: path.join(RENDERER_DIST, 'index.html'),
        protocol: 'file:',
        slashes: true,
        hash: 'mini-hud',
      })

  log.info(`[HudWindow] Loading HUD URL: ${hudUrl}`)
  void hudWin.loadURL(hudUrl)

  hudWin.on('closed', () => {
    hudWin = null
    log.info('[HudWindow] Mini-HUD window closed')
  })

  return hudWin
}

export function showHudWindow(): void {
  log.info('[HudWindow] showHudWindow called')
  const win = getHudWindow() ?? createHudWindow()
  if (!win.isDestroyed()) {
    win.show()
    win.setAlwaysOnTop(true, 'screen-saver')
    log.info('[HudWindow] Mini-HUD window shown and pinned to screen-saver level')
  }
}

export function hideHudWindow(): void {
  log.info('[HudWindow] hideHudWindow called')
  if (hudWin && !hudWin.isDestroyed() && hudWin.isVisible()) {
    hudWin.hide()
    log.info('[HudWindow] Mini-HUD window hidden')
  }
}

export function toggleHudWindow(): void {
  log.info('[HudWindow] toggleHudWindow called')
  if (hudWin && !hudWin.isDestroyed() && hudWin.isVisible()) {
    hideHudWindow()
  } else {
    showHudWindow()
  }
}

export function getHudWindow(): BrowserWindow | null {
  if (hudWin && !hudWin.isDestroyed()) {
    return hudWin
  }
  return null
}

export function destroyHudWindow(): void {
  log.info('[HudWindow] destroyHudWindow called')
  if (hudWin && !hudWin.isDestroyed()) {
    try {
      hudWin.destroy()
      log.info('[HudWindow] Mini-HUD window destroyed successfully')
    } catch (err) {
      log.warn('[HudWindow] Error destroying Mini-HUD window:', err)
    }
    hudWin = null
  }
}
