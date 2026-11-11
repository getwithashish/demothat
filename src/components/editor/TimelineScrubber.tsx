import React, { useRef, useState, useCallback, useEffect } from 'react'
import { cn } from '../../lib/utils'

export interface TimelineScrubberProps {
  min?: number
  max?: number
  value?: number
  onChange?: (value: number) => void
  disabled?: boolean
  className?: string
}

/**
 * TimelineScrubber:
 * Dedicated, ultra-responsive video playhead scrubber for Preview.
 * - Decoupled from sidebar sliders: zero roll DOM churn, zero physics lag.
 * - Instant 1:1 subpixel pointer tracking during drag.
 * - Smooth playback tracking when video plays.
 * - Accessible slider semantics (role, keyboard, aria).
 */
export const TimelineScrubber: React.FC<TimelineScrubberProps> = React.memo(
  ({ min = 0, max = 0, value = 0, onChange, disabled = false, className = '' }) => {
    const [isDragging, setIsDragging] = useState(false)
    const isDraggingRef = useRef(false)
    const trackRef = useRef<HTMLDivElement>(null)
    const fillRef = useRef<HTMLDivElement>(null)
    const thumbRef = useRef<HTMLDivElement>(null)
    const cachedRectRef = useRef<DOMRect | null>(null)
    const dragPctRef = useRef<number | null>(null)

    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange

    const range = Math.max(max - min, 0)
    const clampedValue = Math.min(Math.max(value, min), max)
    const playbackPct = range > 0 ? ((clampedValue - min) / range) * 100 : 0

    // Visual percentage: use immediate drag percentage during interaction,
    // otherwise sync with video playback percentage.
    const displayPct = isDragging && dragPctRef.current !== null ? dragPctRef.current : playbackPct

    // Update DOM styles directly when not dragging (playback ticks)
    useEffect(() => {
      if (!isDraggingRef.current) {
        if (fillRef.current) fillRef.current.style.width = `${playbackPct}%`
        if (thumbRef.current) thumbRef.current.style.left = `${playbackPct}%`
      }
    }, [playbackPct])

    const updateFromPointer = useCallback(
      (clientX: number) => {
        const rect = cachedRectRef.current || trackRef.current?.getBoundingClientRect()
        if (!rect || rect.width <= 0) return

        const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
        const pct = ratio * 100
        dragPctRef.current = pct

        if (fillRef.current) fillRef.current.style.width = `${pct}%`
        if (thumbRef.current) thumbRef.current.style.left = `${pct}%`

        const newTime = min + ratio * range
        onChangeRef.current?.(newTime)
      },
      [min, range],
    )

    const handlePointerDown = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (disabled || e.button !== 0 || range <= 0) return
        e.preventDefault()

        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // ignore pointer capture errors if any
        }

        const rect = trackRef.current?.getBoundingClientRect() ?? null
        cachedRectRef.current = rect
        isDraggingRef.current = true
        setIsDragging(true)

        updateFromPointer(e.clientX)

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
        }

        window.addEventListener('pointermove', handleMove)
        window.addEventListener('pointerup', handleEnd)
        window.addEventListener('pointercancel', handleEnd)
      },
      [disabled, range, updateFromPointer],
    )

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (disabled || range <= 0) return
        let next: number | undefined
        const frameStep = 1 / 30 // ~1 frame step
        const largeStep = 1 // 1 second step

        switch (e.key) {
          case 'ArrowLeft':
            next = clampedValue - frameStep
            break
          case 'ArrowRight':
            next = clampedValue + frameStep
            break
          case 'PageDown':
            next = clampedValue + largeStep
            break
          case 'PageUp':
            next = clampedValue - largeStep
            break
          case 'Home':
            next = min
            break
          case 'End':
            next = max
            break
        }

        if (next !== undefined) {
          e.preventDefault()
          const clamped = Math.min(Math.max(next, min), max)
          onChangeRef.current?.(clamped)
        }
      },
      [disabled, range, clampedValue, min, max],
    )

    return (
      <div
        className={cn(
          'relative flex h-6 select-none items-center touch-none',
          disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
          className,
        )}
        onPointerDown={handlePointerDown}
      >
        <div
          ref={trackRef}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label="Video scrubber"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={clampedValue}
          aria-disabled={disabled}
          className="relative h-1 w-full rounded-[2px] bg-ctl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onKeyDown={handleKeyDown}
        >
          <div
            ref={fillRef}
            className="absolute top-0 left-0 h-full rounded-[2px] bg-accent pointer-events-none"
            style={{ width: `${displayPct}%` }}
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
            style={{
              left: `${displayPct}%`,
              boxShadow: 'var(--sa-thumb-shadow)',
            }}
          />
        </div>
      </div>
    )
  },
)

TimelineScrubber.displayName = 'TimelineScrubber'
