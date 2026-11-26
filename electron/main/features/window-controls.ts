import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { BrowserWindow, nativeTheme } from 'electron'
import log from 'electron-log/main'
import Store from 'electron-store'
import {
  detectLinuxDesktopEnvironment,
  parseLinuxThemeDarkHint,
  parseOsRelease,
  resolveWindowControlsConfig,
  type LinuxDesktopEnvironment,
  type WindowControlsAppearance,
  type WindowControlsConfig,
} from '../../../shared/window-controls'

export interface WindowControlsDeps {
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  homeDir?: string
  execCommand?: (cmd: string, args: string[]) => Promise<string | null>
  readFile?: (filePath: string) => Promise<string | null>
  getStoredAppearanceMode?: () => WindowControlsAppearance | null
  getNativeDark?: () => boolean
}

const COMMAND_TIMEOUT_MS = 1500

async function defaultExecCommand(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: COMMAND_TIMEOUT_MS }, (error, stdout) => {
      if (error) {
        resolve(null)
        return
      }
      resolve(stdout.trim())
    })
  })
}

async function defaultReadFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

function defaultGetStoredAppearanceMode(): WindowControlsAppearance | null {
  try {
    const store = new Store()
    const appearance = store.get('appearance') as { mode?: unknown } | undefined
    if (appearance?.mode === 'light' || appearance?.mode === 'dark') {
      return appearance.mode
    }
  } catch {
    // Store unavailable in restricted test environments
  }
  return null
}

function defaultGetNativeDark(): boolean {
  try {
    return Boolean(nativeTheme?.shouldUseDarkColors)
  } catch {
    return false
  }
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

/**
 * Reads an INI key inside `[group]`. Returns `null` if missing, or the raw string
 * (including `''` if `key=` is explicitly present with an empty value).
 */
export function parseIniValue(content: string, group: string, key: string): string | null {
  let inTargetGroup = false
  const targetHeader = `[${group}]`

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    if (line.startsWith('[') && line.endsWith(']')) {
      inTargetGroup = line === targetHeader
      continue
    }
    if (!inTargetGroup) continue
    const eqIdx = line.indexOf('=')
    if (eqIdx <= 0) continue
    const currentKey = line.slice(0, eqIdx).trim()
    if (currentKey === key) {
      return line.slice(eqIdx + 1).trim()
    }
  }
  return null
}

/**
 * Extracts a property value from XFCE's `xfwm4.xml` / `xsettings.xml`.
 */
export function parseXfceXmlProperty(content: string, propertyName: string): string | null {
  const escaped = propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const forward = new RegExp(`<property\\s+[^>]*name=["']${escaped}["'][^>]*value=["']([^"']*)["']`, 'i')
  const reverse = new RegExp(`<property\\s+[^>]*value=["']([^"']*)["'][^>]*name=["']${escaped}["']`, 'i')
  const match = content.match(forward) ?? content.match(reverse)
  return match ? match[1] : null
}

function configDir(env: Record<string, string | undefined>, homeDir: string): string {
  const xdgConfig = env.XDG_CONFIG_HOME?.trim()
  return xdgConfig || path.join(homeDir, '.config')
}

interface LinuxSettingsProbe {
  rawLayout: string | null
  kdeButtonsOnLeft: string | null
  kdeButtonsOnRight: string | null
  themeName: string | null
  iconTheme: string | null
  colorScheme: string | null
}

async function probeGnomeSettings(
  execCommand: (cmd: string, args: string[]) => Promise<string | null>,
): Promise<LinuxSettingsProbe> {
  const [rawButtonLayout, dconfButtonLayout, colorScheme, gtkTheme, iconTheme] = await Promise.all([
    execCommand('gsettings', ['get', 'org.gnome.desktop.wm.preferences', 'button-layout']),
    execCommand('dconf', ['read', '/org/gnome/desktop/wm/preferences/button-layout']),
    execCommand('gsettings', ['get', 'org.gnome.desktop.interface', 'color-scheme']),
    execCommand('gsettings', ['get', 'org.gnome.desktop.interface', 'gtk-theme']),
    execCommand('gsettings', ['get', 'org.gnome.desktop.interface', 'icon-theme']),
  ])

  let rawLayout = rawButtonLayout ? stripQuotes(rawButtonLayout) : null
  // Uncustomized GNOME schema default is 'appmenu:close' (dconf read is empty).
  // Keep full window controls (minimize, maximize, close) unless the user explicitly customized it.
  if (rawLayout === 'appmenu:close' && (!dconfButtonLayout || dconfButtonLayout.trim() === '')) {
    rawLayout = null
  }

  return {
    rawLayout,
    kdeButtonsOnLeft: null,
    kdeButtonsOnRight: null,
    themeName: gtkTheme ? stripQuotes(gtkTheme) : null,
    iconTheme: iconTheme ? stripQuotes(iconTheme) : null,
    colorScheme: colorScheme ? stripQuotes(colorScheme) : null,
  }
}

