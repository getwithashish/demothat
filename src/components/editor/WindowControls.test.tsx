// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WindowControls } from './WindowControls'
import { useEditorStore } from '../../store/editorStore'
import { resolveWindowControlsConfig, type WindowControlsConfig } from '../../../shared/window-controls'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

async function renderAsync(node: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(node)
    await Promise.resolve()
  })
  return container
}

describe('WindowControls', () => {
  let stateChangeListener: ((payload: { isMaximized: boolean }) => void) | null = null
  const minimizeWindow = vi.fn()
  const maximizeWindow = vi.fn()
  const closeWindow = vi.fn()
  const windowIsMaximized = vi.fn().mockResolvedValue(false)
  const setSetting = vi.fn()
  const setWindowTheme = vi.fn()
  const getWindowControlsConfig = vi.fn()

  beforeEach(() => {
    stateChangeListener = null
    windowIsMaximized.mockResolvedValue(false)
    Object.defineProperty(window, 'electronAPI', {
      value: {
        minimizeWindow,
        maximizeWindow,
        closeWindow,
        windowIsMaximized,
        onWindowStateChange: vi.fn((cb: (payload: { isMaximized: boolean }) => void) => {
          stateChangeListener = cb
          return () => {
            stateChangeListener = null
          }
        }),
        getSetting: vi.fn().mockResolvedValue(undefined),
        setSetting,
        setWindowTheme,
        getWindowControlsConfig,
      },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    container?.remove()
    container = null
    root = null
    vi.clearAllMocks()
    useEditorStore.setState({ mode: 'light', windowControls: null, platform: null })
  })

  it.each([
    {
      name: 'Windows',
      config: resolveWindowControlsConfig({ platform: 'win32', appearance: 'light' }),
      expectedLabels: ['Minimize', 'Maximize', 'Close'],
      expectedVariant: 'windows',
      expectedPlacement: 'right',
    },
    {
      name: 'macOS',
      config: resolveWindowControlsConfig({ platform: 'darwin', appearance: 'dark' }),
      expectedLabels: ['Close', 'Minimize', 'Maximize'],
      expectedVariant: 'macos',
      expectedPlacement: 'left',
    },
    {
      name: 'GNOME (left)',
      config: resolveWindowControlsConfig({
        platform: 'linux',
        desktopEnvironment: 'gnome',
        rawLayout: 'close,minimize,maximize:',
        appearance: 'dark',
      }),
      expectedLabels: ['Close', 'Minimize', 'Maximize'],
      expectedVariant: 'gnome',
      expectedPlacement: 'left',
    },
    {
      name: 'KDE Plasma (right Breeze)',
      config: resolveWindowControlsConfig({
        platform: 'linux',
        desktopEnvironment: 'kde',
        kdeButtonsOnLeft: 'MFS',
        kdeButtonsOnRight: null,
        appearance: 'dark',
      }),
      expectedLabels: ['Minimize', 'Maximize', 'Close'],
      expectedVariant: 'kde',
      expectedPlacement: 'right',
    },
    {
      name: 'XFCE (left custom order)',
      config: resolveWindowControlsConfig({
        platform: 'linux',
        desktopEnvironment: 'xfce',
        rawLayout: 'CMH|O',
        appearance: 'light',
      }),
      expectedLabels: ['Close', 'Maximize', 'Minimize'],
      expectedVariant: 'xfce',
      expectedPlacement: 'left',
    },
    {
      name: 'Cinnamon (right)',
      config: resolveWindowControlsConfig({
        platform: 'linux',
        desktopEnvironment: 'cinnamon',
        rawLayout: ':minimize,maximize,close',
        appearance: 'light',
      }),
      expectedLabels: ['Minimize', 'Maximize', 'Close'],
      expectedVariant: 'cinnamon',
      expectedPlacement: 'right',
    },
    {
      name: 'MATE (left)',
      config: resolveWindowControlsConfig({
        platform: 'linux',
        desktopEnvironment: 'mate',
        rawLayout: 'close,minimize,maximize:',
        appearance: 'dark',
      }),
      expectedLabels: ['Close', 'Minimize', 'Maximize'],
      expectedVariant: 'mate',
      expectedPlacement: 'left',
    },
    {
      name: 'Unrecognized Linux fallback',
      config: resolveWindowControlsConfig({
        platform: 'linux',
        desktopEnvironment: 'unknown',
        appearance: 'light',
      }),
      expectedLabels: ['Minimize', 'Maximize', 'Close'],
      expectedVariant: 'generic',
      expectedPlacement: 'right',
    },
  ])(
    'renders $name controls with correct order, variant, placement, and icons',
    async ({ config, expectedLabels, expectedVariant, expectedPlacement }) => {
      const el = await renderAsync(<WindowControls config={config} />)
      const wrapper = el.querySelector('[data-variant]') as HTMLElement
      expect(wrapper.getAttribute('data-variant')).toBe(expectedVariant)
      expect(wrapper.getAttribute('data-placement')).toBe(expectedPlacement)
      expect(wrapper.getAttribute('data-appearance')).toBe(config.appearance)

      const buttons = Array.from(el.querySelectorAll('button'))
      expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(expectedLabels)
      for (const btn of buttons) {
        const svg = btn.querySelector('svg')
        expect(svg).not.toBeNull()
        expect(svg?.getAttribute('aria-hidden')).toBe('true')
      }
    },
  )

  it('uses distinct native icon geometry across Windows, macOS, KDE, and GNOME', async () => {
    const winEl = await renderAsync(<WindowControls config={resolveWindowControlsConfig({ platform: 'win32' })} />)
    const winMaxSvg = winEl.querySelector('button[aria-label="Maximize"] svg')?.innerHTML
    act(() => root?.unmount())
    winEl.remove()

    const kdeEl = await renderAsync(
      <WindowControls config={resolveWindowControlsConfig({ platform: 'linux', desktopEnvironment: 'kde' })} />,
    )
    const kdeMaxSvg = kdeEl.querySelector('button[aria-label="Maximize"] svg')?.innerHTML
    const kdeMinSvg = kdeEl.querySelector('button[aria-label="Minimize"] svg')?.innerHTML
    act(() => root?.unmount())
    kdeEl.remove()

    const macEl = await renderAsync(<WindowControls config={resolveWindowControlsConfig({ platform: 'darwin' })} />)
    const macMaxSvg = macEl.querySelector('button[aria-label="Maximize"] svg')?.innerHTML

    expect(winMaxSvg).not.toBe(kdeMaxSvg)
    expect(kdeMaxSvg).not.toBe(macMaxSvg)
    expect(kdeMinSvg).toContain('4.75')
  })

  it('invokes minimize, maximize/restore, and close IPC actions and tracks maximized state', async () => {
    windowIsMaximized.mockResolvedValueOnce(true)
    const cfg = resolveWindowControlsConfig({ platform: 'linux', desktopEnvironment: 'kde' })
    const el = await renderAsync(<WindowControls config={cfg} />)

    const restoreBtn = el.querySelector('button[aria-label="Restore"]') as HTMLButtonElement
    expect(restoreBtn).not.toBeNull()

    await act(async () => {
      stateChangeListener?.({ isMaximized: false })
    })
    const maxBtn = el.querySelector('button[aria-label="Maximize"]') as HTMLButtonElement
    expect(maxBtn).not.toBeNull()

    const minBtn = el.querySelector('button[aria-label="Minimize"]') as HTMLButtonElement
    const closeBtn = el.querySelector('button[aria-label="Close"]') as HTMLButtonElement

    minBtn.click()
    maxBtn.click()
    closeBtn.click()

    expect(minimizeWindow).toHaveBeenCalledTimes(1)
    expect(maximizeWindow).toHaveBeenCalledTimes(1)
    expect(closeWindow).toHaveBeenCalledTimes(1)
  })

  it('applies Linux user settings on startup and updates appearance when theme changes', async () => {
    const linuxCfg: WindowControlsConfig = resolveWindowControlsConfig({
      platform: 'linux',
      desktopEnvironment: 'gnome',
      rawLayout: 'close,minimize,maximize:',
      appearance: 'dark',
    })
    getWindowControlsConfig.mockResolvedValueOnce(linuxCfg)

    await act(async () => {
      await useEditorStore.getState().initializeSettings()
    })

    expect(useEditorStore.getState().windowControls).toMatchObject({
      variant: 'gnome',
      placement: 'left',
      buttons: ['close', 'minimize', 'maximize'],
    })
    expect(setWindowTheme).toHaveBeenCalledWith('light')

    const el = await renderAsync(<WindowControls />)
    const wrapper = el.querySelector('[data-variant]') as HTMLElement
    expect(wrapper.getAttribute('data-variant')).toBe('gnome')
    expect(wrapper.getAttribute('data-placement')).toBe('left')
    expect(wrapper.getAttribute('data-appearance')).toBe('light')

    await act(async () => {
      useEditorStore.getState().toggleMode()
    })

    expect(setWindowTheme).toHaveBeenLastCalledWith('dark')
    expect(wrapper.getAttribute('data-appearance')).toBe('dark')
  })
})
