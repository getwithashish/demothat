import React, { useRef, useState, useEffect, useCallback, useMemo, memo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useEditorStore, useAllRegions } from '../../store/editorStore'
import { ZoomRegionBlock } from './timeline/ZoomRegionBlock'
import { CutRegionBlock } from './timeline/CutRegionBlock'
import { SpeedRegionBlock } from './timeline/SpeedRegionBlock'
import { Playhead } from './timeline/Playhead'
import { cn } from '../../lib/utils'
import { Scissors } from 'tabler-icons-react'
import { formatTime, calculateRulerInterval } from '../../lib/utils'
import { useTimelineInteraction } from '../../hooks/useTimelineInteraction'
import { FlipScissorsIcon } from '../ui/icons'
import { Camera, Music, GripVertical, Search, Volume, VolumeOff } from 'tabler-icons-react'
import { AudioTimelinePreview } from './timeline/AudioTimelinePreview'
import { ICON_SIZE, ICON_STROKE } from '../ui/icons'
import { Slider } from '../ui/slider'
import { buildTrackRows } from './timeline/track-rows'
import { COMPOSITION_LAYOUTS } from '../../lib/constants'

// Timeline geometry (DESIGN_SPEC §8): 34px rows, 26px clips, 22px ruler, 108px track header.
const ROW_HEIGHT = 34
const CLIP_HEIGHT = 26
const LANE_INSET = (ROW_HEIGHT - CLIP_HEIGHT) / 2 // 4px above and below each clip
const RULER_HEIGHT = 22
const TRACK_HEADER_WIDTH = 108

// Lanes that always exist, in order. Imported video rows are prepended above
// the SCREEN lane, which stays the bottom-most video layer.
const FIXED_ROWS: { key: string; label: string; height: number }[] = [
  { key: 'screen', label: 'Screen', height: ROW_HEIGHT },
  { key: 'recorded-audio', label: 'Recorded audio', height: ROW_HEIGHT },
  { key: 'music', label: 'Music', height: ROW_HEIGHT },
  { key: 'clicks', label: 'Click sounds', height: ROW_HEIGHT },
  { key: 'camera', label: '3D camera', height: ROW_HEIGHT },
  { key: 'zoom', label: 'Zoom effects', height: ROW_HEIGHT },
  { key: 'layout', label: 'Layout', height: ROW_HEIGHT },
  { key: 'masking', label: 'Masking effects', height: ROW_HEIGHT },
]

const EFFECT_LABELS: Record<string, string> = {
  mask: 'Mask',
  blur: 'Blur',
  focus: 'Focus',
  border: 'Border',
}

const layoutLabel = (layout: string) => COMPOSITION_LAYOUTS.find((option) => option.value === layout)?.label ?? layout