async function probeKdeSettings(
  env: Record<string, string | undefined>,
  homeDir: string,
  execCommand: (cmd: string, args: string[]) => Promise<string | null>,
  readFile: (filePath: string) => Promise<string | null>,
): Promise<LinuxSettingsProbe> {
  const cfgRoot = configDir(env, homeDir)
  const [kwinrc, kdeglobals] = await Promise.all([
    readFile(path.join(cfgRoot, 'kwinrc')),
    readFile(path.join(cfgRoot, 'kdeglobals')),
  ])

  let kdeButtonsOnLeft = kwinrc ? parseIniValue(kwinrc, 'org.kde.kdecoration2', 'ButtonsOnLeft') : null
  let kdeButtonsOnRight = kwinrc ? parseIniValue(kwinrc, 'org.kde.kdecoration2', 'ButtonsOnRight') : null

  if (kdeButtonsOnLeft === null && kdeButtonsOnRight === null) {
    // Fallback to kreadconfig6 / kreadconfig5 when kwinrc isn't directly available
    const readKdeKey = async (key: string): Promise<string | null> => {
      const v6 = await execCommand('kreadconfig6', [
        '--file',
        'kwinrc',
        '--group',
        'org.kde.kdecoration2',
        '--key',
        key,
      ])
      if (v6 !== null) return v6
      return execCommand('kreadconfig5', ['--file', 'kwinrc', '--group', 'org.kde.kdecoration2', '--key', key])
    }
    const [leftCmd, rightCmd] = await Promise.all([readKdeKey('ButtonsOnLeft'), readKdeKey('ButtonsOnRight')])
    kdeButtonsOnLeft = leftCmd
    kdeButtonsOnRight = rightCmd === '' ? null : rightCmd
  }

  let themeName = kdeglobals
    ? (parseIniValue(kdeglobals, 'General', 'ColorScheme') ?? parseIniValue(kdeglobals, 'KDE', 'LookAndFeelPackage'))
    : null
  let iconTheme = kdeglobals ? parseIniValue(kdeglobals, 'Icons', 'Theme') : null

  if (!themeName) {
    themeName =
      (await execCommand('kreadconfig6', ['--file', 'kdeglobals', '--group', 'General', '--key', 'ColorScheme'])) ??
      (await execCommand('kreadconfig5', ['--file', 'kdeglobals', '--group', 'General', '--key', 'ColorScheme']))
  }
  if (!iconTheme) {
    iconTheme =
      (await execCommand('kreadconfig6', ['--file', 'kdeglobals', '--group', 'Icons', '--key', 'Theme'])) ??
      (await execCommand('kreadconfig5', ['--file', 'kdeglobals', '--group', 'Icons', '--key', 'Theme']))
  }

  return {
    rawLayout: null,
    kdeButtonsOnLeft,
    kdeButtonsOnRight,
    themeName,
    iconTheme,
    colorScheme: null,
  }
}

