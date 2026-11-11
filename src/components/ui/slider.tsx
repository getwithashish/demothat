import React, { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '../../lib/utils'
import { roll } from '../../lib/roll'

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
 * Slider (DESIGN_SPEC §6 + Family Values Motion System):
 * - Direct subpixel tracking locked to pointer tip on drag and click.
 * - Rolling digit odometer animation on value changes.
 * - Zero CPU overhead at idle and during video/timeline playback.
 * - Tactile feedback: thumb scales up on hover and dragging with soft accent glow ring.
 * - Tabular monospace value readout with unclipped symbols (%, px, °, ×, s).
 * - Full accessibility: role="slider", aria-valuenow, keyboard navigation.
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
  const [isDragging, setIsDragging] = useState(false)

  const currentValue = value ?? internalValue
  const percentage = max === min ? 0 : Math.min(Math.max(((currentValue - min) / (max - min)) * 100, 0), 100)

  const sliderRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const rollRef = useRef<HTMLSpanElement>(null)
  const isDraggingRef = useRef(false)
  const lastReportedRef = useRef(currentValue)
  const cachedRectRef = useRef<DOMRect | null>(null)
  const dragPctRef = useRef<number | null>(null)
  const pendingChangeRef = useRef<number | null>(null)
  const rafIdRef = useRef<number | null>(null)

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const formatRef = useRef(formatValue)
  formatRef.current = formatValue

  const getFormatted = useCallback((v: number) => {
    return formatRef.current ? formatRef.current(v) : String(v)
  }, [])

  // Sync rolling digit odometer with currentValue
  useEffect(() => {
    if (rollRef.current) {
      roll(rollRef.current, getFormatted(currentValue))
    }
    lastReportedRef.current = currentValue
  }, [currentValue, getFormatted])

  // Sync DOM styles when not dragging
  useEffect(() => {
    if (!isDraggingRef.current) {
      if (fillRef.current) fillRef.current.style.width = `${percentage}%`
      if (thumbRef.current) thumbRef.current.style.left = `${percentage}%`
    }
  }, [percentage])

  const handlePointerStart = useCallback(
    (clientX: number) => {
      if (disabled || !sliderRef.current) return
      const rect = sliderRef.current.getBoundingClientRect()
      cachedRectRef.current = rect
      isDraggingRef.current = true
      setIsDragging(true)

      const updateFromPointer = (x: number) => {
        const r = cachedRectRef.current || sliderRef.current?.getBoundingClientRect()
        if (!r || r.width <= 0) return
        const ratio = Math.min(Math.max((x - r.left) / r.width, 0), 1)
        const pct = ratio * 100
        dragPctRef.current = pct

        // Subpixel continuous glide directly locked to pointer tip
        if (fillRef.current) fillRef.current.style.width = `${pct}%`
        if (thumbRef.current) thumbRef.current.style.left = `${pct}%`

        const raw = min + ratio * (max - min)
        const stepped = Math.round((raw - min) / step) * step + min
        const decimals = step.toString().split('.')[1]?.length ?? 0
        const rounded = Number(stepped.toFixed(decimals))

        if (lastReportedRef.current !== rounded) {
          lastReportedRef.current = rounded
          if (sliderRef.current) {
            sliderRef.current.setAttribute('aria-valuenow', String(rounded))
          }
          if (rollRef.current) {
            roll(rollRef.current, getFormatted(rounded))
          }

          // Schedule store update via animation frame with startTransition
          // to prevent canvas re-renders from stalling continuous pointer movement
          pendingChangeRef.current = rounded
          if (rafIdRef.current === null) {
            rafIdRef.current = requestAnimationFrame(() => {
              rafIdRef.current = null
              if (pendingChangeRef.current !== null) {
                const v = pendingChangeRef.current
                pendingChangeRef.current = null
                React.startTransition(() => {
                  onChangeRef.current?.(v)
                })
              }
            })
          }
        }
      }

      updateFromPointer(clientX)

      const handleMove = (ev: PointerEvent) => {
        if (!isDraggingRef.current) return
        updateFromPointer(ev.clientX)
      }

      const handleEnd = () => {
        isDraggingRef.current = false
        setIsDragging(false)
        cachedRectRef.current = null
        dragPctRef.current = null

        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleEnd)
        window.removeEventListener('pointercancel', handleEnd)

        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current)
          rafIdRef.current = null
        }
        if (pendingChangeRef.current !== null) {
          const v = pendingChangeRef.current
          pendingChangeRef.current = null
          onChangeRef.current?.(v)
        } else {
          onChangeRef.current?.(lastReportedRef.current)
        }

        setInternalValue(lastReportedRef.current)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleEnd)
      window.addEventListener('pointercancel', handleEnd)
    },
    [disabled, min, max, step, getFormatted],
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || e.button !== 0) return
      e.preventDefault()
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch (err) {
        void err
      }
      handlePointerStart(e.clientX)
    },
    [disabled, handlePointerStart],
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
      const clamped = Math.min(Math.max(next, min), max)
      const stepped = Math.round((clamped - min) / step) * step + min
      const decimals = step.toString().split('.')[1]?.length ?? 0
      const rounded = Number(stepped.toFixed(decimals))
      lastReportedRef.current = rounded
      setInternalValue(rounded)
      onChangeRef.current?.(rounded)
      if (rollRef.current) {
        roll(rollRef.current, getFormatted(rounded))
      }
    },
    [disabled, min, max, step, currentValue, getFormatted],
  )

  const displayString = getFormatted(currentValue)
  const displayPercentage = isDragging && dragPctRef.current !== null ? dragPctRef.current : percentage

  return (
    <div className={cn('w-full select-none', className)}>
      {(label || showValue) && (
        <div className="mb-1.5 flex items-center justify-between gap-3">
          {label ? <span className="text-ui text-fg">{label}</span> : <span aria-hidden="true" />}
          {showValue && (
            <div className="flex items-center justify-end shrink-0 min-w-[3.5rem] text-right">
              <span ref={rollRef} className="roll" aria-hidden="true" />
              <span className="sr-only">{displayString}</span>
            </div>
          )}
        </div>
      )}
      <div
        className={cn(
          'relative flex h-6 w-full items-center touch-none cursor-pointer',
          disabled && 'cursor-not-allowed opacity-45',
        )}
        onPointerDown={handlePointerDown}
      >
        <div
          ref={sliderRef}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={currentValue}
          aria-label={label}
          aria-disabled={disabled}
          className="relative h-1 w-full rounded-[2px] bg-ctl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onKeyDown={handleKeyDown}
        >
          <div
            ref={fillRef}
            className="absolute top-0 left-0 h-full rounded-[2px] bg-accent pointer-events-none"
            style={{ width: `${displayPercentage}%` }}
          />
          <div
            ref={thumbRef}
            className={cn(
              'absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg pointer-events-none',
              'transition-transform duration-150',
              'hover:scale-120',
              isDragging && 'scale-125 shadow-md ring-4 ring-accent/20 cursor-grabbing',
              disabled ? 'cursor-not-allowed' : 'cursor-grab',
            )}
            style={{ left: `${displayPercentage}%`, boxShadow: 'var(--sa-thumb-shadow)' }}
          />
        </div>
      </div>
    </div>
  )
}
