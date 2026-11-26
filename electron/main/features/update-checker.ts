// Auto-update lifecycle manager using electron-updater.
//
// Supported platforms (full download-and-replace):
//   • AppImage (Linux) — detected via the APPIMAGE env var set by the runtime
//   • Windows NSIS    — always supported on win32
//
// Fallback (graceful: show banner that opens the GitHub release page):
//   • deb / rpm (Linux) — managed by the system package manager; bypassing it
//     would break uninstall / file ownership, so we never auto-install there.
//   • macOS — requires a code-signed, notarized app; fall back until certs are
//     added to CI secrets.
//
// VERSIONED FILENAME EDGE CASE
// ─────────────────────────────
// electron-builder names each release artifact with its version, e.g.:
//   DemoThat-1.2.0-linux-x64.AppImage
//   DemoThat-1.3.0-linux-x64.AppImage
//
// electron-updater reads the exact filename from the latest-linux.yml /
// latest.yml metadata file that electron-builder generates alongside the
// binary. It downloads the new binary by that exact name, then replaces the
// FILE AT THE PATH STORED IN process.env.APPIMAGE (the currently running
// AppImage) with the new bytes in-place. The on-disk filename of the
// previously-downloaded AppImage stays unchanged; only its content is updated.
// This means versioned artifact names are NOT a problem — the update always
// writes to wherever the user originally placed the file.
//
// The only requirement is that latest-linux.yml / latest.yml are uploaded to
// the GitHub Release alongside the binary. The CI workflow's upload glob has
// been updated to include *.yml for exactly this reason.

import log from 'electron-log/main'
import { app, net, BrowserWindow } from 'electron'

// NOTE: electron-updater is imported lazily inside initAutoUpdater() so that
// module-level code (the autoUpdater singleton getter) only runs in a live
// Electron process — never during Vitest, where `app.getVersion()` is not
// available and would throw "Cannot read properties of undefined".
// Do NOT move `import { autoUpdater } from 'electron-updater'` to the top level.

/** Returns true when electron-updater can perform a full auto-update on this platform/format. */
function isAutoUpdateSupported(): boolean {
  if (process.platform === 'linux') {
    // The AppImage runtime always sets APPIMAGE to the path of the running
    // .AppImage file. Its absence means we're running from a deb, rpm, zip or
    // the extracted directory — none of which support electron-updater.
    const isAppImage = Boolean(process.env.APPIMAGE)
    if (!isAppImage) {
      log.info('[Updater] Running as deb/rpm/zip — full auto-update not supported; will use GitHub fallback.')
    }
    return isAppImage
  }
  if (process.platform === 'win32') return true
  // macOS: electron-updater requires a notarized, code-signed app to swap
  // the binary. Fall back to the GitHub page until certs are in CI.
  if (process.platform === 'darwin') {
    log.info('[Updater] macOS without code-signing — full auto-update not supported; will use GitHub fallback.')
    return false
  }
  return false
}

/**
 * Initialize the auto-updater on startup.
 *
 * @param getWindow - Lazy getter for the main BrowserWindow so the updater
 *   can push IPC events to the renderer even if the window was not yet created
 *   when this function is called.
 */
