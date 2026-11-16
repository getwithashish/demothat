import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockBrowserWindow = {
  setAlwaysOnTop: vi.fn(),
  setVisibleOnAllWorkspaces: vi.fn(),
  loadURL: vi.fn().mockResolvedValue(undefined),
  show: vi.fn(),
  hide: vi.fn(),
  destroy: vi.fn(),
  isVisible: vi.fn().mockReturnValue(false),
  isDestroyed: vi.fn().mockReturnValue(false),
  on: vi.fn(),
}

vi.mock('electron', () => {
  return {
    BrowserWindow: vi.fn().mockImplementation(() => mockBrowserWindow),
    screen: {
      getPrimaryDisplay: vi.fn().mockReturnValue({
        workAreaSize: { width: 1920, height: 1080 },
      }),
    },
    app: {
      isPackaged: false,
    },
  }
})

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import {
  createHudWindow,
  showHudWindow,
  hideHudWindow,
  toggleHudWindow,
  getHudWindow,
  destroyHudWindow,
} from './hud-window'

describe('HudWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    destroyHudWindow()
    mockBrowserWindow.isVisible.mockReturnValue(false)
    mockBrowserWindow.isDestroyed.mockReturnValue(false)
  })

  it('creates and returns the hud window singleton with always-on-top level', () => {
    const win = createHudWindow()
    expect(win).toBeDefined()
    expect(mockBrowserWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver')
    expect(mockBrowserWindow.loadURL).toHaveBeenCalledWith(expect.stringContaining('#mini-hud'))

    // Singleton check
    const win2 = createHudWindow()
    expect(win2).toBe(win)
  })

  it('shows and hides hud window', () => {
    showHudWindow()
    expect(mockBrowserWindow.show).toHaveBeenCalled()

    mockBrowserWindow.isVisible.mockReturnValue(true)
    hideHudWindow()
    expect(mockBrowserWindow.hide).toHaveBeenCalled()
  })

  it('toggles hud window visibility', () => {
    // When hidden, toggling should show it
    mockBrowserWindow.isVisible.mockReturnValue(false)
    toggleHudWindow()
    expect(mockBrowserWindow.show).toHaveBeenCalled()

    // When visible, toggling should hide it
    mockBrowserWindow.isVisible.mockReturnValue(true)
    toggleHudWindow()
    expect(mockBrowserWindow.hide).toHaveBeenCalled()
  })

  it('destroys hud window properly', () => {
    createHudWindow()
    expect(getHudWindow()).toBeDefined()

    destroyHudWindow()
    expect(mockBrowserWindow.destroy).toHaveBeenCalled()
    expect(getHudWindow()).toBeNull()
  })
})
