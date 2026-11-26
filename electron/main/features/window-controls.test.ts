import { describe, expect, it, vi } from 'vitest'
import {
  getWindowControlsConfig,
  parseIniValue,
  parseXfceXmlProperty,
  syncWindowControlsTheme,
} from './window-controls'
import { BrowserWindow, nativeTheme } from 'electron'

describe('INI and XML config helpers', () => {
  it('parses INI groups accurately including explicit empty values', () => {
    const ini = `
[General]
ColorScheme=BreezeDark

[org.kde.kdecoration2]
ButtonsOnLeft=XIA
ButtonsOnRight=
`
    expect(parseIniValue(ini, 'General', 'ColorScheme')).toBe('BreezeDark')
    expect(parseIniValue(ini, 'org.kde.kdecoration2', 'ButtonsOnLeft')).toBe('XIA')
    expect(parseIniValue(ini, 'org.kde.kdecoration2', 'ButtonsOnRight')).toBe('')
    expect(parseIniValue(ini, 'org.kde.kdecoration2', 'MissingKey')).toBeNull()
  })

  it('parses XFCE XML properties regardless of attribute order', () => {
    const xml = `
<channel name="xfwm4" version="1.0">
  <property name="general" type="empty">
    <property name="button_layout" type="string" value="CMH|O"/>
    <property value="Greybird-dark" type="string" name="theme"/>
  </property>
</channel>
`
    expect(parseXfceXmlProperty(xml, 'button_layout')).toBe('CMH|O')
    expect(parseXfceXmlProperty(xml, 'theme')).toBe('Greybird-dark')
  })
})

