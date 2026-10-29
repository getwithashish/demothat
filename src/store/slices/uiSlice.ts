import type { UIState, UIActions, Slice, CursorStyles, SidePanelTab } from '../../types'
import type { CursorIconStyle } from '../../lib/cursor-icons'
import { DEFAULTS } from '../../lib/constants'
import {
  addRecentProject,
  parseRecentProjects,
  projectNameFromPath,
  removeRecentProject,
} from '../../lib/recent-projects'

/** Auto-save cadence when the user has not chosen one. */
export const DEFAULT_AUTO_SAVE_INTERVAL_SEC = 30
const AUTO_SAVE_ENABLED_KEY = 'editor.autoSaveEnabled'
const AUTO_SAVE_INTERVAL_KEY = 'editor.autoSaveIntervalSec'
const RECENT_PROJECTS_KEY = 'project.recentProjects'

/** How many corner messages can stack up before the oldest is dropped. */
const MAX_VISIBLE_TOASTS = 3

/** Toast ids only need to be unique within a session. */
let toastCounter = 0

const initialCursorStyles: CursorStyles = {
  showCursor: DEFAULTS.CURSOR.SHOW_CURSOR.defaultValue,
  cursorIcon: DEFAULTS.CURSOR.ICON.defaultValue as CursorIconStyle,
  shadowBlur: DEFAULTS.CURSOR.SHADOW.BLUR.defaultValue,
  shadowOffsetX: DEFAULTS.CURSOR.SHADOW.OFFSET_X.defaultValue,
  shadowOffsetY: DEFAULTS.CURSOR.SHADOW.OFFSET_Y.defaultValue,
  shadowColor: DEFAULTS.CURSOR.SHADOW.DEFAULT_COLOR_RGBA,
  clickRippleEffect: DEFAULTS.CURSOR.CLICK_RIPPLE.ENABLED.defaultValue,
  clickRippleColor: DEFAULTS.CURSOR.CLICK_RIPPLE.COLOR.defaultValue,
  clickRippleSize: DEFAULTS.CURSOR.CLICK_RIPPLE.SIZE.defaultValue,
  clickRippleDuration: DEFAULTS.CURSOR.CLICK_RIPPLE.DURATION.defaultValue,
  clickScaleEffect: DEFAULTS.CURSOR.CLICK_SCALE.ENABLED.defaultValue,
  clickScaleAmount: DEFAULTS.CURSOR.CLICK_SCALE.AMOUNT.defaultValue,
  clickScaleDuration: DEFAULTS.CURSOR.CLICK_SCALE.DURATION.defaultValue,
  clickScaleEasing: DEFAULTS.CURSOR.CLICK_SCALE.EASING.defaultValue,
  smoothingEnabled: DEFAULTS.CURSOR.MOTION.SMOOTHING_ENABLED.defaultValue,
  smoothing: DEFAULTS.CURSOR.MOTION.SMOOTHING.defaultValue,
  motionBlurEnabled: DEFAULTS.CURSOR.MOTION.BLUR_ENABLED.defaultValue,
  motionBlurShutterAngle: DEFAULTS.CURSOR.MOTION.BLUR_SHUTTER.defaultValue,
  motionBlurSamples: DEFAULTS.CURSOR.MOTION.BLUR_SAMPLES.defaultValue,
  motionBlurStrength: DEFAULTS.CURSOR.MOTION.BLUR_STRENGTH.defaultValue,
}

export const initialUIState: UIState = {
  mode: 'light',
  isPreviewFullScreen: false,
  cursorThemeName: 'default',
  cursorStyles: initialCursorStyles,
  activeSidePanelTab: 'general',
  autoSaveEnabled: true,
  autoSaveIntervalSec: DEFAULT_AUTO_SAVE_INTERVAL_SEC,
  recentProjects: [],
  toasts: [],
}

const updateWindowsTitleBar = (mode: 'light' | 'dark', platform: NodeJS.Platform | null) => {
  if (platform !== 'win32') return

  const options =
    mode === 'dark'
      ? { color: '#17181b', symbolColor: '#ebecee' } // Paper tokens: --sa-panel / --sa-text (dark)
      : { color: '#f6f5f2', symbolColor: '#1d1d1b' } // Paper tokens: --sa-panel / --sa-text (light)
  window.electronAPI.updateTitleBarOverlay(options)
}

