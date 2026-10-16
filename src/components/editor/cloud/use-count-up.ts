// Counts a displayed number up to its new value (design motion table §9).
//
// Used by the credit capsule after a purchase: the balance animates over a
// second with ease-out cubic. The first value is shown as-is (no animation from
// zero on mount), and `prefers-reduced-motion` jumps straight to the value.

import { useEffect, useRef, useState } from 'react'

const DEFAULT_DURATION_MS = 1000
/** ease-out cubic, matching the single easing used across the cloud UI. */
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

export function useCountUp(value: number, durationMs = DEFAULT_DURATION_MS): number {
  const [displayed, setDisplayed] = useState(value)
  const fromRef = useRef(value)

  useEffect(() => {
    const from = fromRef.current
    if (from === value) return
    if (durationMs <= 0 || prefersReducedMotion()) {
      fromRef.current = value
      setDisplayed(value)
      return
    }

    let frame = 0
    const startedAt = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs)
      const next = from + (value - from) * easeOutCubic(progress)
      setDisplayed(progress >= 1 ? value : next)
      if (progress < 1) frame = requestAnimationFrame(step)
      else fromRef.current = value
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value, durationMs])

  return displayed
}
