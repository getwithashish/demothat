import React, { useState, useRef, useCallback } from 'react'
import { cn } from '../../lib/utils'

export interface SliderProps {
  min?: number
  max?: number
  step?: number
  value?: number
  defaultValue?: number
  onChange?: (value: number) => void
  disabled?: boolean
  label?: string
  /** Formats the mono value readout. Defaults to the raw number. */
  formatValue?: (value: number) => string
  /**
   * Controls the mono value readout. Defaults to on when `label` is given (the
   * spec's label-left / value-right row) and off otherwise, so call sites that
   * render their own label keep their previous layout.
   */
  showValue?: boolean
  className?: string
}

/**
 * Slider (DESIGN_SPEC §6): label left, mono value right (12px), 4px ctl track with
 * an accent fill and a 14px text-coloured thumb.
 *
 * Pointer behaviour is unchanged from the previous implementation (drag + click to
 * seek). Keyboard support (arrows / Home / End) is additive.
 */
export const Slider: React.FC<SliderProps> = ({
  min = 0,
  max = 100,
  step = 1,
  value,
  defaultValue = 50,
  onChange,
  disabled = false,
  label,
  formatValue,
  showValue = label !== undefined,
  className = '',
}) => {
  const [internalValue, setInternalValue] = useState(value ?? defaultValue)
  const sliderRef = useRef<HTMLDivElement>(null)

  const currentValue = value ?? internalValue
  const percentage = max === min ? 0 : ((currentValue - min) / (max - min)) * 100

  const handleChange = useCallback(
    (newValue: number) => {
      const clampedValue = Math.min(Math.max(newValue, min), max)
      const steppedValue = Math.round(clampedValue / step) * step

      setInternalValue(steppedValue)
      onChange?.(steppedValue)
    },
    [min, max, step, onChange],
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return

      const updateValue = (clientX: number) => {
        if (!sliderRef.current) return

        const rect = sliderRef.current.getBoundingClientRect()
        const percentage = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
        const newValue = min + percentage * (max - min)
        handleChange(newValue)
      }

      updateValue(e.clientX)

      const handleMouseMove = (e: MouseEvent) => updateValue(e.clientX)
      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [disabled, min, max, handleChange],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return
      const page = (max - min) / 10
      const keys: Record<string, number> = {
        ArrowRight: currentValue + step,
        ArrowUp: currentValue + step,
        ArrowLeft: currentValue - step,
        ArrowDown: currentValue - step,
        PageUp: currentValue + page,
        PageDown: currentValue - page,
        Home: min,
        End: max,
      }
      const next = keys[e.key]
      if (next === undefined) return
      e.preventDefault()
      handleChange(next)
    },
    [disabled, min, max, step, currentValue, handleChange],
  )

  return (
    <div className={cn('w-full', className)}>
      {(label || showValue) && (
        <div className="mb-1.5 flex items-center justify-between gap-3">
          {label ? <span className="text-ui text-fg">{label}</span> : <span aria-hidden="true" />}
          {showValue && (
            <span className="font-mono text-sm tabular-nums text-muted">
              {formatValue ? formatValue(currentValue) : String(currentValue)}
            </span>
          )}
        </div>
      )}
      <div className="relative flex h-3.5 items-center">
        <div
          ref={sliderRef}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={currentValue}
          aria-label={label}
          aria-disabled={disabled}
          className={cn(
            'relative h-1 w-full rounded-[2px] bg-ctl',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
          )}
          onMouseDown={handleMouseDown}
          onKeyDown={handleKeyDown}
        >
          <div className="absolute top-0 left-0 h-full rounded-[2px] bg-accent" style={{ width: `${percentage}%` }} />
          <div
            className={cn(
              'absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg',
              disabled ? 'cursor-not-allowed' : 'cursor-pointer',
            )}
            style={{ left: `${percentage}%`, boxShadow: 'var(--sa-thumb-shadow)' }}
          />
        </div>
      </div>
    </div>
  )
}
