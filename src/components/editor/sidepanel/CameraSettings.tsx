// Settings panel for the webcam overlay (visibility, style, placement, drop shadow).
// Rebuilt flat on the shared primitives: Section / SegmentedControl / Slider /
// ToggleRow / PositionGrid / ColorField. No Collapsible, no icon tiles.
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useEditorStore } from '../../../store/editorStore'
import { PanelHeader } from '../PanelHeader'
import { DeviceComputerCameraOff, Trash, Upload, Video } from 'tabler-icons-react'
import { Button } from '../../ui/button'
import { ColorField } from '../../ui/color-field'
import { HelperText } from '../../ui/helper-text'
import { PositionGrid, type PositionGridValue } from '../../ui/position-grid'
import { Section } from '../../ui/section'
import { SegmentedControl } from '../../ui/segmented-control'
import { Slider } from '../../ui/slider'
import { ToggleRow } from '../../ui/toggle-row'
import { ICON_SIZE, ICON_STROKE } from '../../ui/icons'
import { rgbaToHexAlpha, hexToRgb, formatTime } from '../../../lib/utils'
import { DEFAULTS } from '../../../lib/constants'
import { useShallow } from 'zustand/react/shallow'
import type { WebcamPosition, WebcamShape } from '../../../types'

function ResetButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} aria-label={`Reset ${label}`}>
      Reset
    </Button>
  )
}

const DisabledPanelPlaceholder = ({
  icon,
  title,
  message,
}: {
  icon: React.ReactNode
  title: string
  message: string
}) => (
  <div className="flex flex-col items-center gap-3 px-[18px] py-10 text-center">
    <div className="text-muted">{icon}</div>
    <div>
      <h3 className="text-ui font-medium text-fg">{title}</h3>
      <p className="mx-auto mt-1 max-w-xs text-sm text-muted">{message}</p>
    </div>
  </div>
)