export const createUISlice: Slice<UIState, UIActions> = (set, get) => ({
  ...initialUIState,
  toggleMode: () => {
    const newMode = get().mode === 'dark' ? 'light' : 'dark'
    set((state) => {
      state.mode = newMode
    })
    window.electronAPI.setSetting('appearance.mode', newMode)
    updateWindowsTitleBar(newMode, get().platform)
  },
  initializeSettings: async () => {
    try {
      const appearance = await window.electronAPI.getSetting<{
        mode: 'light' | 'dark'
        cursorThemeName: string
        cursorStyles: Partial<CursorStyles>
      }>('appearance')

      // Default to the OS colour scheme (Electron's nativeTheme drives the
      // renderer's `prefers-color-scheme`); a persisted override wins.
      const preferred: 'light' | 'dark' =
        typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      const finalMode: 'light' | 'dark' = appearance?.mode ?? preferred

      set((state) => {
        state.mode = finalMode
      })
      if (appearance?.cursorThemeName) {
        set((state) => {
          state.cursorThemeName = appearance.cursorThemeName
        })
      }
      if (appearance?.cursorStyles) {
        set((state) => {
          state.cursorStyles = { ...initialCursorStyles, ...appearance.cursorStyles }
        })
      }
      const [autoSaveEnabled, autoSaveIntervalSec] = await Promise.all([
        window.electronAPI.getSetting<boolean>(AUTO_SAVE_ENABLED_KEY),
        window.electronAPI.getSetting<number>(AUTO_SAVE_INTERVAL_KEY),
      ])
      set((state) => {
        state.autoSaveEnabled = autoSaveEnabled ?? initialUIState.autoSaveEnabled
        state.autoSaveIntervalSec =
          typeof autoSaveIntervalSec === 'number' && autoSaveIntervalSec > 0
            ? autoSaveIntervalSec
            : initialUIState.autoSaveIntervalSec
      })
      updateWindowsTitleBar(finalMode, get().platform)
    } catch (error) {
      console.error('Could not load app settings:', error)
    }
  },
  togglePreviewFullScreen: () =>
    set((state) => {
      state.isPreviewFullScreen = !state.isPreviewFullScreen
    }),
  setCursorThemeName: (themeName: string) => {
    set((state) => {
      state.cursorThemeName = themeName
    })
    window.electronAPI.setSetting('appearance.cursorThemeName', themeName)
  },
  updateCursorStyle: (style: Partial<CursorStyles>) => {
    set((state) => {
      Object.assign(state.cursorStyles, style)
    })
    window.electronAPI.setSetting('appearance.cursorStyles', get().cursorStyles)
  },
  setActiveSidePanelTab: (tab: SidePanelTab) => {
    set((state) => {
      state.activeSidePanelTab = tab
    })
  },
  setAutoSaveEnabled: (enabled: boolean) => {
    set((state) => {
      state.autoSaveEnabled = enabled
    })
    window.electronAPI.setSetting(AUTO_SAVE_ENABLED_KEY, enabled)
  },
  setAutoSaveIntervalSec: (seconds: number) => {
    const clamped = Math.max(5, Math.round(seconds))
    set((state) => {
      state.autoSaveIntervalSec = clamped
    })
    window.electronAPI.setSetting(AUTO_SAVE_INTERVAL_KEY, clamped)
  },
  initializeRecentProjects: async () => {
    try {
      const stored = await window.electronAPI.getSetting(RECENT_PROJECTS_KEY)
      set((state) => {
        state.recentProjects = parseRecentProjects(stored)
      })
    } catch (error) {
      console.error('Could not load the recent project list:', error)
    }
  },
  rememberRecentProject: (path: string) => {
    if (!path) return
    const next = addRecentProject(get().recentProjects, {
      path,
      name: projectNameFromPath(path),
      openedAt: Date.now(),
    })
    set((state) => {
      state.recentProjects = next
    })
    void window.electronAPI.setSetting(RECENT_PROJECTS_KEY, next)
  },
  forgetRecentProject: (path: string) => {
    const next = removeRecentProject(get().recentProjects, path)
    set((state) => {
      state.recentProjects = next
    })
    void window.electronAPI.setSetting(RECENT_PROJECTS_KEY, next)
  },
  clearRecentProjects: () => {
    set((state) => {
      state.recentProjects = []
    })
    void window.electronAPI.setSetting(RECENT_PROJECTS_KEY, [])
  },
  pushToast: (toast) => {
    const id = `toast-${++toastCounter}`
    set((state) => {
      state.toasts = [...state.toasts, { id, ...toast }].slice(-MAX_VISIBLE_TOASTS)
    })
  },
  dismissToast: (id: string) => {
    set((state) => {
      state.toasts = state.toasts.filter((toast) => toast.id !== id)
    })
  },
})