describe('getWindowControlsConfig', () => {
  it('returns Windows and macOS configurations directly', async () => {
    const winCfg = await getWindowControlsConfig(undefined, {
      platform: 'win32',
      getStoredAppearanceMode: () => 'dark',
    })
    expect(winCfg).toMatchObject({
      platform: 'win32',
      variant: 'windows',
      placement: 'right',
      buttons: ['minimize', 'maximize', 'close'],
      appearance: 'dark',
    })

    const macCfg = await getWindowControlsConfig(undefined, {
      platform: 'darwin',
      getStoredAppearanceMode: () => null,
      getNativeDark: () => false,
    })
    expect(macCfg).toMatchObject({
      platform: 'darwin',
      variant: 'macos',
      placement: 'left',
      buttons: ['close', 'minimize', 'maximize'],
      appearance: 'light',
    })
  })

  it('reads GNOME gsettings for button order, placement, and dark theme', async () => {
    const execCommand = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'gsettings' && args[2] === 'button-layout') return "'close,minimize,maximize:'"
      if (cmd === 'dconf') return "'close,minimize,maximize:'"
      if (cmd === 'gsettings' && args[2] === 'color-scheme') return "'prefer-dark'"
      if (cmd === 'gsettings' && args[2] === 'gtk-theme') return "'Yaru-dark'"
      if (cmd === 'gsettings' && args[2] === 'icon-theme') return "'Yaru'"
      return null
    })

    const cfg = await getWindowControlsConfig(undefined, {
      platform: 'linux',
      env: { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' },
      execCommand,
      readFile: async (p) => (p === '/etc/os-release' ? 'ID=ubuntu\n' : null),
      getStoredAppearanceMode: () => null,
      getNativeDark: () => false,
    })

    expect(cfg).toMatchObject({
      variant: 'gnome',
      distro: 'ubuntu',
      placement: 'left',
      buttons: ['close', 'minimize', 'maximize'],
      appearance: 'dark',
      themeName: 'Yaru-dark',
      iconTheme: 'Yaru',
    })
  })

  it('keeps full controls on uncustomized stock GNOME factory appmenu:close', async () => {
    const execCommand = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'gsettings' && args[2] === 'button-layout') return "'appmenu:close'"
      if (cmd === 'dconf') return ''
      return null
    })

    const cfg = await getWindowControlsConfig('light', {
      platform: 'linux',
      env: { XDG_CURRENT_DESKTOP: 'GNOME' },
      execCommand,
      readFile: async () => 'ID=fedora\n',
    })

    expect(cfg.variant).toBe('gnome')
    expect(cfg.placement).toBe('right')
    expect(cfg.buttons).toEqual(['minimize', 'maximize', 'close'])
  })

  it('reads KDE Plasma settings from kwinrc and kdeglobals', async () => {
    const cfg = await getWindowControlsConfig(undefined, {
      platform: 'linux',
      env: { XDG_CURRENT_DESKTOP: 'KDE', XDG_CONFIG_HOME: '/mock/cfg' },
      homeDir: '/mock/home',
      execCommand: async () => null,
      readFile: async (filePath) => {
        if (filePath === '/etc/os-release') return 'ID=ubuntu\n'
        if (filePath === '/mock/cfg/kwinrc') return '[org.kde.kdecoration2]\nButtonsOnLeft=XIA\nButtonsOnRight=\n'
        if (filePath === '/mock/cfg/kdeglobals')
          return '[General]\nColorScheme=BreezeDark\n[Icons]\nTheme=breeze-dark\n'
        return null
      },
      getStoredAppearanceMode: () => null,
      getNativeDark: () => false,
    })

    expect(cfg).toMatchObject({
      variant: 'kde',
      placement: 'left',
      buttons: ['close', 'minimize', 'maximize'],
      appearance: 'dark',
      themeName: 'BreezeDark',
      iconTheme: 'breeze-dark',
    })
  })

  it('reads XFCE settings from xfconf-query and falls back to xfwm4.xml when unavailable', async () => {
    const cfgFromXml = await getWindowControlsConfig(undefined, {
      platform: 'linux',
      env: { XDG_CURRENT_DESKTOP: 'XFCE', XDG_CONFIG_HOME: '/mock/cfg' },
      execCommand: async () => null,
      readFile: async (filePath) => {
        if (filePath === '/etc/os-release') return 'ID=debian\n'
        if (filePath === '/mock/cfg/xfce4/xfconf/xfce-perchannel-xml/xfwm4.xml') {
          return '<channel name="xfwm4"><property name="button_layout" value="CMH|O"/><property name="theme" value="Greybird-dark"/></channel>'
        }
        return null
      },
      getStoredAppearanceMode: () => null,
      getNativeDark: () => false,
    })

    expect(cfgFromXml).toMatchObject({
      variant: 'xfce',
      placement: 'left',
      buttons: ['close', 'maximize', 'minimize'],
      appearance: 'dark',
    })
  })

  it('reads Cinnamon and MATE settings via gsettings', async () => {
    const cinnamonCfg = await getWindowControlsConfig('light', {
      platform: 'linux',
      env: { XDG_CURRENT_DESKTOP: 'X-Cinnamon' },
      execCommand: async (_cmd, args) => {
        if (args[1] === 'org.cinnamon.desktop.wm.preferences') return "'close,minimize,maximize:'"
        if (args[2] === 'gtk-theme') return "'Mint-Y'"
        return null
      },
      readFile: async () => 'ID=linuxmint\nID_LIKE=ubuntu\n',
    })
    expect(cinnamonCfg).toMatchObject({
      variant: 'cinnamon',
      distro: 'linuxmint',
      placement: 'left',
      buttons: ['close', 'minimize', 'maximize'],
      appearance: 'light',
    })

    const cinnamonMuffinFallbackCfg = await getWindowControlsConfig('light', {
      platform: 'linux',
      env: { XDG_CURRENT_DESKTOP: 'X-Cinnamon' },
      execCommand: async (_cmd, args) => {
        if (args[1] === 'org.cinnamon.desktop.wm.preferences') return "''"
        if (args[1] === 'org.cinnamon.muffin') return "'close:minimize,maximize'"
        return null
      },
      readFile: async () => 'ID=linuxmint\n',
    })
    expect(cinnamonMuffinFallbackCfg).toMatchObject({
      variant: 'cinnamon',
      placement: 'left',
      leftButtons: ['close'],
      rightButtons: ['minimize', 'maximize'],
    })

    const mateCfg = await getWindowControlsConfig('dark', {
      platform: 'linux',
      env: { XDG_CURRENT_DESKTOP: 'MATE' },
      execCommand: async (_cmd, args) => {
        if (args[1] === 'org.mate.Marco.general') return "'menu:maximize,minimize,close'"
        return null
      },
      readFile: async () => 'ID=ubuntu\n',
    })
    expect(mateCfg).toMatchObject({
      variant: 'mate',
      placement: 'right',
      buttons: ['maximize', 'minimize', 'close'],
      appearance: 'dark',
    })
  })

  it('falls back cleanly when Linux DE is unrecognized or tools fail', async () => {
    const cfg = await getWindowControlsConfig(undefined, {
      platform: 'linux',
      env: { XDG_CURRENT_DESKTOP: 'sway' },
      execCommand: async () => null,
      readFile: async () => null,
      getStoredAppearanceMode: () => null,
      getNativeDark: () => false,
    })

    expect(cfg).toMatchObject({
      variant: 'generic',
      desktopEnvironment: 'unknown',
      placement: 'right',
      buttons: ['minimize', 'maximize', 'close'],
      appearance: 'light',
    })
  })
})

describe('syncWindowControlsTheme', () => {
  it('updates nativeTheme.themeSource and notifies open windows', async () => {
    const send = vi.fn()
    const mockWin = {
      isDestroyed: () => false,
      webContents: { send },
    } as unknown as Electron.BrowserWindow

    vi.spyOn(BrowserWindow, 'getAllWindows').mockReturnValue([mockWin])

    const updated = await syncWindowControlsTheme('dark')
    expect(nativeTheme.themeSource).toBe('dark')
    expect(updated.appearance).toBe('dark')
    expect(send).toHaveBeenCalledWith('window:controls-changed', expect.objectContaining({ appearance: 'dark' }))
  })
})
