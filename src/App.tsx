import { useState, useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { EditorPage } from './pages/EditorPage'
import { RecorderPage } from './pages/RecorderPage'
import { RendererPage } from './pages/RendererPage'
import { MiniHudPage } from './pages/MiniHudPage'
import { useEditorStore } from './store/editorStore'
import { useStaleScrollLockGuard } from './hooks/useStaleScrollLockGuard'
import { PageErrorBoundary } from './components/common/PageErrorBoundary'

function App() {
  const [route, setRoute] = useState(window.location.hash)
  const { mode } = useEditorStore(
    useShallow((state) => ({
      mode: state.mode,
    })),
  )
  const { initializeSettings } = useEditorStore.getState()

  // Keeps a leaked Radix scroll lock from silently making the window inert.
  useStaleScrollLockGuard()

  useEffect(() => {
    initializeSettings()
  }, [initializeSettings])

  useEffect(() => {
    // Theme is a single attribute now ('light' | 'dark'); tokens.css owns both
    // palettes and the `dark:` variant keys off it (see index.css).
    document.documentElement.setAttribute('data-theme', mode === 'dark' ? 'dark' : 'light')
  }, [mode])

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(window.location.hash)
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [])

  if (route.startsWith('#renderer')) {
    return (
      <PageErrorBoundary pageName="RendererPage">
        <RendererPage />
      </PageErrorBoundary>
    )
  }

  if (route.startsWith('#editor')) {
    return (
      <PageErrorBoundary pageName="EditorPage">
        <EditorPage />
      </PageErrorBoundary>
    )
  }

  if (route.startsWith('#mini-hud')) {
    return (
      <PageErrorBoundary pageName="MiniHudPage">
        <MiniHudPage />
      </PageErrorBoundary>
    )
  }

  return (
    <PageErrorBoundary pageName="RecorderPage">
      <RecorderPage />
    </PageErrorBoundary>
  )
}

export default App
