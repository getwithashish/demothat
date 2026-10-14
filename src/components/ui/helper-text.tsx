import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/** 12px muted helper text, 8px top margin (DESIGN_SPEC §6). */
export function HelperText({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('mt-2 text-sm leading-normal text-muted', className)}>{children}</p>
}
