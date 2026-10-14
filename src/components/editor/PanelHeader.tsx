import type { ReactNode } from 'react'

/**
 * Inspector panel header (DESIGN_SPEC §5): title 15px/600 + subtitle 12px muted.
 * Padding follows §4: 16px top, 18px sides, 6px bottom. No icon tile (banned by the
 * hard rules), no card.
 */
export function PanelHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  /** Optional trailing controls (e.g. a delete button). */
  actions?: ReactNode
}) {
  return (
    <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-[18px] pt-4 pb-1.5">
      <div className="min-w-0">
        <h2 className="truncate text-title font-semibold text-fg">{title}</h2>
        {subtitle != null && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions}
    </header>
  )
}
