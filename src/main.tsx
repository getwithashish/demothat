import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { useEditorStore } from './store/editorStore'

if (typeof window !== 'undefined') {
  ;(window as unknown as { __editorStore: typeof useEditorStore }).__editorStore = useEditorStore
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