// Memoized Ruler (DESIGN_SPEC §8: 22px, mono 11px muted labels, muted ticks)
const Ruler = memo(
  ({
    ticks,
    timeToPx,
    formatTime: formatTimeFunc,
  }: {
    ticks: { time: number; type: string }[]
    timeToPx: (time: number) => number
    formatTime: (seconds: number) => string
  }) => (
    <div
      className="sticky left-0 right-0 top-0 z-10 overflow-hidden border-b border-line bg-panel"
      style={{ height: RULER_HEIGHT }}
    >
      <div className="relative h-full">
        {ticks.map(({ time, type }) => (
          <div key={`${type}-${time}`} className="absolute top-0 h-full" style={{ left: `${timeToPx(time)}px` }}>
            <div
              className={cn(
                'absolute left-1/2 top-0 w-px -translate-x-1/2 bg-muted',
                type === 'major' ? 'h-2' : 'h-1 opacity-50',
              )}
            />
            {type === 'major' && (
              <span className="absolute left-1 top-[7px] whitespace-nowrap font-mono text-label text-muted">
                {formatTimeFunc(time)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  ),
)
Ruler.displayName = 'Ruler'

export function Timeline({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement> }) {
  const { currentTime, duration, timelineZoom, previewCutRegion, selectedRegionId, isPlaying } = useEditorStore(
    useShallow((state) => ({
      currentTime: state.currentTime,
      duration: state.duration,
      timelineZoom: state.timelineZoom,
      previewCutRegion: state.previewCutRegion,
      selectedRegionId: state.selectedRegionId,
      isPlaying: state.isPlaying,
    })),
  )
  const { setCurrentTime, setSelectedRegionId, updateCameraMotion, updateAudioClip, setVideoClipOrder } =
    useEditorStore()

  const containerRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const regionRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const animationFrameRef = useRef<number>()

  const [containerWidth, setContainerWidth] = useState(0)
  const [timelineHeight, setTimelineHeight] = useState(464)

  useEffect(() => {
    const containerEl = containerRef.current
    let widthObserver: ResizeObserver | null = null

    if (containerEl) {
      setContainerWidth(containerEl.clientWidth)
      widthObserver = new ResizeObserver((entries) => {
        if (entries[0]) setContainerWidth(entries[0].contentRect.width)
      })
      widthObserver.observe(containerEl)
    }

    return () => {
      if (widthObserver && containerEl) widthObserver.unobserve(containerEl)
    }
  }, [])

  const pixelsPerSecond = useMemo(() => {
    if (duration === 0 || containerWidth === 0) return 200
    return (containerWidth / duration) * timelineZoom
  }, [duration, containerWidth, timelineZoom])

  const timeToPx = useCallback((time: number) => time * pixelsPerSecond, [pixelsPerSecond])
  const pxToTime = useCallback((px: number) => px / pixelsPerSecond, [pixelsPerSecond])

  const updateVideoTime = useCallback(
    (time: number) => {
      const clampedTime = Math.max(0, Math.min(time, duration))
      setCurrentTime(clampedTime)
      if (videoRef.current) videoRef.current.currentTime = clampedTime
    },
    [duration, setCurrentTime, videoRef],
  )

  const {
    draggingRegionId,
    handleRegionMouseDown,
    handlePlayheadMouseDown,
    handleLeftStripMouseDown,
    handleRightStripMouseDown,
  } = useTimelineInteraction({
    timelineRef,
    regionRefs,
    pxToTime,
    timeToPx,
    updateVideoTime,
    duration,
  })

  const rulerTicks = useMemo(() => {
    if (duration <= 0 || pixelsPerSecond <= 0) return []
    const { major, minor } = calculateRulerInterval(pixelsPerSecond)
    const ticks = []
    for (let time = 0; time <= duration; time += major) {
      ticks.push({ time: parseFloat(time.toPrecision(10)), type: 'major' })
    }
    for (let time = 0; time <= duration; time += minor) {
      const preciseTime = parseFloat(time.toPrecision(10))
      if (preciseTime % major !== 0) {
        ticks.push({ time: preciseTime, type: 'minor' })
      }
    }
    return ticks
  }, [duration, pixelsPerSecond])

  useEffect(() => {
    const animate = () => {
      if (videoRef.current && playheadRef.current) {
        playheadRef.current.style.transform = `translateX(${timeToPx(videoRef.current.currentTime)}px)`
      }
      animationFrameRef.current = requestAnimationFrame(animate)
    }
    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(animate)
    }
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
    }
  }, [isPlaying, timeToPx, videoRef])

  useEffect(() => {
    if (!isPlaying && playheadRef.current) {
      playheadRef.current.style.transform = `translateX(${timeToPx(currentTime)}px)`
    }
  }, [currentTime, isPlaying, timeToPx])

  const { zoomRegions, cutRegions, speedRegions } = useAllRegions()
  const visualEffects = useEditorStore((state) => state.visualEffects)
  const updateVisualEffect = useEditorStore((state) => state.updateVisualEffect)
  const compositionLayouts = useEditorStore((state) => state.compositionLayouts)
  const updateCompositionLayout = useEditorStore((state) => state.updateCompositionLayout)
  const cameraMotions = useEditorStore((state) => state.cameraMotions)
  const audioClips = useEditorStore((state) => state.audioClips)
  const videoClips = useEditorStore((state) => state.videoClips)
  const updateVideoClip = useEditorStore((state) => state.updateVideoClip)
  const mouseClickSoundsEnabled = useEditorStore((state) => state.mouseClickSoundsEnabled)
  const videoPath = useEditorStore((state) => state.videoPath)
  const audioTracks = useEditorStore((state) => state.audioTracks)
  const updateAudioTrack = useEditorStore((state) => state.updateAudioTrack)
  const clickClips = useMemo(() => audioClips.filter((clip) => clip.kind === 'click'), [audioClips])

  // Imported clips are stacked top-first: the top row is drawn last (on top),
  // and the SCREEN lane always stays underneath every clip.
  const displayVideoClips = useMemo(() => [...videoClips].sort((a, b) => (b.order ?? 0) - (a.order ?? 0)), [videoClips])

  const trackLayout = useMemo(() => {
    const rows = buildTrackRows({
      videoClipIds: displayVideoClips.map((clip) => clip.id),
      // One row per audio source: each has its own volume and mute, and a lane is
      // how the editor says so. A recording made before the sources were separated
      // has one `mixed` track and gets one lane, which is what it is.
      audioTracks: audioTracks.map((track) => ({ id: track.id, label: track.label })),
      fixedRows: FIXED_ROWS,
      rowHeight: ROW_HEIGHT,
    })
    let top = 0
    const positioned = rows.map((row) => {
      const positionedRow = { ...row, top }
      top += row.height
      return positionedRow
    })
    return {
      rows: positioned,
      topByKey: Object.fromEntries(positioned.map((row) => [row.key, row.top])) as Record<string, number>,
      height: top,
    }
  }, [displayVideoClips, audioTracks])

  // Dragging a clip's grip handle moves it up/down the stack. The row under the
  // cursor becomes its new index, and the store keeps the bottom-first order.
  const beginVideoReorder = useCallback(
    (event: React.MouseEvent, id: string) => {
      event.stopPropagation()
      event.preventDefault()
      setSelectedRegionId(id)
      const startY = event.clientY
      const initialOrder = displayVideoClips
      const initialIndex = initialOrder.findIndex((clip) => clip.id === id)
      if (initialIndex < 0) return
      const move = (moveEvent: MouseEvent) => {
        const deltaRows = Math.round((moveEvent.clientY - startY) / ROW_HEIGHT)
        const targetIndex = Math.max(0, Math.min(initialOrder.length - 1, initialIndex + deltaRows))
        if (targetIndex === initialIndex) return
        const next = [...initialOrder]
        const [moved] = next.splice(initialIndex, 1)
        next.splice(targetIndex, 0, moved)
        setVideoClipOrder([...next].reverse().map((clip) => clip.id))
      }
      const up = () => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [displayVideoClips, setSelectedRegionId, setVideoClipOrder],
  )

  // Dragging a clip's edges trims it in place instead of typing numbers.
  const beginVideoTrim = useCallback(
    (event: React.MouseEvent, clipId: string, edge: 'left' | 'right') => {
      event.stopPropagation()
      event.preventDefault()
      setSelectedRegionId(clipId)
      const clip = useEditorStore.getState().videoClips.find((item) => item.id === clipId)
      if (!clip) return
      const startX = event.clientX
      const initial = {
        startTime: clip.startTime,
        duration: clip.duration,
        sourceStart: clip.sourceStart,
      }
      const move = (moveEvent: MouseEvent) => {
        const delta = pxToTime(moveEvent.clientX - startX)
        if (edge === 'left') {
          // The right edge stays put; the head moves. Bounded by the start of the
          // timeline and the start of the source media.
          const minDelta = Math.max(-initial.startTime, -initial.sourceStart)
          const maxDelta = initial.duration - 0.1
          const applied = Math.max(minDelta, Math.min(maxDelta, delta))
          updateVideoClip(clipId, {
            startTime: initial.startTime + applied,
            sourceStart: initial.sourceStart + applied,
            duration: initial.duration - applied,
          })
          return
        }
        // The tail moves; past the end of the source the last frame is held, so
        // the only limit is the end of the timeline.
        const maxDuration = Math.max(0.1, duration - initial.startTime)
        updateVideoClip(clipId, { duration: Math.max(0.1, Math.min(maxDuration, initial.duration + delta)) })
      }
      const up = () => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [pxToTime, duration, setSelectedRegionId, updateVideoClip],
  )

  const beginHeightResize = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      const startY = event.clientY
      const initialHeight = timelineHeight
      const move = (moveEvent: MouseEvent) => {
        setTimelineHeight(Math.max(220, Math.min(760, initialHeight - (moveEvent.clientY - startY))))
      }
      const up = () => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [timelineHeight],
  )

  const allRegionsToRender = useMemo(() => {
    const combined = [...Object.values(zoomRegions), ...Object.values(cutRegions), ...Object.values(speedRegions)]
    if (previewCutRegion) {
      combined.push(previewCutRegion)
    }
    return combined
  }, [zoomRegions, cutRegions, speedRegions, previewCutRegion])

  return (
    <>
      <AudioTimelinePreview />
      <div className="flex flex-col border-t border-line bg-panel" style={{ height: `${timelineHeight}px` }}>
        {/* Drag to resize the timeline height */}
        <div
          role="separator"
          aria-label="Resize timeline height"
          aria-orientation="horizontal"
          title="Drag to resize the timeline"
          onMouseDown={beginHeightResize}
          className="group/timeline-resize flex h-4 shrink-0 cursor-ns-resize items-center justify-center"
        >
          <span className="h-[3px] w-8 rounded-full bg-muted/60 transition-colors group-hover/timeline-resize:bg-accent" />
        </div>
        <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
          <div
            role="button"
            aria-label="Trim the start of the recording"
            title="Drag to trim the start of the recording"
            className="flex h-full w-8 shrink-0 cursor-ew-resize select-none items-center justify-center border-r border-line text-muted hover:bg-ctl hover:text-fg"
            onMouseDown={handleLeftStripMouseDown}
          >
            <Scissors size={ICON_SIZE} strokeWidth={ICON_STROKE} />
          </div>

          {/* Track header column (108px) — aligned with the ruler and the lanes below. */}
          <div
            className="shrink-0 select-none border-r border-line"
            style={{ width: TRACK_HEADER_WIDTH }}
            aria-hidden="true"
          >
            <div className="border-b border-line" style={{ height: RULER_HEIGHT }} />
            {trackLayout.rows.map((row) => (
              <div
                key={row.key}
                className="flex items-center pl-4 text-sm font-medium text-muted"
                style={{ height: row.height }}
              >
                <span className="truncate">{row.label}</span>
              </div>
            ))}
          </div>

          <div
            ref={containerRef}
            className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
            onMouseDown={(e) => {
              if (duration === 0 || (e.target as HTMLElement).closest('[data-region-id]')) return
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
              const clickX = e.clientX - rect.left + (e.currentTarget as HTMLDivElement).scrollLeft
              updateVideoTime(pxToTime(clickX))
              setSelectedRegionId(null)
            }}
          >
            <div
              ref={timelineRef}
              className="relative h-full min-w-full overflow-hidden"
              style={{ width: `${timeToPx(duration)}px` }}
            >
              <Ruler ticks={rulerTicks} timeToPx={timeToPx} formatTime={formatTime} />

              <div className="absolute left-0 w-full" style={{ top: RULER_HEIGHT, height: `${trackLayout.height}px` }}>
                {trackLayout.rows.map((track) => (
                  <div
                    key={track.key}
                    className="pointer-events-none absolute inset-x-0"
                    style={{ top: track.top, height: track.height }}
                  />
                ))}

                {/* The base screen recording occupies the whole timeline on its own lane. */}
                {videoPath && duration > 0 && (
                  <div
                    className="pointer-events-none absolute rounded-clip border border-line bg-clip-screen"
                    style={{
                      top: `${trackLayout.topByKey.screen + LANE_INSET}px`,
                      left: 0,
                      width: `${timeToPx(duration)}px`,
                      height: CLIP_HEIGHT,
                      zIndex: 8,
                    }}
                    aria-hidden="true"
                  />
                )}

                {/* One lane per audio source captured with the recording. The bar is
                    interactive where the old single strip was not: a source you cannot
                    silence is not a track, it is a decoration. */}
                {audioTracks.map((track) => (
                  <div
                    key={track.id}
                    data-audio-track={track.id}
                    className={cn(
                      'absolute flex items-center gap-2 overflow-hidden rounded-clip border bg-clip-audio pr-2 pl-1',
                      track.muted ? 'border-line opacity-55' : 'border-line',
                    )}
                    style={{
                      top: `${(trackLayout.topByKey[track.id] ?? 0) + LANE_INSET}px`,
                      left: 0,
                      width: `${timeToPx(duration)}px`,
                      height: CLIP_HEIGHT,
                      zIndex: 9,
                    }}
                    // The timeline seeks on mousedown; a control inside a lane is not a
                    // seek target.
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      title={track.muted ? `Unmute ${track.label}` : `Mute ${track.label}`}
                      aria-label={track.muted ? `Unmute ${track.label}` : `Mute ${track.label}`}
                      aria-pressed={track.muted}
                      className={cn(
                        'flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[3px] border',
                        track.muted ? 'border-line bg-ctl text-muted' : 'border-line bg-clip-audio text-fg',
                      )}
                      onClick={(event) => {
                        event.stopPropagation()
                        updateAudioTrack(track.id, { muted: !track.muted })
                      }}
                    >
                      {track.muted ? (
                        <VolumeOff size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                      ) : (
                        <Volume size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                      )}
                    </button>
                    <div className="w-24 shrink-0" title={`${track.label} volume`}>
                      <Slider
                        min={0}
                        max={1}
                        step={0.01}
                        value={track.volume}
                        disabled={track.muted}
                        onChange={(volume) => updateAudioTrack(track.id, { volume })}
                      />
                    </div>
                    <span className="truncate font-mono text-sm tabular-nums text-muted">
                      {track.muted ? 'muted' : `${Math.round(track.volume * 100)}%`}
                    </span>
                  </div>
                ))}
                {videoClips.map((clip) => {
                  const selected = selectedRegionId === clip.id
                  return (
                    <div
                      key={clip.id}
                      data-region-id={clip.id}
                      className="absolute"
                      style={{
                        top: `${(trackLayout.topByKey[clip.id] ?? 0) + LANE_INSET}px`,
                        left: `${timeToPx(clip.startTime)}px`,
                        width: `${Math.max(28, timeToPx(clip.duration))}px`,
                        height: CLIP_HEIGHT,
                        zIndex: selected ? 140 : 14,
                      }}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        title={`${clip.name} · ${formatTime(clip.startTime)}`}
                        aria-label={`Video clip ${clip.name}`}
                        className={cn(
                          'relative flex h-full w-full cursor-grab select-none items-center overflow-hidden rounded-clip border bg-clip-screen px-2 text-sm font-medium text-fg',
                          selected
                            ? 'border-transparent outline-solid outline-2 outline-accent'
                            : 'border-line hover:border-muted',
                        )}
                        onMouseDown={(event) => {
                          event.stopPropagation()
                          event.preventDefault()
                          setSelectedRegionId(clip.id)
                          const startX = event.clientX
                          const initialStart = clip.startTime
                          const move = (moveEvent: MouseEvent) =>
                            updateVideoClip(clip.id, {
                              startTime: Math.max(
                                0,
                                Math.min(
                                  Math.max(0, duration - clip.duration),
                                  initialStart + pxToTime(moveEvent.clientX - startX),
                                ),
                              ),
                            })
                          const up = () => {
                            window.removeEventListener('mousemove', move)
                            window.removeEventListener('mouseup', up)
                          }
                          window.addEventListener('mousemove', move)
                          window.addEventListener('mouseup', up)
                        }}
                      >
                        <span
                          data-video-edge="left"
                          role="button"
                          tabIndex={0}
                          aria-label={`Trim the start of ${clip.name}`}
                          title="Drag to trim the start"
                          onMouseDown={(event) => beginVideoTrim(event, clip.id, 'left')}
                          className="absolute left-0 top-0 z-10 flex h-full w-2 cursor-ew-resize items-center justify-center"
                        >
                          <span className="h-[calc(100%-10px)] w-[3px] rounded-[2px] bg-accent" />
                        </span>
                        <span
                          data-video-grip
                          role="button"
                          tabIndex={0}
                          aria-label={`Reorder ${clip.name}`}
                          title="Drag up or down to change which video is on top"
                          onMouseDown={(event) => beginVideoReorder(event, clip.id)}
                          className="mr-1.5 flex h-full w-3.5 shrink-0 cursor-ns-resize items-center justify-center text-muted hover:text-fg"
                        >
                          <GripVertical size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                        </span>
                        <Camera size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-1 shrink-0 text-muted" />
                        <span className="truncate">{clip.name}</span>
                        <span
                          data-video-edge="right"
                          role="button"
                          tabIndex={0}
                          aria-label={`Trim the end of ${clip.name}`}
                          title="Drag to shorten or extend"
                          onMouseDown={(event) => beginVideoTrim(event, clip.id, 'right')}
                          className="absolute right-0 top-0 z-10 flex h-full w-2 cursor-ew-resize items-center justify-center"
                        >
                          <span className="h-[calc(100%-10px)] w-[3px] rounded-[2px] bg-accent" />
                        </span>
                      </div>
                    </div>
                  )
                })}

                {audioClips
                  .filter((clip) => clip.kind !== 'click')
                  .map((clip) => {
                    const left = timeToPx(clip.startTime)
                    const width = Math.max(28, timeToPx(clip.duration))
                    const selected = selectedRegionId === clip.id
                    return (
                      <div
                        key={clip.id}
                        data-region-id={clip.id}
                        className="absolute"
                        style={{
                          top: `${trackLayout.topByKey.music + LANE_INSET}px`,
                          left: `${left}px`,
                          width: `${width}px`,
                          height: CLIP_HEIGHT,
                          zIndex: selected ? 130 : 12,
                        }}
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          aria-label={`Music clip: ${clip.name}`}
                          className={cn(
                            'group/audio relative flex h-full w-full cursor-grab select-none items-center overflow-hidden rounded-clip border bg-clip-audio px-2 text-sm font-medium text-fg',
                            selected
                              ? 'border-transparent outline-solid outline-2 outline-accent'
                              : 'border-line hover:border-muted',
                          )}
                          onMouseDown={(event) => {
                            event.stopPropagation()
                            event.preventDefault()
                            setSelectedRegionId(clip.id)
                            const startX = event.clientX
                            const initialStart = clip.startTime
                            const initialDuration = clip.duration
                            const initialSourceStart = clip.sourceStart
                            const target = event.target as HTMLElement
                            const edge = target.closest('[data-audio-edge]')?.getAttribute('data-audio-edge')
                            const move = (moveEvent: MouseEvent) => {
                              const delta = pxToTime(moveEvent.clientX - startX)
                              if (edge === 'left') {
                                const nextStart = Math.max(
                                  0,
                                  Math.min(initialStart + initialDuration - 0.1, initialStart + delta),
                                )
                                const appliedDelta = nextStart - initialStart
                                updateAudioClip(clip.id, {
                                  startTime: nextStart,
                                  duration: Math.max(0.1, initialDuration - appliedDelta),
                                  sourceStart: Math.max(
                                    0,
                                    Math.min(
                                      clip.sourceDuration - 0.1,
                                      initialSourceStart + appliedDelta * (clip.speed ?? 1),
                                    ),
                                  ),
                                })
                              } else if (edge === 'right') {
                                updateAudioClip(clip.id, {
                                  duration: Math.max(
                                    0.1,
                                    Math.min(
                                      duration - initialStart,
                                      clip.loop
                                        ? initialDuration + delta
                                        : (clip.sourceDuration - clip.sourceStart) / (clip.speed ?? 1),
                                      initialDuration + delta,
                                    ),
                                  ),
                                })
                              } else {
                                updateAudioClip(clip.id, {
                                  startTime: Math.max(0, Math.min(duration - initialDuration, initialStart + delta)),
                                })
                              }
                            }
                            const up = () => {
                              window.removeEventListener('mousemove', move)
                              window.removeEventListener('mouseup', up)
                            }
                            window.addEventListener('mousemove', move)
                            window.addEventListener('mouseup', up)
                          }}
                        >
                          <span
                            data-audio-edge="left"
                            className="absolute left-0 top-0 z-10 flex h-full w-2 cursor-ew-resize items-center justify-center"
                          >
                            <span className="h-[calc(100%-10px)] w-[3px] rounded-[2px] bg-accent" />
                          </span>
                          <Music size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-1 shrink-0 text-muted" />
                          <span className="truncate">{clip.name}</span>
                          <span
                            data-audio-edge="right"
                            className="absolute right-0 top-0 z-10 flex h-full w-2 cursor-ew-resize items-center justify-center"
                          >
                            <span className="h-[calc(100%-10px)] w-[3px] rounded-[2px] bg-accent" />
                          </span>
                        </div>
                      </div>
                    )
                  })}

                {mouseClickSoundsEnabled && (
                  <div
                    className="absolute left-0 w-full overflow-hidden"
                    style={{ top: `${trackLayout.topByKey.clicks + LANE_INSET}px`, height: CLIP_HEIGHT }}
                    onMouseDown={(event) => event.stopPropagation()}
                    aria-label="Mouse click sounds audio track"
                  >
                    {clickClips.map((clip) => {
                      const selected = selectedRegionId === clip.id
                      return (
                        <div
                          key={clip.id}
                          data-region-id={clip.id}
                          role="button"
                          tabIndex={0}
                          title={`${clip.name} · ${formatTime(clip.startTime)}`}
                          aria-label={`${clip.name} at ${formatTime(clip.startTime)}`}
                          className={cn(
                            'absolute top-0 h-full cursor-grab rounded-clip bg-accent',
                            selected && 'outline-solid outline-2 outline-accent',
                          )}
                          style={{
                            left: `${timeToPx(clip.startTime)}px`,
                            width: `${Math.max(12, timeToPx(clip.duration))}px`,
                            zIndex: selected ? 10 : 2,
                          }}
                          onMouseDown={(event) => {
                            event.stopPropagation()
                            event.preventDefault()
                            setSelectedRegionId(clip.id)
                            const startX = event.clientX
                            const initialStart = clip.startTime
                            const move = (moveEvent: MouseEvent) => {
                              const delta = pxToTime(moveEvent.clientX - startX)
                              updateAudioClip(clip.id, {
                                startTime: Math.max(
                                  0,
                                  Math.min(Math.max(0, duration - clip.duration), initialStart + delta),
                                ),
                              })
                            }
                            const up = () => {
                              window.removeEventListener('mousemove', move)
                              window.removeEventListener('mouseup', up)
                            }
                            window.addEventListener('mousemove', move)
                            window.addEventListener('mouseup', up)
                          }}
                        />
                      )
                    })}
                  </div>
                )}

                {cameraMotions.map((motion) => {
                  const left = timeToPx(motion.startTime)
                  const width = Math.max(30, timeToPx(motion.endTime - motion.startTime))
                  const selected = selectedRegionId === motion.id
                  return (
                    <div
                      key={motion.id}
                      data-region-id={motion.id}
                      className="absolute"
                      style={{
                        top: `${trackLayout.topByKey.camera + LANE_INSET}px`,
                        left: `${left}px`,
                        width: `${width}px`,
                        height: CLIP_HEIGHT,
                        zIndex: selected ? 120 : 5,
                      }}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={`Cinematic 3D Camera: ${motion.name}`}
                        className={cn(
                          'group/camera relative flex h-full w-full cursor-grab select-none items-center justify-center overflow-hidden rounded-clip border bg-ctl',
                          selected
                            ? 'border-transparent outline-solid outline-2 outline-accent'
                            : 'border-line hover:border-muted',
                        )}
                        onMouseDown={(event) => {
                          event.stopPropagation()
                          event.preventDefault()
                          setSelectedRegionId(motion.id)
                          const startX = event.clientX
                          const initialStart = motion.startTime
                          const initialEnd = motion.endTime
                          const target = event.target as HTMLElement
                          const edge = target.closest('[data-camera-edge]')?.getAttribute('data-camera-edge')
                          const move = (moveEvent: MouseEvent) => {
                            const delta = pxToTime(moveEvent.clientX - startX)
                            if (edge === 'left') {
                              const nextStart = Math.max(0, Math.min(initialEnd - 0.1, initialStart + delta))
                              updateCameraMotion(motion.id, { startTime: nextStart })
                            } else if (edge === 'right') {
                              updateCameraMotion(motion.id, {
                                endTime: Math.max(initialStart + 0.1, Math.min(duration, initialEnd + delta)),
                              })
                            } else {
                              const span = initialEnd - initialStart
                              const nextStart = Math.max(
                                0,
                                Math.min(Math.max(0, duration - span), initialStart + delta),
                              )
                              updateCameraMotion(motion.id, { startTime: nextStart, endTime: nextStart + span })
                            }
                          }
                          const up = () => {
                            window.removeEventListener('mousemove', move)
                            window.removeEventListener('mouseup', up)
                          }
                          window.addEventListener('mousemove', move)
                          window.addEventListener('mouseup', up)
                        }}
                      >
                        <span
                          data-camera-edge="left"
                          className="absolute left-0 top-0 z-10 flex h-full w-3 cursor-ew-resize items-center justify-center"
                        >
                          <span className="h-[calc(100%-10px)] w-[3px] rounded-[2px] bg-accent" />
                        </span>
                        <span className="pointer-events-none flex items-center gap-1.5 overflow-hidden px-3">
                          <Camera size={ICON_SIZE} strokeWidth={ICON_STROKE} className="shrink-0 text-muted" />
                          <span className="truncate text-sm font-medium text-fg">{motion.name}</span>
                        </span>
                        <span
                          data-camera-edge="right"
                          className="absolute right-0 top-0 z-10 flex h-full w-3 cursor-ew-resize items-center justify-center"
                        >
                          <span className="h-[calc(100%-10px)] w-[3px] rounded-[2px] bg-accent" />
                        </span>
                      </div>
                    </div>
                  )
                })}

                <div className="absolute inset-x-0 top-0 h-full">
                  {visualEffects.map((effect) => {
                    const selected = selectedRegionId === effect.id
                    const beginDrag = (event: React.MouseEvent, edge: 'move' | 'end') => {
                      event.preventDefault()
                      event.stopPropagation()
                      setSelectedRegionId(effect.id)
                      const startX = event.clientX
                      const initialStart = effect.startTime
                      const initialDuration = effect.duration
                      const move = (moveEvent: MouseEvent) => {
                        const delta = pxToTime(moveEvent.clientX - startX)
                        if (edge === 'end')
                          updateVisualEffect(effect.id, {
                            duration: Math.max(0.1, Math.min(duration - initialStart, initialDuration + delta)),
                          })
                        else
                          updateVisualEffect(effect.id, {
                            startTime: Math.max(0, Math.min(duration - initialDuration, initialStart + delta)),
                          })
                      }
                      const up = () => {
                        window.removeEventListener('mousemove', move)
                        window.removeEventListener('mouseup', up)
                      }
                      window.addEventListener('mousemove', move)
                      window.addEventListener('mouseup', up)
                    }
                    return (
                      <div
                        key={effect.id}
                        data-region-id={effect.id}
                        onMouseDown={(event) => beginDrag(event, 'move')}
                        title={`${effect.kind}: ${formatTime(effect.startTime)}–${formatTime(effect.startTime + effect.duration)}`}
                        className={cn(
                          'absolute flex cursor-grab items-center overflow-hidden rounded-clip border border-line bg-ctl text-fg',
                          selected && 'outline-solid outline-2 outline-accent',
                        )}
                        style={{
                          top: `${trackLayout.topByKey.masking + LANE_INSET}px`,
                          left: `${timeToPx(effect.startTime)}px`,
                          width: `${Math.max(24, timeToPx(effect.duration))}px`,
                          height: CLIP_HEIGHT,
                          zIndex: selected ? 120 : 30,
                        }}
                      >
                        <span className="pointer-events-none flex items-center gap-1.5 overflow-hidden px-3">
                          <Search size={ICON_SIZE} strokeWidth={ICON_STROKE} className="shrink-0 text-muted" />
                          <span className="truncate text-sm font-medium">
                            {EFFECT_LABELS[effect.kind] ?? effect.kind} · {formatTime(effect.duration)}
                          </span>
                        </span>
                        <span
                          onMouseDown={(event) => beginDrag(event, 'end')}
                          className="absolute right-0 top-0 flex h-full w-2 cursor-ew-resize items-center justify-center"
                        >
                          <span className="h-[calc(100%-10px)] w-[3px] rounded-[2px] bg-accent" />
                        </span>
                      </div>
                    )
                  })}
                  {compositionLayouts.map((range) => {
                    const selected = selectedRegionId === range.id
                    const beginLayoutDrag = (event: React.MouseEvent, edge: 'move' | 'end') => {
                      event.preventDefault()
                      event.stopPropagation()
                      setSelectedRegionId(range.id)
                      const startX = event.clientX,
                        initialStart = range.startTime,
                        initialDuration = range.duration
                      const move = (moveEvent: MouseEvent) => {
                        const delta = pxToTime(moveEvent.clientX - startX)
                        if (edge === 'end')
                          updateCompositionLayout(range.id, {
                            duration: Math.max(0.1, Math.min(duration - initialStart, initialDuration + delta)),
                          })
                        else
                          updateCompositionLayout(range.id, {
                            startTime: Math.max(0, Math.min(duration - initialDuration, initialStart + delta)),
                          })
                      }
                      const up = () => {
                        window.removeEventListener('mousemove', move)
                        window.removeEventListener('mouseup', up)
                      }
                      window.addEventListener('mousemove', move)
                      window.addEventListener('mouseup', up)
                    }
                    return (
                      <div
                        key={range.id}
                        data-region-id={range.id}
                        onMouseDown={(event) => beginLayoutDrag(event, 'move')}
                        title={`${layoutLabel(range.layout)}: ${formatTime(range.startTime)}–${formatTime(range.startTime + range.duration)}`}
                        className={cn(
                          'absolute flex cursor-grab items-center overflow-hidden rounded-clip border border-line bg-ctl text-fg',
                          selected && 'outline-solid outline-2 outline-accent',
                        )}
                        style={{
                          top: `${trackLayout.topByKey.layout + LANE_INSET}px`,
                          left: `${timeToPx(range.startTime)}px`,
                          width: `${Math.max(28, timeToPx(range.duration))}px`,
                          height: CLIP_HEIGHT,
                          zIndex: selected ? 130 : 40,
                        }}
                      >
                        <span className="pointer-events-none flex items-center gap-1.5 overflow-hidden px-3">
                          <Camera size={ICON_SIZE} strokeWidth={ICON_STROKE} className="shrink-0 text-muted" />
                          <span className="truncate text-sm font-medium">{layoutLabel(range.layout)}</span>
                        </span>
                        <span
                          onMouseDown={(event) => beginLayoutDrag(event, 'end')}
                          className="absolute right-0 top-0 flex h-full w-2 cursor-ew-resize items-center justify-center"
                        >
                          <span className="h-[calc(100%-10px)] w-[3px] rounded-[2px] bg-accent" />
                        </span>
                      </div>
                    )
                  })}
                  {allRegionsToRender.map((region) => {
                    const isSelected = selectedRegionId === region.id
                    const zIndex = isSelected ? 100 : (region.zIndex ?? 1)

                    // Zoom regions sit in their own lane; cut/speed keep the previous
                    // behaviour of rendering in the ruler band (top of the timeline).
                    const isZoom = region.type === 'zoom'
                    const wrapperStyle: React.CSSProperties = {
                      position: 'absolute',
                      left: `${timeToPx(region.startTime)}px`,
                      width: `${timeToPx(region.duration)}px`,
                      zIndex: zIndex,
                      top: isZoom ? trackLayout.topByKey.zoom + LANE_INSET : 0,
                      height: isZoom ? CLIP_HEIGHT : RULER_HEIGHT,
                    }

                    if (region.type === 'zoom' || region.type === 'cut') {
                      return (
                        <div key={region.id} style={wrapperStyle}>
                          {region.type === 'zoom' && (
                            <ZoomRegionBlock
                              region={region}
                              isSelected={isSelected}
                              isBeingDragged={draggingRegionId === region.id}
                              onMouseDown={handleRegionMouseDown}
                              setRef={(el) => regionRefs.current.set(region.id, el)}
                            />
                          )}
                          {region.type === 'cut' && (
                            <CutRegionBlock
                              region={region}
                              isSelected={isSelected}
                              isDraggable={region.id !== previewCutRegion?.id}
                              isBeingDragged={draggingRegionId === region.id}
                              onMouseDown={handleRegionMouseDown}
                              setRef={(el) => regionRefs.current.set(region.id, el)}
                            />
                          )}
                        </div>
                      )
                    }
                    if (region.type === 'speed') {
                      return (
                        <div key={region.id} style={wrapperStyle}>
                          <SpeedRegionBlock
                            region={region}
                            isSelected={isSelected}
                            isBeingDragged={draggingRegionId === region.id}
                            onMouseDown={handleRegionMouseDown}
                            setRef={(el) => regionRefs.current.set(region.id, el)}
                          />
                        </div>
                      )
                    }
                    return null
                  })}
                </div>
              </div>

              {duration > 0 && (
                <div
                  ref={playheadRef}
                  className="absolute top-0 bottom-0 z-[200]"
                  style={{ transform: `translateX(${timeToPx(currentTime)}px)`, pointerEvents: 'none' }}
                >
                  <Playhead
                    height={timelineRef.current?.clientHeight ?? 0}
                    isDragging={false}
                    onMouseDown={handlePlayheadMouseDown}
                  />
                </div>
              )}
            </div>
          </div>

          <div
            role="button"
            aria-label="Trim the end of the recording"
            title="Drag to trim the end of the recording"
            className="flex h-full w-8 shrink-0 cursor-ew-resize select-none items-center justify-center border-l border-line text-muted hover:bg-ctl hover:text-fg"
            onMouseDown={handleRightStripMouseDown}
          >
            <FlipScissorsIcon size={ICON_SIZE} className="text-muted" />
          </div>
        </div>
      </div>
    </>
  )
}
