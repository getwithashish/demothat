/* eslint-disable @typescript-eslint/no-explicit-any */
// "Clean Demo Mode": temporarily strips desktop clutter so a recording shows
// only the content the user is presenting, then puts everything back.
//
// macOS gets the full treatment — Dock, menu bar, other applications and
// desktop icons. Windows and Linux get a documented best-effort subset
// (Windows: minimize every other window; Linux/GNOME: hide desktop icons).
//
// Every step is recorded so it can be reverted, and every step is best-effort:
// a failure is logged and the remaining steps still run. Restoring is
// idempotent, so it is safe to call on stop, cancel, discard and app quit.

import log from 'electron-log/main'
import { execFile } from 'node:child_process'
import { app } from 'electron'

interface MacState {
  dockHidden: boolean
  activationPolicy: 'regular' | 'accessory' | 'prohibited'
  hiddenApps: string[]
  desktopIconsDefault: string | null
  menuBarAutoHideDefault: string | null
}

let active = false
let macState: MacState | null = null
let windowsMinimized = false
let linuxDesktopIconsDefault: string | null = null
let linuxDesktopIconsSchema: string | null = null

/** Runs a helper binary, resolving with stdout (or '' on any failure). */
const run = (command: string, args: string[]): Promise<string> =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: 10000 }, (error, stdout) => {
      if (error) {
        log.warn(`[CleanDemo] ${command} ${args.join(' ')} failed: ${error.message}`)
        resolve('')
        return
      }
      resolve(String(stdout ?? '').trim())
    })
  })

/** Reads a `defaults` key, returning null when it is unset. */
async function readDefault(domain: string, key: string): Promise<string | null> {
  const value = await run('/usr/bin/defaults', ['read', domain, key])
  return value.length > 0 ? value : null
}

async function writeDefault(domain: string, key: string, value: string): Promise<void> {
  await run('/usr/bin/defaults', ['write', domain, key, value])
}

async function deleteDefault(domain: string, key: string): Promise<void> {
  await run('/usr/bin/defaults', ['delete', domain, key])
}

/** Escapes a name for use inside an AppleScript string literal. */
const applescriptString = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

async function applyMac(): Promise<void> {
  const state: MacState = {
    dockHidden: false,
    activationPolicy: 'regular',
    hiddenApps: [],
    desktopIconsDefault: null,
    menuBarAutoHideDefault: null,
  }

  try {
    state.activationPolicy = (app as any).getActivationPolicy?.() ?? 'regular'
  } catch (error) {
    log.warn('[CleanDemo] Could not read activation policy:', error)
  }

  // 1. Remember which apps are on screen, then hide all of them except us.
  try {
    const ownPid = process.pid
    const visible = await run('/usr/bin/osascript', [
      '-e',
      `tell application "System Events" to get the name of every process whose visible is true and background only is false and unix id is not ${ownPid}`,
    ])
    state.hiddenApps = visible
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
    if (state.hiddenApps.length > 0) {
      await run('/usr/bin/osascript', [
        '-e',
        `tell application "System Events" to set visible of every process whose name is in {${state.hiddenApps.map(applescriptString).join(', ')}} to false`,
      ])
    }
  } catch (error) {
    log.warn('[CleanDemo] Could not hide other applications:', error)
  }

  // 2. Dock icon (and our own menu bar) go away while we are an accessory app.
  try {
    state.dockHidden = app.dock?.isVisible() ?? false
    app.dock?.hide()
    app.setActivationPolicy('accessory')
  } catch (error) {
    log.warn('[CleanDemo] Could not hide the Dock:', error)
  }

  // 3. Desktop icons live in Finder; turn them off and bounce Finder so the
  //    change takes effect immediately.
  try {
    state.desktopIconsDefault = await readDefault('com.apple.finder', 'CreateDesktop')
    if (state.desktopIconsDefault !== '0' && state.desktopIconsDefault !== 'false') {
      await writeDefault('com.apple.finder', 'CreateDesktop', '-bool false')
      await run('/usr/bin/killall', ['Finder'])
    }
  } catch (error) {
    log.warn('[CleanDemo] Could not hide desktop icons:', error)
  }

  // 4. Menu bar auto-hide (there is no public API for this; the private
  //    _HIHideMenuBar default is the accepted approach). SystemUIServer is
  //    bounced so it applies right away.
  try {
    state.menuBarAutoHideDefault = await readDefault('NSGlobalDomain', '_HIHideMenuBar')
    await writeDefault('NSGlobalDomain', '_HIHideMenuBar', '-bool true')
    await run('/usr/bin/killall', ['SystemUIServer'])
  } catch (error) {
    log.warn('[CleanDemo] Could not hide the menu bar:', error)
  }

  macState = state
}

