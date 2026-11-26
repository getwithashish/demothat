import { describe, expect, it } from 'vitest'
import {
  detectLinuxDesktopEnvironment,
  parseGtkButtonLayout,
  parseKdeButtonLayout,
  parseLinuxThemeDarkHint,
  parseOsRelease,
  parseXfceButtonLayout,
  resolveWindowControlsConfig,
} from './window-controls'

describe('detectLinuxDesktopEnvironment', () => {
  it('detects GNOME across common XDG variants', () => {
    expect(detectLinuxDesktopEnvironment({ XDG_CURRENT_DESKTOP: 'GNOME' })).toBe('gnome')
    expect(detectLinuxDesktopEnvironment({ XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' })).toBe('gnome')
    expect(detectLinuxDesktopEnvironment({ XDG_CURRENT_DESKTOP: 'pop:GNOME' })).toBe('gnome')
    expect(detectLinuxDesktopEnvironment({ XDG_CURRENT_DESKTOP: 'Unity' })).toBe('gnome')
  })

  it('detects KDE Plasma, XFCE, Cinnamon, and MATE', () => {
    expect(detectLinuxDesktopEnvironment({ XDG_CURRENT_DESKTOP: 'KDE' })).toBe('kde')
    expect(detectLinuxDesktopEnvironment({ XDG_SESSION_DESKTOP: 'plasma' })).toBe('kde')
    expect(detectLinuxDesktopEnvironment({ XDG_CURRENT_DESKTOP: 'XFCE' })).toBe('xfce')
    expect(detectLinuxDesktopEnvironment({ DESKTOP_SESSION: 'xubuntu' })).toBe('xfce')
    expect(detectLinuxDesktopEnvironment({ XDG_CURRENT_DESKTOP: 'X-Cinnamon' })).toBe('cinnamon')
    expect(detectLinuxDesktopEnvironment({ DESKTOP_SESSION: 'cinnamon' })).toBe('cinnamon')
    expect(detectLinuxDesktopEnvironment({ XDG_CURRENT_DESKTOP: 'MATE' })).toBe('mate')
  })

  it('returns unknown for unrecognized or custom setups', () => {
    expect(detectLinuxDesktopEnvironment({ XDG_CURRENT_DESKTOP: 'sway' })).toBe('unknown')
    expect(detectLinuxDesktopEnvironment({ XDG_CURRENT_DESKTOP: 'Hyprland' })).toBe('unknown')
    expect(detectLinuxDesktopEnvironment({ XDG_CURRENT_DESKTOP: 'i3' })).toBe('unknown')
    expect(detectLinuxDesktopEnvironment({})).toBe('unknown')
  })
})

describe('parseOsRelease', () => {
  it('parses ID and ID_LIKE from /etc/os-release', () => {
    const parsed = parseOsRelease(`
NAME="Linux Mint"
ID=linuxmint
ID_LIKE="ubuntu debian"
PRETTY_NAME="Linux Mint 22"
`)
    expect(parsed).toEqual({ id: 'linuxmint', idLike: ['ubuntu', 'debian'] })
  })

  it('handles elementary OS and missing fields', () => {
    expect(parseOsRelease('ID=elementary\n')).toEqual({ id: 'elementary', idLike: [] })
    expect(parseOsRelease('')).toEqual({ id: null, idLike: [] })
  })
})

describe('layout parsers', () => {
  it('parses GTK colon-separated layouts for GNOME, Cinnamon, and MATE', () => {
    expect(parseGtkButtonLayout("':minimize,maximize,close'")).toEqual({
      left: [],
      right: ['minimize', 'maximize', 'close'],
    })
    expect(parseGtkButtonLayout('close,minimize,maximize:')).toEqual({
      left: ['close', 'minimize', 'maximize'],
      right: [],
    })
    expect(parseGtkButtonLayout('appmenu:maximize,minimize,close')).toEqual({
      left: [],
      right: ['maximize', 'minimize', 'close'],
    })
    expect(parseGtkButtonLayout('close:minimize,maximize')).toEqual({
      left: ['close'],
      right: ['minimize', 'maximize'],
    })
    expect(parseGtkButtonLayout('menu:spacer')).toBeNull()
  })

  it('parses KDE KDecoration2 button codes including omitted Breeze right default', () => {
    expect(parseKdeButtonLayout('MFS', null)).toEqual({
      left: [],
      right: ['minimize', 'maximize', 'close'],
    })
    expect(parseKdeButtonLayout('XIA', '')).toEqual({
      left: ['close', 'minimize', 'maximize'],
      right: [],
    })
    expect(parseKdeButtonLayout('X', 'IA')).toEqual({
      left: ['close'],
      right: ['minimize', 'maximize'],
    })
    expect(parseKdeButtonLayout('M', 'AX')).toEqual({
      left: [],
      right: ['maximize', 'close'],
    })
    expect(parseKdeButtonLayout(null, null)).toBeNull()
  })

  it('parses XFCE Xfwm4 pipe-separated button_layout codes', () => {
    expect(parseXfceButtonLayout('O|SHMC')).toEqual({
      left: [],
      right: ['minimize', 'maximize', 'close'],
    })
    expect(parseXfceButtonLayout('CMH|O')).toEqual({
      left: ['close', 'maximize', 'minimize'],
      right: [],
    })
    expect(parseXfceButtonLayout('C|HM')).toEqual({
      left: ['close'],
      right: ['minimize', 'maximize'],
    })
    expect(parseXfceButtonLayout('O|S')).toBeNull()
  })
})

describe('parseLinuxThemeDarkHint', () => {
  it('infers dark vs light appearance from color-scheme and GTK/KDE theme names', () => {
    expect(parseLinuxThemeDarkHint('Adwaita', 'prefer-dark')).toBe('dark')
    expect(parseLinuxThemeDarkHint('Mint-Y-Dark', null)).toBe('dark')
    expect(parseLinuxThemeDarkHint('BreezeDark', null)).toBe('dark')
    expect(parseLinuxThemeDarkHint('Adwaita', 'prefer-light')).toBe('light')
    expect(parseLinuxThemeDarkHint('Mint-Y', null)).toBe('light')
    expect(parseLinuxThemeDarkHint(null, null)).toBeNull()
  })
})

describe('resolveWindowControlsConfig', () => {
  it('resolves Windows controls on the right in minimize, maximize, close order', () => {
    const cfg = resolveWindowControlsConfig({ platform: 'win32', appearance: 'dark' })
    expect(cfg.variant).toBe('windows')
    expect(cfg.placement).toBe('right')
    expect(cfg.buttons).toEqual(['minimize', 'maximize', 'close'])
    expect(cfg.leftButtons).toEqual([])
    expect(cfg.rightButtons).toEqual(['minimize', 'maximize', 'close'])
    expect(cfg.appearance).toBe('dark')
  })

  it('resolves macOS traffic lights on the left in close, minimize, maximize order', () => {
    const cfg = resolveWindowControlsConfig({ platform: 'darwin', appearance: 'light' })
    expect(cfg.variant).toBe('macos')
    expect(cfg.placement).toBe('left')
    expect(cfg.buttons).toEqual(['close', 'minimize', 'maximize'])
    expect(cfg.leftButtons).toEqual(['close', 'minimize', 'maximize'])
    expect(cfg.rightButtons).toEqual([])
    expect(cfg.appearance).toBe('light')
  })

  it.each([
    {
      de: 'gnome' as const,
      rawLayout: 'close,minimize,maximize:',
      expectedOrder: ['close', 'minimize', 'maximize'],
      placement: 'left' as const,
    },
    {
      de: 'gnome' as const,
      rawLayout: ':minimize,maximize,close',
      expectedOrder: ['minimize', 'maximize', 'close'],
      placement: 'right' as const,
    },
    {
      de: 'cinnamon' as const,
      rawLayout: 'close,maximize,minimize:',
      expectedOrder: ['close', 'maximize', 'minimize'],
      placement: 'left' as const,
    },
    {
      de: 'mate' as const,
      rawLayout: 'menu:minimize,maximize,close',
      expectedOrder: ['minimize', 'maximize', 'close'],
      placement: 'right' as const,
    },
    {
      de: 'xfce' as const,
      rawLayout: 'CMH|O',
      expectedOrder: ['close', 'maximize', 'minimize'],
      placement: 'left' as const,
    },
    {
      de: 'xfce' as const,
      rawLayout: 'O|SHMC',
      expectedOrder: ['minimize', 'maximize', 'close'],
      placement: 'right' as const,
    },
  ])('resolves Linux $de user layout ($rawLayout)', ({ de, rawLayout, expectedOrder, placement }) => {
    const cfg = resolveWindowControlsConfig({
      platform: 'linux',
      desktopEnvironment: de,
      rawLayout,
      appearance: 'dark',
    })
    expect(cfg.variant).toBe(de)
    expect(cfg.placement).toBe(placement)
    expect(cfg.buttons).toEqual(expectedOrder)
  })

  it('resolves KDE Plasma custom left, split, and Breeze default layouts', () => {
    const leftCfg = resolveWindowControlsConfig({
      platform: 'linux',
      desktopEnvironment: 'kde',
      kdeButtonsOnLeft: 'XIA',
      kdeButtonsOnRight: '',
    })
    expect(leftCfg.variant).toBe('kde')
    expect(leftCfg.placement).toBe('left')
    expect(leftCfg.leftButtons).toEqual(['close', 'minimize', 'maximize'])
    expect(leftCfg.rightButtons).toEqual([])

    const splitCfg = resolveWindowControlsConfig({
      platform: 'linux',
      desktopEnvironment: 'kde',
      kdeButtonsOnLeft: 'X',
      kdeButtonsOnRight: 'IA',
    })
    expect(splitCfg.leftButtons).toEqual(['close'])
    expect(splitCfg.rightButtons).toEqual(['minimize', 'maximize'])

    const defaultCfg = resolveWindowControlsConfig({
      platform: 'linux',
      desktopEnvironment: 'kde',
      kdeButtonsOnLeft: 'MFS',
      kdeButtonsOnRight: null,
    })
    expect(defaultCfg.placement).toBe('right')
    expect(defaultCfg.buttons).toEqual(['minimize', 'maximize', 'close'])
  })

  it('uses sensible fallback for unrecognized/custom Linux setups and respects distro defaults', () => {
    const customFallback = resolveWindowControlsConfig({
      platform: 'linux',
      desktopEnvironment: 'unknown',
    })
    expect(customFallback.variant).toBe('generic')
    expect(customFallback.placement).toBe('right')
    expect(customFallback.buttons).toEqual(['minimize', 'maximize', 'close'])

    const elementary = resolveWindowControlsConfig({
      platform: 'linux',
      desktopEnvironment: 'unknown',
      distro: 'elementary',
    })
    expect(elementary.placement).toBe('left')
    expect(elementary.buttons).toEqual(['close', 'minimize', 'maximize'])
  })
})
