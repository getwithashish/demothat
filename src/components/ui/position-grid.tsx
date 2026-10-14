import { cn } from '../../lib/utils'

export type PositionGridValue =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'left-center'
  | 'center'
  | 'right-center'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

const CELLS: { value: PositionGridValue; className: string; label: string }[] = [
  { value: 'top-left', className: 'col-start-1 row-start-1', label: 'Top left' },
  { value: 'top-center', className: 'col-start-2 row-start-1', label: 'Top centre' },
  { value: 'top-right', className: 'col-start-3 row-start-1', label: 'Top right' },
  { value: 'left-center', className: 'col-start-1 row-start-2', label: 'Left centre' },
  { value: 'right-center', className: 'col-start-3 row-start-2', label: 'Right centre' },
  { value: 'bottom-left', className: 'col-start-1 row-start-3', label: 'Bottom left' },
  { value: 'bottom-center', className: 'col-start-2 row-start-3', label: 'Bottom centre' },
  { value: 'bottom-right', className: 'col-start-3 row-start-3', label: 'Bottom right' },
]

export interface PositionGridProps {
  value: PositionGridValue
  onChange: (value: PositionGridValue) => void
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

/**
 * Position grid (DESIGN_SPEC §6): 3x3 inside a ctl box, 84px tall, 7px radius,
 * 10px dots with a 1.5px muted ring. Selected = accent fill.
 *
 * The centre cell is intentionally inert (no webcam position maps to it).
 */
export function PositionGrid({
  value,
  onChange,
  disabled = false,
  className,
  'aria-label': ariaLabel = 'Position',
}: PositionGridProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'grid h-[84px] w-full grid-cols-3 grid-rows-3 rounded-seg bg-ctl p-2',
        disabled && 'opacity-45',
        className,
      )}
    >
      {CELLS.map((cell) => {
        const active = cell.value === value
        return (
          <button
            key={cell.value}
            type="button"
            aria-label={cell.label}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(cell.value)}
            className={cn(
              'flex items-center justify-center rounded-[5px] transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              'hover:bg-ctl-hover disabled:cursor-not-allowed disabled:hover:bg-transparent',
              cell.className,
            )}
          >
            <span
              className={cn(
                'h-2.5 w-2.5 rounded-full',
                active ? 'bg-accent' : 'bg-transparent ring-[1.5px] ring-muted',
              )}
            />
          </button>
        )
      })}
    </div>
  )
}
