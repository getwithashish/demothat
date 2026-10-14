// Visual preview component for frame style presets (DESIGN_SPEC §10).
import { useMemo, useRef } from 'react'
import { WALLPAPERS } from '../../lib/constants'
import type { FrameStyles, AspectRatio, WebcamStyles, WebcamPosition } from '../../types'
import { Video } from 'tabler-icons-react'
import { cn } from '../../lib/utils'

interface PresetPreviewProps {
  styles: FrameStyles
  aspectRatio: AspectRatio
  isWebcamVisible?: boolean
  webcamPosition?: WebcamPosition
  webcamStyles?: WebcamStyles
}

const generateBackgroundStyle = (backgroundState: FrameStyles['background']) => {
  switch (backgroundState.type) {
    case 'color':
      return { background: backgroundState.color || '#ffffff' }
    case 'gradient': {
      const start = backgroundState.gradientStart || '#000000'
      const end = backgroundState.gradientEnd || '#ffffff'
      const direction = backgroundState.gradientDirection || 'to right'
      return { background: `linear-gradient(${direction}, ${start}, ${end})` }
    }
    case 'image':
    case 'wallpaper': {
      const imageUrl = backgroundState.imageUrl?.startsWith('blob:')
        ? backgroundState.imageUrl
        : `media://${backgroundState.imageUrl || WALLPAPERS[0].imageUrl}`
      return {
        backgroundImage: `url("${imageUrl}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    }
    default:
      return { background: '#111' }
  }
}

export function PresetPreview({
  styles,
  aspectRatio,
  isWebcamVisible,
  webcamPosition,
  webcamStyles,
}: PresetPreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null)

  const cssAspectRatio = useMemo(() => aspectRatio.replace(':', ' / '), [aspectRatio])

  const frameStyle = useMemo(() => {
    const shadowString =
      styles.shadowBlur > 0
        ? `${styles.shadowOffsetX}px ${styles.shadowOffsetY}px ${styles.shadowBlur}px ${styles.shadowColor}`
        : 'none'

    return {
      width: '100%',
      height: '100%',
      borderRadius: `${styles.borderRadius}px`,
      boxShadow: shadowString,
      border: `${styles.borderWidth}px solid ${styles.borderColor}`,
      boxSizing: 'border-box' as const, // Ensure border is part of the element's size
    }
  }, [styles])

  const fakeWebcamStyle = useMemo(() => {
    if (!webcamStyles) return {}

    const cssStyles: React.CSSProperties = {
      width: `${webcamStyles.size}%`,
      filter: `drop-shadow(${webcamStyles.shadowOffsetX}px ${webcamStyles.shadowOffsetY}px ${webcamStyles.shadowBlur}px ${webcamStyles.shadowColor})`,
    }

    if (webcamStyles.isFlipped) {
      cssStyles.transform = 'scaleX(-1)'
    }

    switch (webcamStyles.shape) {
      case 'rectangle':
        cssStyles.aspectRatio = '16 / 9'
        cssStyles.borderRadius = `${webcamStyles.borderRadius}%`
        break
      case 'square':
        cssStyles.aspectRatio = '1 / 1'
        cssStyles.borderRadius = `${webcamStyles.borderRadius}%`
        break
      case 'circle':
        cssStyles.aspectRatio = '1 / 1'
        cssStyles.borderRadius = '50%'
        break
    }
    return cssStyles
  }, [webcamStyles])

  const fakeWebcamClasses = useMemo(() => {
    if (!webcamPosition) return ''
    return cn('absolute z-20 overflow-hidden', {
      'top-4 left-4': webcamPosition.pos === 'top-left',
      'top-4 left-1/2 -translate-x-1/2': webcamPosition.pos === 'top-center',
      'top-4 right-4': webcamPosition.pos === 'top-right',
      'left-4 top-1/2 -translate-y-1/2': webcamPosition.pos === 'left-center',
      'right-4 top-1/2 -translate-y-1/2': webcamPosition.pos === 'right-center',
      'bottom-4 left-4': webcamPosition.pos === 'bottom-left',
      'bottom-4 left-1/2 -translate-x-1/2': webcamPosition.pos === 'bottom-center',
      'bottom-4 right-4': webcamPosition.pos === 'bottom-right',
    })
  }, [webcamPosition])

  const backgroundStyle = useMemo(() => generateBackgroundStyle(styles.background), [styles.background])

  return (
    <div
      ref={previewRef}
      className="flex h-full max-h-full max-w-full items-center justify-center rounded-pv"
      style={{ ...backgroundStyle, aspectRatio: cssAspectRatio }}
    >
      <div className="h-full w-full" style={{ padding: `${styles.padding}%`, position: 'relative' }}>
        <div className="h-full w-full" style={frameStyle}>
          <div
            className="h-full w-full bg-ctl"
            style={{
              borderRadius: `${Math.max(0, styles.borderRadius - styles.borderWidth)}px`,
            }}
          >
            <div className="space-y-2 p-4 opacity-60">
              <div className="h-2.5 w-1/2 rounded-full bg-muted/40"></div>
              <div className="h-2 w-3/4 rounded-full bg-muted/30"></div>
              <div className="h-2 w-2/3 rounded-full bg-muted/25"></div>
            </div>
          </div>
        </div>

        {isWebcamVisible && webcamStyles && webcamPosition && (
          <div className={fakeWebcamClasses} style={fakeWebcamStyle}>
            <div className="flex h-full w-full items-center justify-center bg-ctl">
              <Video className="h-1/2 w-1/2 text-muted" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
