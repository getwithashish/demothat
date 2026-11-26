// Update notification banner shown in the editor toolbar.
//
// Renders one of three states:
//   'available'   — fallback for deb/rpm/macOS: a button that opens the
//                   GitHub release page in the browser.
//   'downloading' — electron-updater is pulling the new binary in the
//                   background; shows a compact progress indicator.
//   'ready'       — download complete; prompts the user to restart now or
//                   dismiss (the update will be applied next time they open
//                   the app, since electron-updater caches the download).
import { Download, Refresh, X } from 'tabler-icons-react'
import { Button } from '../ui/button'
import { ICON_SIZE, ICON_STROKE } from '../ui/icons'

export type UpdateState =
  | { phase: 'available'; version: string; url: string }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'ready'; version: string }

interface UpdateNotificationProps {
  state: UpdateState
  onDismiss: () => void
}

export function UpdateNotification({ state, onDismiss }: UpdateNotificationProps) {
  if (state.phase === 'available') {
    return (
      <div className="flex items-center gap-1">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => window.electronAPI.openExternal(state.url)}
          aria-label={`Version ${state.version} available — open download page`}
          className="text-accent"
        >
          <Download size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-1.5" />v{state.version} available
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          aria-label="Dismiss update notification"
          className="text-muted px-1.5"
        >
          <X size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </Button>
      </div>
    )
  }

  if (state.phase === 'downloading') {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-muted select-none" aria-live="polite">
        <Download size={12} strokeWidth={ICON_STROKE} className="shrink-0 animate-pulse text-accent" />
        Downloading v{state.version}…&nbsp;{state.percent}%
      </span>
    )
  }

  // phase === 'ready'
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => window.electronAPI.installUpdate()}
        aria-label="Restart to install update"
        className="text-accent"
      >
        <Refresh size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-1.5" />
        Restart to install
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDismiss}
        aria-label="Dismiss — install update later"
        className="text-muted px-1.5"
      >
        Later
      </Button>
    </div>
  )
}
