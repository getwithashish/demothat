import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '../../lib/utils'
import { useEditorStore } from '../../store/editorStore'
import {
  resolveWindowControlsConfig,
  type WindowControlAction,
  type WindowControlsConfig,
  type WindowControlsPlacement,
  type WindowControlsVariant,
} from '../../../shared/window-controls'

export interface WindowControlsProps {
  config?: WindowControlsConfig
  buttons?: WindowControlAction[]
  side?: WindowControlsPlacement
  className?: string
}

function renderControlIcon(
  action: WindowControlAction,
  variant: WindowControlsVariant,
  isMaximized: boolean,
): React.ReactNode {
  if (variant === 'macos') {
    const iconClass =
      'h-2 w-2 opacity-0 transition-opacity duration-150 group-hover/window-controls:opacity-100 group-focus-within/window-controls:opacity-100'
    if (action === 'close') {
      return (
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          className={iconClass}
          aria-hidden="true"
        >
          <path d="M3 3l6 6M9 3l-6 6" />
        </svg>
      )
    }
    if (action === 'minimize') {
      return (
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          className={iconClass}
          aria-hidden="true"
        >
          <path d="M2.5 6h7" />
        </svg>
      )
    }
    return isMaximized ? (
      <svg viewBox="0 0 12 12" fill="currentColor" className={iconClass} aria-hidden="true">
        <path d="M5.5 6.5H2.5L5.5 9.5V6.5ZM6.5 5.5H9.5L6.5 2.5V5.5Z" />
      </svg>
    ) : (
      <svg viewBox="0 0 12 12" fill="currentColor" className={iconClass} aria-hidden="true">
        <path d="M2.5 9.5V5.5L6.5 9.5H2.5ZM9.5 2.5V6.5L5.5 2.5H9.5Z" />
      </svg>
    )
  }

  if (variant === 'windows') {
    if (action === 'close') {
      return (
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.15}
          strokeLinecap="round"
          className="h-3 w-3"
          aria-hidden="true"
        >
          <path d="M2.25 2.25l7.5 7.5M9.75 2.25l-7.5 7.5" />
        </svg>
      )
    }
    if (action === 'minimize') {
      return (
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.15}
          strokeLinecap="round"
          className="h-3 w-3"
          aria-hidden="true"
        >
          <path d="M2 6h8" />
        </svg>
      )
    }
    return isMaximized ? (
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.15}
        strokeLinejoin="round"
        className="h-3 w-3"
        aria-hidden="true"
      >
        <path d="M4 3.5V2h6v6H8.5" />
        <rect x="2" y="4" width="6" height="6" rx="0.5" />
      </svg>
    ) : (
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.15}
        strokeLinejoin="round"
        className="h-3 w-3"
        aria-hidden="true"
      >
        <rect x="2" y="2" width="8" height="8" rx="0.5" />
      </svg>
    )
  }

  if (variant === 'kde') {
    if (action === 'close') {
      return (
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          className="h-3 w-3"
          aria-hidden="true"
        >
          <path d="M3.25 3.25l5.5 5.5M8.75 3.25l-5.5 5.5" />
        </svg>
      )
    }
    if (action === 'minimize') {
      return (
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3 w-3"
          aria-hidden="true"
        >
          <path d="M3 4.75L6 7.75L9 4.75" />
        </svg>
      )
    }
    return isMaximized ? (
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
        className="h-3 w-3"
        aria-hidden="true"
      >
        <path d="M6 2.5L9.5 6L6 9.5L2.5 6Z" />
      </svg>
    ) : (
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3 w-3"
        aria-hidden="true"
      >
        <path d="M3 7.25L6 4.25L9 7.25" />
      </svg>
    )
  }

  if (variant === 'xfce' || variant === 'mate') {
    if (action === 'close') {
      return (
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.55}
          strokeLinecap="round"
          className="h-3 w-3"
          aria-hidden="true"
        >
          <path d="M3.25 3.25l5.5 5.5M8.75 3.25l-5.5 5.5" />
        </svg>
      )
    }
    if (action === 'minimize') {
      return (
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          className="h-3 w-3"
          aria-hidden="true"
        >
          <path d="M2.5 8.5h7" />
        </svg>
      )
    }
    return isMaximized ? (
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.35}
        strokeLinejoin="round"
        className="h-3 w-3"
        aria-hidden="true"
      >
        <path d="M4.5 3.5V2.5h5v5h-1" />
        <rect x="2.5" y="4.5" width="5" height="5" rx="0.5" />
      </svg>
    ) : (
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        className="h-3 w-3"
        aria-hidden="true"
      >
        <rect x="2.5" y="2.5" width="7" height="7" rx="0.5" strokeWidth={1.35} />
        <path d="M2.5 4.15h7" strokeWidth={1.9} />
      </svg>
    )
  }

  if (variant === 'cinnamon') {
    if (action === 'close') {
      return (
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.45}
          strokeLinecap="round"
          className="h-3 w-3"
          aria-hidden="true"
        >
          <path d="M3.25 3.25l5.5 5.5M8.75 3.25l-5.5 5.5" />
        </svg>
      )
    }
    if (action === 'minimize') {
      return (
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.45}
          strokeLinecap="round"
          className="h-3 w-3"
          aria-hidden="true"
        >
          <path d="M3 6h6" />
        </svg>
      )
    }
    return isMaximized ? (
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.35}
        strokeLinejoin="round"
        className="h-3 w-3"
        aria-hidden="true"
      >
        <path d="M4.5 3.5V2.5h5v5h-1" />
        <rect x="2.5" y="4.5" width="5" height="5" rx="0.5" />
      </svg>
    ) : (
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.35}
        strokeLinejoin="round"
        className="h-3 w-3"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="6" height="6" rx="0.5" />
      </svg>
    )
  }

  // 'gnome' and 'generic'
  if (action === 'close') {
    return (
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        className="h-3 w-3"
        aria-hidden="true"
      >
        <path d="M3.25 3.25l5.5 5.5M8.75 3.25l-5.5 5.5" />
      </svg>
    )
  }
  if (action === 'minimize') {
    return (
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        className="h-3 w-3"
        aria-hidden="true"
      >
        <path d="M3 8.5h6" />
      </svg>
    )
  }
  return isMaximized ? (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinejoin="round"
      className="h-3 w-3"
      aria-hidden="true"
    >
      <path d="M4.5 3.5V2.5h5v5h-1" />
      <rect x="2.5" y="4.5" width="5" height="5" rx="0.5" />
    </svg>
  ) : (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinejoin="round"
      className="h-3 w-3"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="6" height="6" rx="0.5" />
    </svg>
  )
}

