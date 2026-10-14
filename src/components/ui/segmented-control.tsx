import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface SegmentedOption<T extends string = string> {
  value: T
  label: ReactNode
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  className?: string
  'aria-label'?: string
}

/**
 * Segmented control (DESIGN_SPEC §6): ctl background, 2px padding, 7px radius.
 * Buttons are equal width and muted; the active one is panel background + text
 * colour + a 1px line ring. No accent fill.
 */
export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  size = 'md',
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn('flex rounded-seg bg-ctl p-0.5', className)}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex-1 rounded-[5px] text-center font-normal transition-colors',
              size === 'md' ? 'px-2 py-[5px] text-ui' : 'px-1.5 py-1 text-sm',
              active
                ? 'bg-panel text-fg shadow-[0_0_0_1px_var(--sa-line)]'
                : 'text-muted hover:text-fg',
              'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:text-muted',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
