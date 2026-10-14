import { useState, useEffect, lazy, Suspense } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { EditorPage } from './pages/EditorPage'
import { RecorderPage } from './pages/RecorderPage'
import { RendererPage } from './pages/RendererPage'
import { useEditorStore } from './store/editorStore'
import { useStaleScrollLockGuard } from './hooks/useStaleScrollLockGuard'

// Dev-only UI gallery (?ui-gallery). `import.meta.env.DEV` is statically false in a
// production build, so the dynamic import is dropped from the shipped bundle.
const UiGallery = import.meta.env.DEV ? lazy(() => import('./pages/UiGallery')) : null

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

  if (UiGallery && new URLSearchParams(window.location.search).has('ui-gallery')) {
    return (
      <Suspense fallback={null}>
        <UiGallery />
      </Suspense>
    )
  }

  if (route.startsWith('#renderer')) {
    return <RendererPage />
  }

  if (route.startsWith('#editor')) {
    return <EditorPage />
  }

  return <RecorderPage />
}

export default App
