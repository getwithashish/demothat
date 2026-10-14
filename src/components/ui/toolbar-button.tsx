import * as React from 'react'
import { cn } from '../../lib/utils'

export interface ToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Optional leading icon. Size it with the shared constants from `ui/icons.tsx`
   * (`size={ICON_SIZE} strokeWidth={ICON_STROKE}`). DESIGN_SPEC §6's "icon 16px"
   * is superseded by the AGENTS.md hard rule (18px / 1.6).
   */
  icon?: React.ReactNode
  /** Renders the button as the active/selected toolbar item. */
  active?: boolean
  /** Square icon-only button (no label). */
  iconOnly?: boolean
}

/**
 * Timeline toolbar button (DESIGN_SPEC §6): ctl fill, 1px line, 6px radius,
 * 5px 12px padding, 13px text, optional icon on the left.
 */
export const ToolbarButton = React.forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  ({ icon, active = false, iconOnly = false, className, children, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl border border-line',
        'text-ui transition-colors',
        iconOnly ? 'h-8 w-8 p-0' : 'h-8 px-3',
        active ? 'bg-accent text-on-accent hover:bg-accent/90' : 'bg-ctl text-fg hover:bg-ctl-hover',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:pointer-events-none disabled:opacity-45',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  ),
)
ToolbarButton.displayName = 'ToolbarButton'