async function probeXfceSettings(
  env: Record<string, string | undefined>,
  homeDir: string,
  execCommand: (cmd: string, args: string[]) => Promise<string | null>,
  readFile: (filePath: string) => Promise<string | null>,
): Promise<LinuxSettingsProbe> {
  const [layoutCmd, xfwmThemeCmd, gtkThemeCmd, iconThemeCmd] = await Promise.all([
    execCommand('xfconf-query', ['-c', 'xfwm4', '-p', '/general/button_layout']),
    execCommand('xfconf-query', ['-c', 'xfwm4', '-p', '/general/theme']),
    execCommand('xfconf-query', ['-c', 'xsettings', '-p', '/Net/ThemeName']),
    execCommand('xfconf-query', ['-c', 'xsettings', '-p', '/Net/IconThemeName']),
  ])

  let rawLayout = layoutCmd ? stripQuotes(layoutCmd) || null : null
  const gtkThemeCleaned = gtkThemeCmd ? stripQuotes(gtkThemeCmd) : ''
  const xfwmThemeCleaned = xfwmThemeCmd ? stripQuotes(xfwmThemeCmd) : ''
  let themeName: string | null = gtkThemeCleaned || xfwmThemeCleaned || null
  let iconTheme = iconThemeCmd ? stripQuotes(iconThemeCmd) || null : null

  if (!rawLayout || !themeName) {
    const cfgRoot = configDir(env, homeDir)
    const [xfwmXml, xsettingsXml] = await Promise.all([
      readFile(path.join(cfgRoot, 'xfce4', 'xfconf', 'xfce-perchannel-xml', 'xfwm4.xml')),
      readFile(path.join(cfgRoot, 'xfce4', 'xfconf', 'xfce-perchannel-xml', 'xsettings.xml')),
    ])
    if (!rawLayout && xfwmXml) {
      rawLayout = parseXfceXmlProperty(xfwmXml, 'button_layout')
    }
    if (!themeName) {
      themeName =
        (xsettingsXml && parseXfceXmlProperty(xsettingsXml, 'ThemeName')) ??
        (xfwmXml && parseXfceXmlProperty(xfwmXml, 'theme')) ??
        null
    }
    if (!iconTheme && xsettingsXml) {
      iconTheme = parseXfceXmlProperty(xsettingsXml, 'IconThemeName')
    }
  }

  return {
    rawLayout,
    kdeButtonsOnLeft: null,
    kdeButtonsOnRight: null,
    themeName,
    iconTheme,
    colorScheme: null,
  }
}

async function probeCinnamonSettings(
  execCommand: (cmd: string, args: string[]) => Promise<string | null>,
): Promise<LinuxSettingsProbe> {
  const [wmLayout, muffinLayout, gtkTheme, iconTheme] = await Promise.all([
    execCommand('gsettings', ['get', 'org.cinnamon.desktop.wm.preferences', 'button-layout']),
    execCommand('gsettings', ['get', 'org.cinnamon.muffin', 'button-layout']),
    execCommand('gsettings', ['get', 'org.cinnamon.desktop.interface', 'gtk-theme']),
    execCommand('gsettings', ['get', 'org.cinnamon.desktop.interface', 'icon-theme']),
  ])
  const wmCleaned = wmLayout ? stripQuotes(wmLayout) : ''
  const muffinCleaned = muffinLayout ? stripQuotes(muffinLayout) : ''
  const chosen = wmCleaned || muffinCleaned || null
  return {
    rawLayout: chosen,
    kdeButtonsOnLeft: null,
    kdeButtonsOnRight: null,
    themeName: gtkTheme ? stripQuotes(gtkTheme) || null : null,
    iconTheme: iconTheme ? stripQuotes(iconTheme) || null : null,
    colorScheme: null,
  }
}

async function probeMateSettings(
  execCommand: (cmd: string, args: string[]) => Promise<string | null>,
): Promise<LinuxSettingsProbe> {
  const [wmLayout, gtkTheme, iconTheme] = await Promise.all([
    execCommand('gsettings', ['get', 'org.mate.Marco.general', 'button-layout']),
    execCommand('gsettings', ['get', 'org.mate.interface', 'gtk-theme']),
    execCommand('gsettings', ['get', 'org.mate.interface', 'icon-theme']),
  ])
  return {
    rawLayout: wmLayout ? stripQuotes(wmLayout) : null,
    kdeButtonsOnLeft: null,
    kdeButtonsOnRight: null,
    themeName: gtkTheme ? stripQuotes(gtkTheme) : null,
    iconTheme: iconTheme ? stripQuotes(iconTheme) : null,
    colorScheme: null,
  }
}

