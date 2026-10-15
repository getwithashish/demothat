import { useCallback, useEffect, useState } from 'react'
import { useEditorStore } from '../store/editorStore'

export type Theme = 'light' | 'dark'

/**
 * Reads and switches the app theme.
 *
 * The theme lives in the editor store (`mode`), is persisted to electron-store as
 * `appearance.mode`, and is applied to `<html data-theme="light|dark">` by App.
 * Defaulting to the OS comes from Electron's nativeTheme via `prefers-color-scheme`
 * (see index.html and uiSlice.initializeSettings).
 */
export function useTheme() {
  const theme = useEditorStore((state) => state.mode) as Theme
  const toggleMode = useEditorStore((state) => state.toggleMode)

  const setTheme = useCallback(
    (next: Theme) => {
      // toggleMode flips to the other value; guard so setTheme(same) is a no-op.
      if (useEditorStore.getState().mode !== next) toggleMode()
    },
    [toggleMode],
  )

  const toggle = useCallback(() => toggleMode(), [toggleMode])

  return { theme, setTheme, toggle }
}

/**
 * Applies the theme to the document element. Kept as a hook so App stays a
 * one-liner and any future consumer can force the attribute.
 */
export function useApplyTheme() {
  const { theme } = useTheme()
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
}

/**
 * Tracks the OS colour scheme. Only used as a fallback before the persisted
 * override loads; `prefers-color-scheme` is what Electron's nativeTheme drives.
 */
export function usePreferredTheme(): Theme {
  const [preferred, setPreferred] = useState<Theme>(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  )

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!query) return
    const onChange = (event: MediaQueryListEvent) => setPreferred(event.matches ? 'dark' : 'light')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return preferred
}
