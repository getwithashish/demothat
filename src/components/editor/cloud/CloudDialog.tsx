// Modal shell for the cloud/credits dialogs.
//
// Mirrors the reference file's "card-clean + PanelHeader + Section" modal: a
// scrim, a card with hairline sections, one primary action right-aligned in the
// footer (design rules §3), and the 180ms rise/scale entrance (§9).

import { useEffect, type ReactNode } from 'react'
import { cn } from '../../../lib/utils'

export interface CloudDialogProps {
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
}

/** One hairline section inside a CloudDialog. */
export function CloudDialogSection({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-[18px] py-[14px]', className)}>{children}</div>
}

export function CloudDialog({
  title,
  subtitle,
  children,
  footer,
  onClose,
  maxWidth = 440,
  variant = 'form',
  icon,
  className,
}: CloudDialogProps) {
  useEffect(() => {
    if (!onClose) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop flex items-center justify-center" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ maxWidth }}
        className={cn(
          'card-clean animate-dialog-in pointer-events-auto m-4 flex w-full flex-col overflow-hidden',
          className,
        )}
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