function getContainerClass(variant: WindowControlsVariant): string {
  switch (variant) {
    case 'windows':
      return 'flex h-full items-stretch'
    case 'macos':
      return 'group/window-controls flex items-center gap-2'
    case 'gnome':
    case 'cinnamon':
      return 'flex items-center gap-1.5'
    case 'kde':
    case 'xfce':
    case 'mate':
    case 'generic':
      return 'flex items-center gap-1'
  }
}

function getButtonClass(variant: WindowControlsVariant, action: WindowControlAction): string {
  const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

  switch (variant) {
    case 'windows':
      return cn(
        'flex h-full w-11 items-center justify-center transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
        action === 'close'
          ? 'text-fg/85 hover:bg-red-600 hover:text-white active:bg-red-700 active:text-white'
          : 'text-fg/85 hover:bg-ctl hover:text-fg active:bg-ctl-hover',
      )
    case 'macos':
      return cn(
        'flex h-3 w-3 items-center justify-center rounded-full ring-1 ring-inset ring-fg/15 transition-colors duration-150',
        focusRing,
        action === 'close' && 'bg-red-500 text-red-950 hover:bg-red-600',
        action === 'minimize' && 'bg-amber-400 text-amber-950 hover:bg-amber-500',
        action === 'maximize' && 'bg-emerald-500 text-emerald-950 hover:bg-emerald-600',
      )
    case 'gnome':
      return cn(
        'flex h-6 w-6 items-center justify-center rounded-full bg-ctl/75 text-fg/85 transition-colors duration-150 hover:bg-ctl hover:text-fg active:bg-ctl-hover',
        focusRing,
      )
    case 'kde':
      return cn(
        'flex h-6 w-6 items-center justify-center rounded-full text-fg/85 transition-colors duration-150',
        focusRing,
        action === 'close'
          ? 'hover:bg-red-500 hover:text-white active:bg-red-600 active:text-white'
          : 'hover:bg-ctl hover:text-fg active:bg-ctl-hover',
      )
    case 'cinnamon':
      return cn(
        'flex h-6 w-6 items-center justify-center rounded-full text-fg/85 transition-colors duration-150',
        focusRing,
        action === 'close'
          ? 'bg-ctl/75 hover:bg-red-500 hover:text-white active:bg-red-600 active:text-white'
          : 'hover:bg-ctl hover:text-fg active:bg-ctl-hover',
      )
    case 'mate':
      return cn(
        'flex h-6 w-6 items-center justify-center rounded-ctl border border-transparent text-fg/85 transition-colors duration-150',
        focusRing,
        action === 'close'
          ? 'hover:border-danger/30 hover:bg-danger/15 hover:text-danger'
          : 'hover:border-line hover:bg-ctl hover:text-fg',
      )
    case 'xfce':
    case 'generic':
      return cn(
        'flex h-6 w-6 items-center justify-center rounded-ctl text-fg/85 transition-colors duration-150',
        focusRing,
        action === 'close'
          ? 'hover:bg-danger/15 hover:text-danger active:bg-danger/25'
          : 'hover:bg-ctl hover:text-fg active:bg-ctl-hover',
      )
  }
}