export function initAutoUpdater(getWindow: () => BrowserWindow | null) {
  log.info('[Updater] Initializing auto-updater...')

  if (!isAutoUpdateSupported()) {
    // deb/rpm/macOS: fall back to the lightweight GitHub API check so users
    // at least see a notification with a link to the release page.
    runGithubApiFallback(getWindow)
    return
  }

  // Lazy import: the electron-updater singleton accesses app.getVersion() on
  // first access. That is safe here because we are inside app.whenReady(), but
  // it would crash Vitest where the electron mock has no getVersion. By keeping
  // the import dynamic we guarantee the module-level getter only runs in a live
  // Electron process.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')

  // Wire electron-updater's internal logger to electron-log so all update
  // activity lands in the same log file as the rest of the app.
  autoUpdater.logger = log
  // Download automatically as soon as a new version is found.
  autoUpdater.autoDownload = true
  // Never silently install on quit — we always prompt the user first.
  autoUpdater.autoInstallOnAppQuit = false
  // Only follow stable releases; ignore pre-release / beta tags from staging.
  autoUpdater.allowPrerelease = false

  const send = (channel: string, payload?: unknown) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }

  autoUpdater.on('checking-for-update', () => {
    log.info('[Updater] Checking for update...')
  })

  autoUpdater.on('update-available', (info) => {
    log.info(`[Updater] Update available: ${info.version}`)
    // The renderer shows a "downloading…" indicator once this fires.
    send('update:checking', { version: info.version })
  })

  autoUpdater.on('update-not-available', (info) => {
    log.info(`[Updater] Up to date: ${info.version}`)
  })

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent)
    log.info(`[Updater] Download progress: ${pct}%`)
    send('update:progress', { percent: pct })
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info(`[Updater] Update downloaded: ${info.version}. Ready to install.`)
    // Tell the renderer to show "Restart to install" banner.
    send('update:ready', { version: info.version })
  })

  autoUpdater.on('error', (err) => {
    // Log but do not surface to the user — a failed update check is not
    // worth interrupting the user's workflow. It will retry next launch.
    log.error('[Updater] Error:', err)
  })

  // Only check in a packaged build. In dev mode electron-updater will error
  // because there is no latest.yml beside the executable.
  if (app.isPackaged) {
    log.info('[Updater] App is packaged — triggering update check.')
    autoUpdater.checkForUpdates().catch((err: unknown) => {
      log.warn('[Updater] checkForUpdates() threw (will retry next launch):', err)
    })
  } else {
    log.info('[Updater] Dev mode — skipping update check.')
  }
}

/**
 * Trigger quit-and-install when the user clicks "Restart to install".
 * isSilent=false → show a progress UI on Windows.
 * isForceRunAfter=true → always relaunch the app after the update.
 */
export function quitAndInstall(): void {
  log.info('[Updater] User requested quit-and-install.')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
  autoUpdater.quitAndInstall(false, true)
}

// ---------------------------------------------------------------------------
// Fallback: lightweight GitHub Releases API check for non-auto-updatable
// platforms (deb, rpm, macOS without signing). Sends update:available with
// { version, url, autoUpdate: false } so the renderer shows a "open GitHub"
// banner instead of the download/restart flow.
// ---------------------------------------------------------------------------
function runGithubApiFallback(getWindow: () => BrowserWindow | null) {
  const repoOwner = 'getwithashish'
  const repoName = 'DemoThat'
  const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`
  const maxAttempts = 3
  let currentAttempt = 0

  const attemptRequest = () => {
    currentAttempt++
    log.info(`[Updater:Fallback] Attempt ${currentAttempt}/${maxAttempts}...`)

    const request = net.request({ method: 'GET', url: apiUrl })
    request.setHeader('User-Agent', 'DemoThat-UpdateChecker')

    request.on('response', (response) => {
      if (response.statusCode === 200) {
        let body = ''
        response.on('data', (chunk) => {
          body += chunk.toString()
        })
        response.on('end', () => {
          try {
            const release = JSON.parse(body)
            // Skip pre-releases — only notify for stable tags.
            if (release.prerelease) {
              log.info('[Updater:Fallback] Latest release is a pre-release — skipping.')
              return
            }
            const rawTag: string = release.tag_name ?? ''
            const latestVersion = rawTag.startsWith('v') ? rawTag.slice(1) : rawTag
            const downloadUrl: string = release.html_url ?? ''
            const currentVersion = app.getVersion()

            if (latestVersion && latestVersion > currentVersion) {
              log.info(`[Updater:Fallback] New version available: ${latestVersion}`)
              const win = getWindow()
              if (win && !win.isDestroyed()) {
                win.webContents.send('update:available', {
                  version: latestVersion,
                  url: downloadUrl,
                  autoUpdate: false,
                })
              }
            } else {
              log.info(`[Updater:Fallback] App is up to date (current=${currentVersion}, latest=${latestVersion}).`)
            }
          } catch (error) {
            log.error('[Updater:Fallback] Failed to parse release JSON:', error)
          }
        })
      } else {
        log.warn(`[Updater:Fallback] HTTP ${response.statusCode}`)
        if (currentAttempt < maxAttempts) {
          setTimeout(attemptRequest, 3000)
        }
      }
    })

    request.on('error', (error) => {
      log.warn('[Updater:Fallback] Network error:', error.message)
      if (currentAttempt < maxAttempts) {
        setTimeout(attemptRequest, 3000)
      }
    })

    request.end()
  }

  if (app.isPackaged) {
    attemptRequest()
  } else {
    log.info('[Updater:Fallback] Dev mode — skipping GitHub API fallback check.')
  }
}
