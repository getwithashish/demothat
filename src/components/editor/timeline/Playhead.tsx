import React, { useEffect, useRef, useMemo } from 'react'
import { useTheme } from '../../../hooks/useTheme'

interface PlayheadProps {
  height: number // canvas height (track area)
  isDragging: boolean // playhead drag state
  onMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void
}

/** Reads the live accent token so the canvas follows the theme (it cannot use CSS classes). */
const readAccent = () => {
  if (typeof window === 'undefined') return 'rgb(47, 95, 208)'
  const value = getComputedStyle(document.documentElement).getPropertyValue('--sa-accent').trim()
  return value || 'rgb(47, 95, 208)'
}

/**
 * Playhead (DESIGN_SPEC §8): 2px accent line, full height, with a small accent caret
 * on the ruler. Drawn on a canvas, so the accent is resolved from the token at draw
 * time and redrawn when the theme flips.
 */
export const Playhead: React.FC<PlayheadProps> = React.memo(({ height, isDragging, onMouseDown }: PlayheadProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { theme } = useTheme()

  // Memoize playhead geometry
  const triangleSize = useMemo(() => ({ base: 10, height: 14 }), [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const accent = readAccent()

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // --- Draw line (2px accent, full height) ---
    ctx.beginPath()
    ctx.moveTo(canvas.width / 2, 0)
    ctx.lineTo(canvas.width / 2, height)
    ctx.strokeStyle = accent
    ctx.lineWidth = 2
    ctx.stroke()

    // --- Draw caret at the top, pointing down ---
    const triW = triangleSize.base
    const triH = triangleSize.height
    const x = canvas.width / 2
    const y = 0

    ctx.beginPath()
    ctx.moveTo(x, y + triH) // Bottom point
    ctx.lineTo(x - triW, y) // Top left
    ctx.lineTo(x + triW, y) // Top right
    ctx.closePath()
    ctx.fillStyle = accent
    ctx.fill()
  }, [height, triangleSize, theme])

  return (
    <div
      style={{
        position: 'relative',
        width: '20px',
        height: '100%',
        marginLeft: '-10px',
        pointerEvents: 'none',
      }}
    >
      {/* Clickable caret area */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: triangleSize.base * 2,
          height: triangleSize.height,
          cursor: isDragging ? 'grabbing' : 'grab',
          pointerEvents: 'auto',
          zIndex: 10,
        }}
        onMouseDown={onMouseDown}
      />
      <canvas
        ref={canvasRef}
        width={20}
        height={height}
        style={{
          display: 'block',
          pointerEvents: 'none',
          position: 'relative',
          zIndex: 1,
        }}
      />
    </div>
  )
})

Playhead.displayName = 'Playhead'
