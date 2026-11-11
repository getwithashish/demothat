// Modal shell for the cloud/credits dialogs.
//
// Compact dropdown card anchored beneath the trigger button,
// physically growing from and shrinking back into the button badge.

import { useCallback, useLayoutEffect, useState, type ReactNode } from 'react'
import { cn } from '../../../lib/utils'
import { useMorphSurface } from '../../../hooks/useMorphSurface'

export interface CloudDialogProps {
  isOpen?: boolean
  /** Dialog name; used as the header title (form) and the accessible label. */
  title: string
  /** Second line under the title. Also used as the body in the 'state' layout. */
  subtitle?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  onClose?: () => void
  /** Width cap in px (reference: 440 for forms, 380 for the payment window). */
  maxWidth?: number
  /**
   * 'form'  — header (title + subtitle), hairline sections, footer actions.
   * 'state' — centred icon, title, body, then the actions row.
   */
  variant?: 'form' | 'state'
  /** Icon shown above the title in the 'state' layout. */
  icon?: ReactNode
  className?: string
  /** CSS selector for the trigger element to morph from */
  triggerSelector?: string
}

/** One hairline section inside a CloudDialog. */
export function CloudDialogSection({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-[18px] py-[14px]', className)}>{children}</div>
}

export function CloudDialog({
  isOpen = true,
  title,
  subtitle,
  children,
  footer,
  onClose,
  maxWidth = 420,
  variant = 'form',
  icon,
  className,
  triggerSelector = '#buy-credits-trigger-btn, #get-pro-trigger-btn, #credits-trigger-btn',
}: CloudDialogProps) {
  const computeAnchoredStyle = useCallback((): React.CSSProperties => {
    if (typeof document !== 'undefined' && triggerSelector) {
      const trigger = document.querySelector<HTMLElement>(triggerSelector)
      if (trigger) {
        const tRect = trigger.getBoundingClientRect()
        const top = Math.round(tRect.bottom + 8)
        const left = Math.round(Math.max(16, Math.min(window.innerWidth - maxWidth - 16, tRect.right - maxWidth)))
        return {
          position: 'absolute',
          top: `${top}px`,
          left: `${left}px`,
          width: `${maxWidth}px`,
          maxWidth: 'calc(100vw - 32px)',
        }
      }
    }
    return {
      width: `${maxWidth}px`,
      maxWidth: 'calc(100vw - 32px)',
    }
  }, [triggerSelector, maxWidth])

  const [anchoredStyle, setAnchoredStyle] = useState<React.CSSProperties>(computeAnchoredStyle)

  // Calculate resting destination position anchored right below the trigger button
  useLayoutEffect(() => {
    setAnchoredStyle(computeAnchoredStyle())
  }, [computeAnchoredStyle])

  const { surfaceRef, isRendered, requestClose } = useMorphSurface({
    isOpen,
    triggerSelector,
    targetRadius: 12,
    duration: 440,
    onClosed: onClose,
  })

  if (!isRendered) return null

  return (
    <div
      className={cn('modal-backdrop', !anchoredStyle.position && 'flex items-center justify-center')}
      onClick={requestClose}
      role="presentation"
    >
      <div
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={anchoredStyle}
        className={cn('card-clean pointer-events-auto flex flex-col overflow-hidden shadow-2xl', className)}
        onClick={(event) => event.stopPropagation()}
      >
        {variant === 'form' ? (
          <>
            <header className="border-b border-line px-[18px] pt-4 pb-1.5">
              <h3 className="whitespace-nowrap text-title font-semibold text-fg">{title}</h3>
              {subtitle != null && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
            </header>
            <div className="[&>*+*]:border-t [&>*+*]:border-line">{children}</div>
          </>
        ) : (
          <div className="flex flex-col items-center px-8 py-8 text-center">
            {icon && <div className="text-muted">{icon}</div>}
            <h3 className="mt-4 text-title font-semibold text-fg">{title}</h3>
            {subtitle != null && <p className="mt-0.5 max-w-[32ch] text-sm text-muted">{subtitle}</p>}
            {children}
          </div>
        )}

        {footer && <footer className="flex justify-end gap-2 border-t border-line p-4">{footer}</footer>}
      </div>
    </div>
  )
}
