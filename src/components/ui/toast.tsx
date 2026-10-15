// Corner messages (DESIGN_SPEC §5): one line, optionally with a single action.
//
// Used for things the user cannot otherwise see: a copy written to a new file, a
// recent project whose file has gone missing.

import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { X } from 'tabler-icons-react'
import { useEditorStore } from '../../store/editorStore'
import { cn } from '../../lib/utils'
import { ICON_STROKE } from '../ui/icons'
import type { Toast } from '../../types'

const TOAST_TIMEOUT_MS = 6000

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), TOAST_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [toast.id, onDismiss])

  return (
    <div className="animate-menu-in pointer-events-auto flex items-center gap-2 rounded-ctl border border-line bg-panel px-3 py-2 text-ui text-fg shadow-[var(--sa-popover-shadow)]">
      <span className="min-w-0 flex-1 truncate" title={toast.message}>
        {toast.message}
      </span>
      {toast.actionLabel && (
        <button
          type="button"
          className="shrink-0 rounded-ctl px-1.5 py-0.5 text-ui text-accent hover:bg-ctl"
          onClick={() => {
            if (toast.revealPath) window.electronAPI.showItemInFolder(toast.revealPath)
            onDismiss(toast.id)
          }}
        >
          {toast.actionLabel}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        className="shrink-0 rounded-ctl text-muted hover:text-fg"
        onClick={() => onDismiss(toast.id)}
      >
        <X size={14} strokeWidth={ICON_STROKE} />
      </button>
    </div>
  )
}

/** Renders the current toasts; `className` sets the vertical offset. */
export function ToastViewport({ className = 'bottom-5' }: { className?: string }) {
  const { toasts, dismissToast } = useEditorStore(
    useShallow((state) => ({ toasts: state.toasts, dismissToast: state.dismissToast })),
  )

  if (toasts.length === 0) return null

  return (
    <div className={cn('pointer-events-none fixed right-5 z-[300] flex w-[320px] flex-col gap-2', className)}>
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}
    </div>
  )
}
