// Keeps the license/credit state fresh: once at startup, and again whenever the
// editor window regains focus (spec: refresh on app start and on window focus).

import { useEffect } from 'react'
import { useEditorStore } from '../store/editorStore'

export function useLicenseSync(): void {
  const refreshBalance = useEditorStore((state) => state.refreshBalance)

  useEffect(() => {
    void refreshBalance()

    const onFocus = () => void refreshBalance()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshBalance])
}