export function CameraSettings() {
  const [isImportingVideos, setIsImportingVideos] = useState(false)
  const {
    webcamVideoUrl,
    isWebcamVisible,
    webcamPosition,
    webcamStyles,
    setWebcamVisibility,
    setWebcamPosition,
    updateWebcamStyle,
    currentTime,
    duration,
    videoClips,
    addVideoClip,
    updateVideoClip,
    deleteVideoClip,
  } = useEditorStore(
    useShallow((state) => ({
      webcamVideoUrl: state.webcamVideoUrl,
      isWebcamVisible: state.isWebcamVisible,
      webcamPosition: state.webcamPosition,
      webcamStyles: state.webcamStyles,
      setWebcamVisibility: state.setWebcamVisibility,
      setWebcamPosition: state.setWebcamPosition,
      updateWebcamStyle: state.updateWebcamStyle,
      currentTime: state.currentTime,
      duration: state.duration,
      videoClips: state.videoClips,
      addVideoClip: state.addVideoClip,
      updateVideoClip: state.updateVideoClip,
      deleteVideoClip: state.deleteVideoClip,
    })),
  )

  const importVideos = async () => {
    setIsImportingVideos(true)
    try {
      const result = await window.electronAPI.openVideoFiles()
      if (result.canceled || !result.files?.length) return
      for (const file of result.files) {
        const video = document.createElement('video')
        video.preload = 'metadata'
        video.src = `media://${encodeURI(file.filePath).replace(/#/g, '%23').replace(/\?/g, '%3F')}`
        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve()
          video.onerror = () => reject(new Error(`Could not read video metadata for ${file.fileName}`))
          video.load()
        })
        const sourceDuration = Number.isFinite(video.duration) ? video.duration : 0
        if (sourceDuration <= 0) continue
        const startTime = Math.max(0, Math.min(currentTime, Math.max(0, duration - 0.1)))
        addVideoClip({ name: file.fileName, filePath: file.filePath, startTime, duration: Math.min(sourceDuration, Math.max(0.1, duration - startTime)), sourceDuration })
      }
    } catch (error) {
      window.electronAPI.showMessageBox({ type: 'error', title: 'Video import failed', message: error instanceof Error ? error.message : 'Could not import video clips.' })
    } finally { setIsImportingVideos(false) }
  }

  const { hex: shadowHex, alpha: shadowAlpha } = useMemo(
    () => rgbaToHexAlpha(webcamStyles.shadowColor),
    [webcamStyles.shadowColor],
  )

  const handleShadowColorChange = (newHex: string) => {
    const rgb = hexToRgb(newHex)
    if (rgb) {
      const newRgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${shadowAlpha})`
      updateWebcamStyle({ shadowColor: newRgbaColor })
    }
  }

  const handleShadowOpacityChange = (newAlpha: number) => {
    const rgb = hexToRgb(shadowHex)
    if (rgb) {
      const newRgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${newAlpha})`
      updateWebcamStyle({ shadowColor: newRgbaColor })
    }
  }

  const handleResetStyle = () => {
    updateWebcamStyle({
      shape: DEFAULTS.CAMERA.STYLE.SHAPE.defaultValue,
      borderRadius: DEFAULTS.CAMERA.STYLE.RADIUS.defaultValue,
      isFlipped: DEFAULTS.CAMERA.STYLE.FLIP.defaultValue,
    })
  }

  const handleResetPlacement = () => {
    updateWebcamStyle({
      size: DEFAULTS.CAMERA.PLACEMENT.SIZE.defaultValue,
      scaleOnZoom: DEFAULTS.CAMERA.STYLE.SCALE_ON_ZOOM.defaultValue,
      smartPosition: DEFAULTS.CAMERA.SMART_POSITION.ENABLED.defaultValue,
    })
    setWebcamPosition({ pos: DEFAULTS.CAMERA.PLACEMENT.POSITION.defaultValue as WebcamPosition['pos'] })
  }

  const handleResetEffects = () => {
    updateWebcamStyle({
      shadowBlur: DEFAULTS.CAMERA.EFFECTS.BLUR.defaultValue,
      shadowOffsetX: DEFAULTS.CAMERA.EFFECTS.OFFSET_X.defaultValue,
      shadowOffsetY: DEFAULTS.CAMERA.EFFECTS.OFFSET_Y.defaultValue,
      shadowColor: DEFAULTS.CAMERA.EFFECTS.DEFAULT_COLOR_RGBA,
    })
  }

  const isCircle = webcamStyles.shape === 'circle'

  // The store has no drop-shadow on/off flag, so the toggle is derived from the blur
  // and remembers the last non-zero value locally (presentation only).
  const shadowOn = webcamStyles.shadowBlur > 0
  const [lastShadowBlur, setLastShadowBlur] = useState(
    webcamStyles.shadowBlur || DEFAULTS.CAMERA.EFFECTS.BLUR.defaultValue,
  )
  useEffect(() => {
    if (webcamStyles.shadowBlur > 0) setLastShadowBlur(webcamStyles.shadowBlur)
  }, [webcamStyles.shadowBlur])
  const handleShadowToggle = (on: boolean) => {
    updateWebcamStyle({ shadowBlur: on ? lastShadowBlur || DEFAULTS.CAMERA.EFFECTS.BLUR.defaultValue : 0 })
  }

  // Labels follow the reference (Rectangle / Rounded / Circle). The stored values are
  // unchanged: 'square' is the app's rounded-corner shape.
  const SHAPE_OPTIONS: { value: WebcamShape; label: string }[] = [
    { value: 'rectangle', label: 'Rectangle' },
    { value: 'square', label: 'Rounded' },
    { value: 'circle', label: 'Circle' },
  ]

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Camera" subtitle="Webcam overlay" />

      <div className="min-h-0 flex-1 overflow-y-auto stable-scrollbar">
        <Section first label="Video clips">
          <HelperText className="mt-0">
            Clips start at the playhead and move independently on the video track.
          </HelperText>
          <Button className="mt-3 w-full" onClick={importVideos} disabled={isImportingVideos}>
            <Upload size={ICON_SIZE} strokeWidth={ICON_STROKE} />
            {isImportingVideos ? 'Importing videos…' : 'Import video files'}
          </Button>

          {videoClips.length > 0 && (
            <div className="mt-3 divide-y divide-line border-t border-line">
              {videoClips.map((clip) => (
                <div key={clip.id} className="space-y-2 py-3">
                  <div className="flex items-center gap-2">
                    <Video size={ICON_SIZE} strokeWidth={ICON_STROKE} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate text-ui text-fg" title={clip.name}>{clip.name}</span>
                    <Button
                      variant="danger"
                      size="icon"
                      aria-label={`Delete ${clip.name}`}
                      onClick={() => deleteVideoClip(clip.id)}
                    >
                      <Trash size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-sm text-muted">
                      Timeline start (s)
                      <input
                        type="number"
                        min="0"
                        max={Math.max(0, duration - 0.1)}
                        step="0.1"
                        value={Number(clip.startTime.toFixed(2))}
                        onChange={(e) => updateVideoClip(clip.id, { startTime: Math.max(0, Math.min(duration - clip.duration, Number(e.target.value) || 0)) })}
                        className="mt-1 w-full rounded-ctl border border-line bg-ctl px-2 py-1.5 font-mono text-sm text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      />
                    </label>
                    <label className="text-sm text-muted">
                      Duration (s)
                      <input
                        type="number"
                        min="0.1"
                        max={Math.max(0.1, duration - clip.startTime)}
                        step="0.1"
                        value={Number(clip.duration.toFixed(2))}
                        onChange={(e) => updateVideoClip(clip.id, { duration: Math.max(0.1, Math.min(duration - clip.startTime, Number(e.target.value) || 0.1)) })}
                        className="mt-1 w-full rounded-ctl border border-line bg-ctl px-2 py-1.5 font-mono text-sm text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      />
                    </label>
                  </div>
                  <p className="text-sm text-muted">
                    {formatTime(clip.startTime)} – {formatTime(clip.startTime + clip.duration)} · source {formatTime(clip.sourceDuration)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Section>

        {!webcamVideoUrl ? (
          <DisabledPanelPlaceholder
            icon={<DeviceComputerCameraOff size={32} strokeWidth={1.6} />}
            title="No webcam recorded"
            message="These settings are unavailable because a webcam was not included in this recording."
          />
        ) : (
          <>
            <Section label="Visible">
              <ToggleRow label="Visible" checked={isWebcamVisible} onCheckedChange={setWebcamVisibility} />
            </Section>

            <Section label="Style" labelRight={<ResetButton onClick={handleResetStyle} label="camera style" />}>
              <div className="space-y-3.5">
                <SegmentedControl
                  aria-label="Shape"
                  options={SHAPE_OPTIONS}
                  value={webcamStyles.shape}
                  onChange={(shape) => updateWebcamStyle({ shape })}
                />
                <Slider
                  label="Corner radius"
                  min={DEFAULTS.CAMERA.STYLE.RADIUS.min}
                  max={DEFAULTS.CAMERA.STYLE.RADIUS.max}
                  step={DEFAULTS.CAMERA.STYLE.RADIUS.step}
                  value={isCircle ? 50 : webcamStyles.borderRadius}
                  onChange={(value) => updateWebcamStyle({ borderRadius: value })}
                  disabled={isCircle}
                  formatValue={(value) => (isCircle ? '—' : `${value}%`)}
                />
                <ToggleRow
                  label="Flip horizontal"
                  checked={webcamStyles.isFlipped}
                  onCheckedChange={(isChecked) => updateWebcamStyle({ isFlipped: isChecked })}
                />
              </div>
            </Section>

            <Section label="Placement" labelRight={<ResetButton onClick={handleResetPlacement} label="camera placement" />}>
              <div className="space-y-3.5">
                <Slider
                  label="Size"
                  min={DEFAULTS.CAMERA.PLACEMENT.SIZE.min}
                  max={DEFAULTS.CAMERA.PLACEMENT.SIZE.max}
                  step={DEFAULTS.CAMERA.PLACEMENT.SIZE.step}
                  value={webcamStyles.size}
                  onChange={(value) => updateWebcamStyle({ size: value })}
                  formatValue={(value) => `${value}%`}
                />
                <ToggleRow
                  label="Scale on zoom"
                  checked={webcamStyles.scaleOnZoom}
                  onCheckedChange={(isChecked) => updateWebcamStyle({ scaleOnZoom: isChecked })}
                />
                <ToggleRow
                  label="Smart position"
                  description="Avoid cursor and key content"
                  checked={webcamStyles.smartPosition}
                  onCheckedChange={(isChecked) => updateWebcamStyle({ smartPosition: isChecked })}
                />
                <div className="space-y-2 pt-1">
                  <span className="text-label uppercase tracking-[0.06em] text-muted">Position</span>
                  <PositionGrid
                    aria-label="Camera position"
                    value={webcamPosition.pos as PositionGridValue}
                    onChange={(pos) => setWebcamPosition({ pos: pos as WebcamPosition['pos'] })}
                  />
                </div>
              </div>
            </Section>

            <Section label="Effects" labelRight={<ResetButton onClick={handleResetEffects} label="camera effects" />}>
              <div className="space-y-3.5">
                <ToggleRow
                  label="Drop shadow"
                  description="Adds depth behind the camera"
                  checked={shadowOn}
                  onCheckedChange={handleShadowToggle}
                />
                {shadowOn && (
                  <>
                    <Slider
                      label="Blur"
                      min={DEFAULTS.CAMERA.EFFECTS.BLUR.min}
                      max={DEFAULTS.CAMERA.EFFECTS.BLUR.max}
                      step={DEFAULTS.CAMERA.EFFECTS.BLUR.step}
                      value={webcamStyles.shadowBlur}
                      onChange={(v) => updateWebcamStyle({ shadowBlur: v })}
                      formatValue={(v) => `${v} px`}
                    />
                    <Slider
                      label="Offset X"
                      min={DEFAULTS.CAMERA.EFFECTS.OFFSET_X.min}
                      max={DEFAULTS.CAMERA.EFFECTS.OFFSET_X.max}
                      step={DEFAULTS.CAMERA.EFFECTS.OFFSET_X.step}
                      value={webcamStyles.shadowOffsetX}
                      onChange={(v) => updateWebcamStyle({ shadowOffsetX: v })}
                      formatValue={(v) => `${v} px`}
                    />
                    <Slider
                      label="Offset Y"
                      min={DEFAULTS.CAMERA.EFFECTS.OFFSET_Y.min}
                      max={DEFAULTS.CAMERA.EFFECTS.OFFSET_Y.max}
                      step={DEFAULTS.CAMERA.EFFECTS.OFFSET_Y.step}
                      value={webcamStyles.shadowOffsetY}
                      onChange={(v) => updateWebcamStyle({ shadowOffsetY: v })}
                      formatValue={(v) => `${v} px`}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <div className="pt-0.5">
                        <ColorField label="Color" value={shadowHex} onChange={handleShadowColorChange} />
                      </div>
                      <Slider
                        label="Opacity"
                        min={DEFAULTS.CAMERA.EFFECTS.OPACITY.min}
                        max={DEFAULTS.CAMERA.EFFECTS.OPACITY.max}
                        step={DEFAULTS.CAMERA.EFFECTS.OPACITY.step}
                        value={shadowAlpha}
                        onChange={handleShadowOpacityChange}
                        formatValue={(v) => `${Math.round(v * 100)}%`}
                      />
                    </div>
                  </>
                )}
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  )
}
