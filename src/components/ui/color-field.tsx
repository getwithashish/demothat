import { useEffect, useId, useState } from 'react'
import { cn } from '../../lib/utils'

export interface ColorFieldProps {
  /** Current colour, in any format the native input accepts (e.g. #RRGGBB). */
  value: string
  onChange: (value: string) => void
  label?: string
  disabled?: boolean
  className?: string
  id?: string
}

/**
 * Colour field (DESIGN_SPEC §6): 22px square swatch + mono hex.
 *
 * Keeps the previous ColorPicker contract (swatch and text field stay in sync,
 * text commits on blur/Enter) but renders the spec's compact layout.
 */
export function ColorField({ value, onChange, label, disabled = false, className, id }: ColorFieldProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const [localValue, setLocalValue] = useState(value)

  useEffect(() => {
    setLocalValue((current) => (value.toLowerCase() === current.toLowerCase() ? current : value))
  }, [value])

  const commit = () => {
    if (localValue.toLowerCase() !== value.toLowerCase()) onChange(localValue)
  }

  return (
    <div className={cn('w-full', className)}>
      {label != null && (
        <label htmlFor={fieldId} className={cn('mb-1.5 block text-sm', disabled ? 'text-muted' : 'text-muted')}>
          {label}
        </label>
      )}
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'relative h-[22px] w-[22px] shrink-0 overflow-hidden rounded-[4px] border border-line',
            disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
          )}
        >
          <span className="block h-full w-full" style={{ backgroundColor: value }} />
          <input
            id={fieldId}
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            aria-label={label ? `${label} swatch` : 'Colour swatch'}
            className={cn('absolute inset-0 h-full w-full opacity-0', !disabled && 'cursor-pointer')}
          />
        </div>
        <input
          type="text"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit()
              e.currentTarget.blur()
            }
          }}
          disabled={disabled}
          spellCheck={false}
          placeholder="#RRGGBB"
          aria-label={label ? `${label} hex` : 'Colour hex value'}
          className={cn(
            'h-[22px] min-w-0 flex-1 rounded-[4px] border border-line bg-ctl px-1.5',
            'font-mono text-sm text-fg uppercase placeholder:text-muted',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            'disabled:cursor-not-allowed disabled:opacity-45',
          )}
        />
      </div>
    </div>
  )
}
