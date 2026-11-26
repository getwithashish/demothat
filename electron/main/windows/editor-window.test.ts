import { beforeEach, describe, expect, it, vi } from 'vitest'

const createdWindows: Array<{
  options: Record<string, unknown>
  instance: {
    id: number
    webContents: {
      on: ReturnType<typeof vi.fn>
      send: ReturnType<typeof vi.fn>
      getURL: ReturnType<typeof vi.fn>
    }
    on: ReturnType<typeof vi.fn>
    once: ReturnType<typeof vi.fn>
    show: ReturnType<typeof vi.fn>
    maximize: ReturnType<typeof vi.fn>
    isMaximized: ReturnType<typeof vi.fn>
    isDestroyed: ReturnType<typeof vi.fn>
    getBounds: ReturnType<typeof vi.fn>
    loadURL: ReturnType<typeof vi.fn>
    setWindowButtonVisibility: ReturnType<typeof vi.fn>
  }
}> = []

vi.mock('electron', () => {
  return {
    app: { isPackaged: false, getPath: () => '/tmp', getAppPath: () => process.cwd() },
    BrowserWindow: vi.fn().mockImplementation((options: Record<string, unknown>) => {
      const instance = {
        id: createdWindows.length + 1,
        webContents: {
          on: vi.fn(),
          send: vi.fn(),
          getURL: vi.fn(() => 'http://localhost/#editor'),
        },
        on: vi.fn(),
        once: vi.fn(),
        show: vi.fn(),
        maximize: vi.fn(),
        isMaximized: vi.fn(() => false),
        isDestroyed: vi.fn(() => false),
        getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1280, height: 800 })),
        loadURL: vi.fn(),
        setWindowButtonVisibility: vi.fn(),
      }
      createdWindows.push({ options, instance })
      return instance
    }),
    nativeTheme: { shouldUseDarkColors: false, themeSource: 'system' },
  }
})

vi.mock('electron-store', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn((_k: string, def?: unknown) => def),
    set: vi.fn(),
  })),
}))

vi.mock('../features/recording-manager', () => ({
  cleanupOrphanedRecordings: vi.fn(),
}))

vi.mock('../features/app-menu', () => ({
  createEditorMenu: vi.fn(),
  clearMenu: vi.fn(),
}))

vi.mock('../features/session-guard', () => ({
  confirmReplaceSession: vi.fn(),
  isQuitApproved: vi.fn(() => false),
}))

vi.mock('../features/window-controls', () => ({
  getWindowControlsConfig: vi.fn().mockResolvedValue({
    platform: 'linux',
    desktopEnvironment: 'kde',
    distro: 'ubuntu',
    variant: 'kde',
    placement: 'right',
    buttons: ['minimize', 'maximize', 'close'],
    leftButtons: [],
    rightButtons: ['minimize', 'maximize', 'close'],
    appearance: 'light',
  }),
}))

import { createEditorWindowForProject } from './editor-window'

describe('editor-window startup window controls', () => {
  beforeEach(() => {
    createdWindows.length = 0
  })

  it('creates frameless window without native titleBarOverlay and pushes window:controls-changed on load and focus', async () => {
    createEditorWindowForProject()
    expect(createdWindows).toHaveLength(1)
    const { options, instance } = createdWindows[0]

    expect(options.frame).toBe(false)
    expect(options.titleBarOverlay).toBeUndefined()

    const didFinishLoadCall = instance.webContents.on.mock.calls.find(([evt]) => evt === 'did-finish-load')
    expect(didFinishLoadCall).toBeDefined()
    didFinishLoadCall![1]()

    await Promise.resolve()
    await Promise.resolve()
    expect(instance.webContents.send).toHaveBeenCalledWith(
      'window:controls-changed',
      expect.objectContaining({ variant: 'kde', placement: 'right' }),
    )

    const focusCall = instance.on.mock.calls.find(([evt]) => evt === 'focus')
    expect(focusCall).toBeDefined()
    focusCall![1]()
    await Promise.resolve()
    await Promise.resolve()
    expect(instance.webContents.send).toHaveBeenCalledTimes(2)
  })

  it('hides native macOS traffic lights when running on darwin so adaptive WindowControls render without duplicates', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    try {
      createEditorWindowForProject()
      expect(createdWindows).toHaveLength(1)
      expect(createdWindows[0].instance.setWindowButtonVisibility).toHaveBeenCalledWith(false)
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    }
  })
})
