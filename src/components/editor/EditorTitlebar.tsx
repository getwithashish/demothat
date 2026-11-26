import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { WindowControls } from './WindowControls'
import type { WindowControlsConfig } from '../../../shared/window-controls'

export interface EditorTitlebarProps {
  controlsConfig: WindowControlsConfig
  isHidden?: boolean
  projectCluster: ReactNode
  actions: ReactNode
}

/**
 * Adaptive application titlebar for the editor window.
 * Automatically positions window controls on the left, right, or both sides
 * according to the host OS and Linux desktop settings, keeping menus, title
 * metadata, and action buttons clear of the window controls at all times.
 */
export function EditorTitlebar({ controlsConfig, isHidden = false, projectCluster, actions }: EditorTitlebarProps) {
  const hasLeftControls = controlsConfig.leftButtons.length > 0
  const hasRightControls = controlsConfig.rightButtons.length > 0
  const isRightWindowsFlush = hasRightControls && controlsConfig.variant === 'windows'

  return (
    <header
      data-testid="editor-titlebar"
      data-controls-placement={controlsConfig.placement}
      data-controls-variant={controlsConfig.variant}
      data-controls-appearance={controlsConfig.appearance}
      className={cn(
        'relative flex h-11 flex-shrink-0 items-center justify-between gap-3 overflow-hidden border-b border-line bg-panel pl-3',
        isRightWindowsFlush ? 'pr-0' : 'pr-3',
        isHidden && 'hidden',
      )}
      style={{ WebkitAppRegion: 'drag' }}
    >
      {/* Optional left window controls: direct shrink-0 sibling so they never clip or overlap */}
      {hasLeftControls && (
        <div
          data-testid="titlebar-controls-left"
          className="flex h-full shrink-0 items-center"
          style={{ WebkitAppRegion: 'no-drag' }}
        >
          <WindowControls config={controlsConfig} buttons={controlsConfig.leftButtons} side="left" />
        </div>
      )}

      {/* Left cluster: project menu, metadata, and save status */}
      <div data-testid="titlebar-left" className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
        <div
          data-testid="titlebar-project-cluster"
          className="pointer-events-none flex min-w-0 flex-1 items-center gap-2 overflow-hidden"
        >
          {projectCluster}
        </div>
      </div>

      {/* Right cluster: action buttons (shrinkable so right window controls never overflow off-screen) */}
      <div
        data-testid="titlebar-right"
        className="flex h-full min-w-0 shrink items-center gap-2 overflow-hidden"
        style={{ WebkitAppRegion: 'no-drag' }}
      >
        <div
          data-testid="titlebar-actions"
          className="flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {actions}
        </div>
      </div>

      {/* Optional right window controls: direct shrink-0 sibling anchored at the right edge */}
      {hasRightControls && (
        <div
          data-testid="titlebar-controls-right"
          className="flex h-full shrink-0 items-center"
          style={{ WebkitAppRegion: 'no-drag' }}
        >
          {controlsConfig.variant !== 'windows' && <div className="mr-1.5 h-4 w-px bg-line" aria-hidden="true" />}
          <WindowControls config={controlsConfig} buttons={controlsConfig.rightButtons} side="right" />
        </div>
      )}
    </header>
  )
}
