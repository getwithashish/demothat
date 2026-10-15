import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Switch } from './switch'

export interface ToggleRowProps {
  label: ReactNode
  /** Optional 12px muted description rendered under the label. */
  description?: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
  className?: string
}

/** Toggle row (DESIGN_SPEC §6): label (+ optional description) left, switch right. */
export function ToggleRow({ label, description, checked, onCheckedChange, disabled, id, className }: ToggleRowProps) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-0.5', className)}>
      <div className="min-w-0">
        <label htmlFor={id} className={cn('block text-ui text-fg', disabled && 'text-muted')}>
          {label}
        </label>
        {description != null && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  )
}
