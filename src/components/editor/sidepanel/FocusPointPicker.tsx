// Focus-point picker for a fixed zoom region (DESIGN_SPEC §10).
// Flat Section + token surfaces; the pointer maths are unchanged.
import type React from 'react'
import { useRef, useState, useEffect, useCallback } from 'react'
import { useEditorStore } from '../../../store/editorStore'
import { Loader2 } from 'tabler-icons-react'
import { HelperText } from '../../ui/helper-text'
import { Section } from '../../ui/section'
import { ICON_SIZE, ICON_STROKE } from '../../ui/icons'

interface FocusPointPickerProps {
  regionId: string
  targetX: number
  targetY: number
  startTime: number
  onTargetChange: (coords: { x: number; y: number }) => void
}

export function FocusPointPicker({ regionId, targetX, targetY, startTime, onTargetChange }: FocusPointPickerProps) {
  void regionId
  const { videoPath } = useEditorStore.getState()
  const containerRef = useRef<HTMLDivElement>(null)
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isCancelled = false
    const fetchFrame = async () => {
      if (!videoPath) return

      setIsLoading(true)
      setThumbnailUrl(null)

      try {
        const dataUrl = await window.electronAPI.getVideoFrame({ videoPath, time: startTime })
        if (!isCancelled) {
          setThumbnailUrl(dataUrl)
        }
      } catch (error) {
        console.error('Failed to fetch video frame:', error)
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    fetchFrame()

    return () => {
      isCancelled = true
    }
  }, [startTime, videoPath])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current
      if (!container) return

      const updatePosition = (clientX: number, clientY: number) => {
        const rect = container.getBoundingClientRect()
        const x = clientX - rect.left
        const y = clientY - rect.top

        const clampedX = Math.max(0, Math.min(x, rect.width))
        const clampedY = Math.max(0, Math.min(y, rect.height))

        const normalizedX = clampedX / rect.width - 0.5
        const normalizedY = clampedY / rect.height - 0.5

        onTargetChange({ x: normalizedX, y: normalizedY })
      }

      updatePosition(e.clientX, e.clientY)

      const handleMouseMove = (moveEvent: MouseEvent) => {
        updatePosition(moveEvent.clientX, moveEvent.clientY)
      }

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [onTargetChange],
  )

  const reticleLeft = (targetX + 0.5) * 100
  const reticleTop = (targetY + 0.5) * 100

  return (
    <Section label="Focus point">
      <HelperText className="mt-0">Click and drag the circle to set the zoom point.</HelperText>
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        className="relative mt-3.5 aspect-video w-full cursor-crosshair overflow-hidden rounded-ctl border border-line bg-stage hover:border-muted"
      >
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-panel/70">
            <Loader2 size={ICON_SIZE} strokeWidth={ICON_STROKE} className="animate-spin text-muted" />
          </div>
        )}
        {thumbnailUrl && (
          <img
            src={thumbnailUrl || '/placeholder.svg'}
            className="pointer-events-none h-full w-full object-contain"
            alt="Video frame preview"
          />
        )}
        <div
          className="pointer-events-none absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-accent bg-accent/20"
          style={{
            left: `${reticleLeft}%`,
            top: `${reticleTop}%`,
          }}
        >
          <div className="h-2 w-2 rounded-full bg-accent" />
        </div>
      </div>
    </Section>
  )
}
