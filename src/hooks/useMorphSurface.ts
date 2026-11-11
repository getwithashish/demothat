import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { morphOpen, morphClose } from '../lib/morph-surface'

export interface UseMorphSurfaceOptions {
  isOpen: boolean
  triggerSelector?: string
  targetRadius?: number
  duration?: number
  onClosed?: () => void
}

export function useMorphSurface({
  isOpen,
  triggerSelector,
  targetRadius = 14,
  duration = 640,
  onClosed,
}: UseMorphSurfaceOptions) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [isRendered, setIsRendered] = useState(isOpen)
  const isClosingRef = useRef(false)
  const hasClosedRef = useRef(false)
  const hasAnimatedOpenRef = useRef(false)

  // When isOpen becomes true from outside, immediately mark as rendered so DOM mounts
  if (isOpen && !isRendered && !isClosingRef.current) {
    setIsRendered(true)
    hasClosedRef.current = false
  }

  // When surfaceRef is mounted into DOM, run morphOpen before browser paints!
  useLayoutEffect(() => {
    if (isOpen && isRendered && surfaceRef.current && !hasAnimatedOpenRef.current && !isClosingRef.current) {
      hasAnimatedOpenRef.current = true
      hasClosedRef.current = false
      const trigger = triggerSelector ? document.querySelector<HTMLElement>(triggerSelector) : null
      if (trigger && surfaceRef.current) {
        void morphOpen({
          surfaceEl: surfaceRef.current,
          triggerEl: trigger,
          targetRadius,
          duration,
        })
      }
    }
  }, [isOpen, isRendered, triggerSelector, targetRadius, duration])

  // If isOpen is set to false from parent without calling requestClose, perform closing flight
  useEffect(() => {
    if (!isOpen && isRendered && !isClosingRef.current && !hasClosedRef.current) {
      isClosingRef.current = true
      hasClosedRef.current = true
      hasAnimatedOpenRef.current = false
      const trigger = triggerSelector ? document.querySelector<HTMLElement>(triggerSelector) : null
      const surface = surfaceRef.current
      if (surface && trigger) {
        void morphClose({
          surfaceEl: surface,
          triggerEl: trigger,
          targetRadius,
          duration: Math.round(duration * 0.75),
          onComplete: () => {
            setIsRendered(false)
            isClosingRef.current = false
            onClosed?.()
          },
        })
      } else {
        if (surface) {
          surface.style.display = 'none'
          surface.style.opacity = '0'
        }
        setIsRendered(false)
        isClosingRef.current = false
        onClosed?.()
      }
    }
  }, [isOpen, isRendered, triggerSelector, targetRadius, duration, onClosed])

  const requestClose = useCallback(() => {
    if (isClosingRef.current || hasClosedRef.current) return
    isClosingRef.current = true
    hasClosedRef.current = true
    hasAnimatedOpenRef.current = false

    const trigger = triggerSelector ? document.querySelector<HTMLElement>(triggerSelector) : null
    const surface = surfaceRef.current
    if (surface && trigger) {
      void morphClose({
        surfaceEl: surface,
        triggerEl: trigger,
        targetRadius,
        duration: Math.round(duration * 0.75),
        onComplete: () => {
          setIsRendered(false)
          isClosingRef.current = false
          onClosed?.()
        },
      })
    } else {
      if (surface) {
        surface.style.display = 'none'
        surface.style.opacity = '0'
      }
      setIsRendered(false)
      isClosingRef.current = false
      onClosed?.()
    }
  }, [triggerSelector, targetRadius, duration, onClosed])

  // Listen for Escape key to close with return travel
  useEffect(() => {
    if (!isRendered) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        requestClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isRendered, requestClose])

  // Guaranteed unmount safety: always restore trigger element opacity and pointer-events
  // even if component is abruptly unmounted by parent state changes
  useEffect(() => {
    return () => {
      if (triggerSelector) {
        const trigger = document.querySelector<HTMLElement>(triggerSelector)
        if (trigger) {
          trigger.style.opacity = ''
          trigger.style.pointerEvents = ''
          trigger.style.visibility = ''
        }
      }
    }
  }, [triggerSelector])

  return {
    surfaceRef,
    isRendered,
    requestClose,
  }
}
