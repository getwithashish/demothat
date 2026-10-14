import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/**
 * Flat inspector section (DESIGN_SPEC §6): hairline top border, no background,
 * 14px vertical / 18px horizontal padding. Pass `first` on the first section of a
 * panel to drop the top hairline.
 */
export interface SectionProps {
  /** Uppercase section label. Omitted → no label row. */
  label?: ReactNode
  /** Optional right-aligned content in the label row (e.g. a value or a toggle). */
  labelRight?: ReactNode
  /** First section in a panel: suppresses the hairline top border. */
  first?: boolean
  className?: string
  children: ReactNode
}

export function Section({ label, labelRight, first = false, className, children }: SectionProps) {
  return (
    <section className={cn('px-[18px] py-[14px]', !first && 'border-t border-line', className)}>
      {(label != null || labelRight != null) && (
        <div className="mb-2.5 flex items-center justify-between gap-3">
          {label != null && <SectionLabel as="div">{label}</SectionLabel>}
          {labelRight}
        </div>
      )}
      {children}
    </section>
  )
}

/** 11px uppercase, 0.06em tracking, muted (DESIGN_SPEC §3). */
export function SectionLabel({
  children,
  as: Tag = 'div',
  className,
}: {
  children: ReactNode
  as?: 'div' | 'span' | 'h3'
  className?: string
}) {
  return (
    <Tag className={cn('text-label font-normal uppercase tracking-[0.06em] text-muted', className)}>{children}</Tag>
  )
}