async function restoreMac(): Promise<void> {
  const state = macState
  if (!state) return
  macState = null

  // Menu bar first so the user can see what is happening.
  try {
    if (state.menuBarAutoHideDefault === null) await deleteDefault('NSGlobalDomain', '_HIHideMenuBar')
    else await writeDefault('NSGlobalDomain', '_HIHideMenuBar', state.menuBarAutoHideDefault)
    await run('/usr/bin/killall', ['SystemUIServer'])
  } catch (error) {
    log.warn('[CleanDemo] Could not restore the menu bar:', error)
  }

  try {
    if (state.desktopIconsDefault === null) await deleteDefault('com.apple.finder', 'CreateDesktop')
    else await writeDefault('com.apple.finder', 'CreateDesktop', state.desktopIconsDefault)
    await run('/usr/bin/killall', ['Finder'])
  } catch (error) {
    log.warn('[CleanDemo] Could not restore desktop icons:', error)
  }

  try {
    app.setActivationPolicy(state.activationPolicy)
    if (state.dockHidden) app.dock?.show()
  } catch (error) {
    log.warn('[CleanDemo] Could not restore the Dock:', error)
  }

  try {
    if (state.hiddenApps.length > 0) {
      await run('/usr/bin/osascript', [
        '-e',
        `tell application "System Events" to set visible of every process whose name is in {${state.hiddenApps.map(applescriptString).join(', ')}} to true`,
      ])
    }
  } catch (error) {
    log.warn('[CleanDemo] Could not restore other applications:', error)
  }
}

async function applyWindows(): Promise<void> {
  // Best effort: minimize every window on the desktop. The recorder window is
  // already minimized while recording, so nothing of ours disappears.
  await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '(New-Object -ComObject Shell.Application).MinimizeAll()',
  ])
  windowsMinimized = true
}

async function restoreWindows(): Promise<void> {
  if (!windowsMinimized) return
  windowsMinimized = false
  await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '(New-Object -ComObject Shell.Application).UndoMinimizeAll()',
  ])
}

/** GNOME 42+ ships desktop icons as the `ding` shell extension. */
const GNOME_DESKTOP_ICON_SCHEMAS = ['org.gnome.shell.extensions.ding', 'org.gnome.shell.extensions.desktop-icons']

async function applyLinux(): Promise<void> {
  const hasGsettings = (await run('/usr/bin/which', ['gsettings'])) !== ''
  if (!hasGsettings) {
    log.info('[CleanDemo] gsettings not available — nothing to hide on this desktop.')
    return
  }
  for (const schema of GNOME_DESKTOP_ICON_SCHEMAS) {
    const current = await run('/usr/bin/gsettings', ['get', schema, 'show-home'])
    if (!current) continue
    linuxDesktopIconsSchema = schema
    linuxDesktopIconsDefault = current
    await run('/usr/bin/gsettings', ['set', schema, 'show-home', 'false'])
    return
  }
  log.info('[CleanDemo] No supported desktop-icon setting found on this desktop.')
}

async function restoreLinux(): Promise<void> {
  if (!linuxDesktopIconsSchema || linuxDesktopIconsDefault === null) return
  const schema = linuxDesktopIconsSchema
  const value = linuxDesktopIconsDefault
  linuxDesktopIconsSchema = null
  linuxDesktopIconsDefault = null
  await run('/usr/bin/gsettings', ['set', schema, 'show-home', value])
}

/**
 * Hides desktop clutter for the duration of a recording. Safe to call when
 * already active (it is a no-op).
 */
export async function applyCleanDemoMode(): Promise<void> {
  if (active) return
  active = true
  log.info(`[CleanDemo] Applying clean demo mode on ${process.platform}.`)
  try {
    if (process.platform === 'darwin') await applyMac()
    else if (process.platform === 'win32') await applyWindows()
    else await applyLinux()
  } catch (error) {
    log.error('[CleanDemo] Failed to apply clean demo mode:', error)
  }
}

/**
 * Puts the desktop back the way it was. Idempotent — calling it when nothing
 * was hidden does nothing.
 */
export async function restoreCleanDemoMode(): Promise<void> {
  if (!active) return
  active = false
  log.info('[CleanDemo] Restoring desktop.')
  try {
    if (process.platform === 'darwin') await restoreMac()
    else if (process.platform === 'win32') await restoreWindows()
    else await restoreLinux()
  } catch (error) {
    log.error('[CleanDemo] Failed to restore clean demo mode:', error)
  }
}

export const isCleanDemoActive = () => active