async function probeLinuxSettings(
  de: LinuxDesktopEnvironment,
  env: Record<string, string | undefined>,
  homeDir: string,
  execCommand: (cmd: string, args: string[]) => Promise<string | null>,
  readFile: (filePath: string) => Promise<string | null>,
): Promise<LinuxSettingsProbe> {
  switch (de) {
    case 'gnome':
      return probeGnomeSettings(execCommand)
    case 'kde':
      return probeKdeSettings(env, homeDir, execCommand, readFile)
    case 'xfce':
      return probeXfceSettings(env, homeDir, execCommand, readFile)
    case 'cinnamon':
      return probeCinnamonSettings(execCommand)
    case 'mate':
      return probeMateSettings(execCommand)
    default: {
      // Custom/unrecognized WM: honor explicit GTK dconf override if user configured one.
      const dconfLayout = await execCommand('dconf', ['read', '/org/gnome/desktop/wm/preferences/button-layout'])
      const colorScheme = await execCommand('gsettings', ['get', 'org.gnome.desktop.interface', 'color-scheme'])
      return {
        rawLayout: dconfLayout ? stripQuotes(dconfLayout) : null,
        kdeButtonsOnLeft: null,
        kdeButtonsOnRight: null,
        themeName: null,
        iconTheme: null,
        colorScheme: colorScheme ? stripQuotes(colorScheme) : null,
      }
    }
  }
}

/**
 * Resolves the live window controls configuration for the current host OS,
 * Linux distribution, desktop environment, user settings, and active theme.
 */
export async function getWindowControlsConfig(
  appearanceOverride?: WindowControlsAppearance,
  deps: WindowControlsDeps = {},
): Promise<WindowControlsConfig> {
  const platform = deps.platform ?? process.platform
  const env = deps.env ?? process.env
  const homeDir = deps.homeDir ?? os.homedir()
  const execCommand = deps.execCommand ?? defaultExecCommand
  const readFile = deps.readFile ?? defaultReadFile
  const getStoredAppearanceMode = deps.getStoredAppearanceMode ?? defaultGetStoredAppearanceMode
  const getNativeDark = deps.getNativeDark ?? defaultGetNativeDark

  if (platform !== 'linux') {
    const appearance = appearanceOverride ?? getStoredAppearanceMode() ?? (getNativeDark() ? 'dark' : 'light')
    return resolveWindowControlsConfig({ platform, appearance })
  }

  const de = detectLinuxDesktopEnvironment(env)
  const [osReleaseContent, probe] = await Promise.all([
    readFile('/etc/os-release'),
    probeLinuxSettings(de, env, homeDir, execCommand, readFile),
  ])

  const distroInfo = osReleaseContent ? parseOsRelease(osReleaseContent) : { id: null, idLike: [] }
  const linuxThemeHint = parseLinuxThemeDarkHint(probe.themeName, probe.colorScheme)
  const appearance: WindowControlsAppearance =
    appearanceOverride ?? getStoredAppearanceMode() ?? (getNativeDark() ? 'dark' : (linuxThemeHint ?? 'light'))

  const config = resolveWindowControlsConfig({
    platform,
    desktopEnvironment: de,
    distro: distroInfo.id,
    distroLike: distroInfo.idLike,
    rawLayout: probe.rawLayout,
    kdeButtonsOnLeft: probe.kdeButtonsOnLeft,
    kdeButtonsOnRight: probe.kdeButtonsOnRight,
    appearance,
    themeName: probe.themeName,
    iconTheme: probe.iconTheme,
  })

  log.debug('[WindowControls] Resolved config:', config)
  return config
}

/**
 * Syncs Electron's nativeTheme and pushes refreshed window control settings to all open windows.
 */
export async function syncWindowControlsTheme(
  mode: WindowControlsAppearance,
  targetWindow?: BrowserWindow | null,
): Promise<WindowControlsConfig> {
  try {
    if (nativeTheme) {
      nativeTheme.themeSource = mode
    }
  } catch (err) {
    log.warn('[WindowControls] Could not update nativeTheme.themeSource:', err)
  }

  const config = await getWindowControlsConfig(mode)
  const windows = targetWindow ? [targetWindow] : BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (win && !win.isDestroyed() && win.webContents) {
      win.webContents.send('window:controls-changed', config)
    }
  }
  return config
}
