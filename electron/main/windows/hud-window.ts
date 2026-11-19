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
  const win = getHudWindow() ?? createHudWindow()
  if (!win.isDestroyed()) {
    win.show()
    win.setAlwaysOnTop(true, 'screen-saver')
    log.info('[HudWindow] Mini-HUD window shown')
  }
}

export function hideHudWindow(): void {
  if (hudWin && !hudWin.isDestroyed() && hudWin.isVisible()) {
    hudWin.hide()
    log.info('[HudWindow] Mini-HUD window hidden')
  }
}

export function toggleHudWindow(): void {
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
  if (hudWin && !hudWin.isDestroyed()) {
    try {
      hudWin.destroy()
    } catch {
      // ignore
    }
    hudWin = null
  }
}