export function WindowControls({ config, buttons, side, className }: WindowControlsProps) {
  const [isMaximized, setIsMaximized] = useState(false)
  const { storedControls, mode, platform } = useEditorStore(
    useShallow((state) => ({
      storedControls: state.windowControls,
      mode: state.mode,
      platform: state.platform,
    })),
  )

  const resolvedConfig =
    config ??
    storedControls ??
    resolveWindowControlsConfig({
      platform: platform ?? 'linux',
      appearance: mode,
    })

  const activeButtons = buttons ?? resolvedConfig.buttons
  const effectiveSide = side ?? resolvedConfig.placement

  useEffect(() => {
    let mounted = true
    const getInitialState = async () => {
      try {
        const maximized = await window.electronAPI?.windowIsMaximized?.()
        if (mounted && typeof maximized === 'boolean') {
          setIsMaximized(maximized)
        }
      } catch {
        // Ignore in mocked/headless environments
      }
    }
    void getInitialState()

    const cleanup = window.electronAPI?.onWindowStateChange?.(({ isMaximized: newIsMaximized }) => {
      setIsMaximized(newIsMaximized)
    })

    return () => {
      mounted = false
      cleanup?.()
    }
  }, [])

  if (activeButtons.length === 0) return null

  const handleAction = (action: WindowControlAction) => {
    if (action === 'minimize') window.electronAPI?.minimizeWindow?.()
    else if (action === 'maximize') window.electronAPI?.maximizeWindow?.()
    else window.electronAPI?.closeWindow?.()
  }

  return (
    <div
      data-testid={side ? `window-controls-${side}` : 'window-controls'}
      data-variant={resolvedConfig.variant}
      data-placement={effectiveSide}
      data-appearance={resolvedConfig.appearance}
      data-button-order={activeButtons.join(',')}
      className={cn(getContainerClass(resolvedConfig.variant), className)}
      style={{ WebkitAppRegion: 'no-drag' }}
    >
      {activeButtons.map((action) => {
        const label =
          action === 'close' ? 'Close' : action === 'minimize' ? 'Minimize' : isMaximized ? 'Restore' : 'Maximize'
        return (
          <button
            key={`${resolvedConfig.variant}-${action}`}
            type="button"
            data-window-control={action}
            onClick={() => handleAction(action)}
            className={getButtonClass(resolvedConfig.variant, action)}
            aria-label={label}
            title={label}
          >
            {renderControlIcon(action, resolvedConfig.variant, isMaximized)}
          </button>
        )
      })}
    </div>
  )
}
