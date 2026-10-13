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
import { Camera, Music } from 'tabler-icons-react'
import { AudioTimelinePreview } from './timeline/AudioTimelinePreview'

// Memoized Ruler component (không thay đổi)
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
    <div className="h-12 sticky overflow-hidden top-0 left-0 right-0 z-10 border-b border-border/30 bg-card/60 backdrop-blur-md">
      <div className="relative h-full pt-2">
        {ticks.map(({ time, type }) => (
          <div key={`${type}-${time}`} className="absolute top-2 h-full" style={{ left: `${timeToPx(time)}px` }}>
            <div
              className={cn(
                'timeline-tick absolute top-0 left-1/2 -translate-x-1/2 w-px',
                type === 'major' ? 'h-5 opacity-60' : 'h-2.5 opacity-30',
              )}
            />
            {type === 'major' && (
              <span className="absolute top-3.5 left-1 text-[10px] text-foreground/70 font-mono font-medium tracking-tight">
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
  const { setCurrentTime, setSelectedRegionId, updateCameraMotion, updateAudioClip } = useEditorStore()

  const containerRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const regionRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const animationFrameRef = useRef<number>()

  const [containerWidth, setContainerWidth] = useState(0)

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
  const clickClips = useMemo(() => audioClips.filter((clip) => clip.kind === 'click'), [audioClips])

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
    <div
      className={cn(
        'flex flex-col bg-background/50 p-3 transition-all duration-300 ease-in-out',
        'h-[29rem]',
      )}
    >
      <div className="h-full flex flex-row rounded-xl overflow-hidden shadow-xl bg-card border border-border">
        <div
          className="w-8 shrink-0 h-full bg-gradient-to-b from-card to-muted/30 flex items-center justify-center transition-all duration-200 cursor-ew-resize select-none border-r border-border hover:bg-accent/40 active:bg-accent/60 group"
          onMouseDown={handleLeftStripMouseDown}
        >
          <Scissors size={16} className="text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>

        <div
          ref={containerRef}
          className="flex-1 overflow-x-auto overflow-y-hidden bg-gradient-to-b from-background/30 to-background/10"
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

            <div className="absolute top-12 left-0 w-full" style={{ height: '21rem' }}>
              {[
                { label: 'VIDEO', top: 0, height: 48 },
                { label: 'AUDIO', top: 48, height: 48 },
                { label: 'CLICK SOUNDS', top: 96, height: 32 },
                { label: '3D CAMERA', top: 128, height: 48 },
                { label: 'ZOOM EFFECTS', top: 176, height: 48 },
                { label: 'LAYOUT', top: 224, height: 48 },
                { label: 'MASKING EFFECTS', top: 272, height: 48 },
              ].map((track) => (
                <div key={track.label} className="pointer-events-none absolute inset-x-0 border-b border-border/40 bg-muted/10" style={{ top: track.top, height: track.height }}>
                  <span className="absolute left-2 top-1 z-[1] rounded bg-background/80 px-1.5 py-0.5 text-[8px] font-bold tracking-wider text-muted-foreground/80">{track.label}</span>
                </div>
              ))}
              {videoClips.map((clip) => {
                const selected = selectedRegionId === clip.id
                return <div key={clip.id} data-region-id={clip.id} className="absolute top-1 h-9" style={{ left: `${timeToPx(clip.startTime)}px`, width: `${Math.max(28, timeToPx(clip.duration))}px`, zIndex: selected ? 140 : 14 }}>
                  <div role="button" tabIndex={0} title={`${clip.name} · ${formatTime(clip.startTime)}`} aria-label={`Video clip ${clip.name}`} className={cn('flex h-full w-full cursor-grab select-none items-center overflow-hidden rounded-md border px-2 text-[10px] font-semibold', selected ? 'border-primary bg-sky-500/35 text-foreground' : 'border-sky-600/60 bg-sky-500/20 text-foreground hover:bg-sky-500/30')} onMouseDown={(event) => {
                    event.stopPropagation(); event.preventDefault(); setSelectedRegionId(clip.id)
                    const startX = event.clientX; const initialStart = clip.startTime
                    const move = (moveEvent: MouseEvent) => updateVideoClip(clip.id, { startTime: Math.max(0, Math.min(Math.max(0, duration - clip.duration), initialStart + pxToTime(moveEvent.clientX - startX))) })
                    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
                    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
                  }}><Camera className="mr-1 h-3 w-3 shrink-0 text-sky-600 dark:text-sky-300" /><span className="truncate">{clip.name}</span></div>
                </div>
              })}

              {audioClips.filter((clip) => clip.kind !== 'click').map((clip) => {
                const left = timeToPx(clip.startTime)
                const width = Math.max(28, timeToPx(clip.duration))
                const selected = selectedRegionId === clip.id
                return (
                  <div key={clip.id} data-region-id={clip.id} className="absolute top-12 h-9" style={{ left: `${left}px`, width: `${width}px`, zIndex: selected ? 130 : 12 }}>
                    <div
                      role="button" tabIndex={0} aria-label={`Music clip: ${clip.name}`}
                      className={cn('group/audio relative flex h-full w-full cursor-grab select-none items-center overflow-hidden rounded-md border px-2 text-[10px] font-semibold', selected ? 'border-primary bg-emerald-500/25 text-foreground' : 'border-emerald-600/60 bg-emerald-500/15 text-foreground hover:bg-emerald-500/25')}
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
                            const nextStart = Math.max(0, Math.min(initialStart + initialDuration - 0.1, initialStart + delta))
                            const appliedDelta = nextStart - initialStart
                            updateAudioClip(clip.id, { startTime: nextStart, duration: Math.max(0.1, initialDuration - appliedDelta), sourceStart: Math.max(0, Math.min(clip.sourceDuration - 0.1, initialSourceStart + appliedDelta * (clip.speed ?? 1))) })
                          } else if (edge === 'right') {
                            updateAudioClip(clip.id, { duration: Math.max(0.1, Math.min(duration - initialStart, clip.loop ? initialDuration + delta : (clip.sourceDuration - clip.sourceStart) / (clip.speed ?? 1), initialDuration + delta)) })
                          } else {
                            updateAudioClip(clip.id, { startTime: Math.max(0, Math.min(duration - initialDuration, initialStart + delta)) })
                          }
                        }
                        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
                        window.addEventListener('mousemove', move)
                        window.addEventListener('mouseup', up)
                      }}
                    >
                      <span data-audio-edge="left" className="absolute left-0 top-0 z-10 h-full w-2 cursor-ew-resize bg-emerald-700/40" />
                      <Music className="mr-1 h-3 w-3 shrink-0 text-emerald-700 dark:text-emerald-300" />
                      <span className="truncate">{clip.name}</span>
                      <span data-audio-edge="right" className="absolute right-0 top-0 z-10 h-full w-2 cursor-ew-resize bg-emerald-700/40" />
                    </div>
                  </div>
                )
              })}

              {mouseClickSoundsEnabled && (
                <div className="absolute left-0 top-24 h-5 w-full overflow-hidden rounded-sm border border-amber-500/30 bg-amber-500/5" onMouseDown={(event) => event.stopPropagation()} aria-label="Mouse click sounds audio track">

                  {clickClips.map((clip) => {
                    const selected = selectedRegionId === clip.id
                    return <div
                      key={clip.id}
                      data-region-id={clip.id}
                      role="button"
                      tabIndex={0}
                      title={`${clip.name} · ${formatTime(clip.startTime)}`}
                      aria-label={`${clip.name} at ${formatTime(clip.startTime)}`}
                      className={cn('absolute top-0 h-full cursor-grab rounded-sm border transition-colors', selected ? 'z-10 border-primary bg-primary/80' : 'z-[2] border-amber-600/80 bg-amber-500/70 hover:bg-amber-400/90')}
                      style={{ left: `${timeToPx(clip.startTime)}px`, width: `${Math.max(12, timeToPx(clip.duration))}px` }}
                      onMouseDown={(event) => {
                        event.stopPropagation()
                        event.preventDefault()
                        setSelectedRegionId(clip.id)
                        const startX = event.clientX
                        const initialStart = clip.startTime
                        const move = (moveEvent: MouseEvent) => {
                          const delta = pxToTime(moveEvent.clientX - startX)
                          updateAudioClip(clip.id, { startTime: Math.max(0, Math.min(Math.max(0, duration - clip.duration), initialStart + delta)) })
                        }
                        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
                        window.addEventListener('mousemove', move)
                        window.addEventListener('mouseup', up)
                      }}
                    />
                  })}
                </div>
              )}

              {cameraMotions.map((motion) => {
                const left = timeToPx(motion.startTime)
                const width = Math.max(30, timeToPx(motion.endTime - motion.startTime))
                const selected = selectedRegionId === motion.id
                return <div key={motion.id} data-region-id={motion.id} className="absolute top-32 h-12" style={{ left: `${left}px`, width: `${width}px`, zIndex: selected ? 120 : 5 }}>
                  <div
                    role="button" tabIndex={0} aria-label={`Cinematic 3D Camera: ${motion.name}`}
                    className={cn('group/camera relative flex h-full w-full cursor-grab select-none items-center justify-center overflow-hidden rounded-xl border-2 backdrop-blur-sm', selected ? 'border-primary bg-primary/20 shadow-lg shadow-primary/10' : 'border-violet-500/60 bg-violet-500/15 hover:border-violet-400 hover:bg-violet-500/25')}
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
                          updateCameraMotion(motion.id, { endTime: Math.max(initialStart + 0.1, Math.min(duration, initialEnd + delta)) })
                        } else {
                          const span = initialEnd - initialStart
                          const nextStart = Math.max(0, Math.min(Math.max(0, duration - span), initialStart + delta))
                          updateCameraMotion(motion.id, { startTime: nextStart, endTime: nextStart + span })
                        }
                      }
                      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
                      window.addEventListener('mousemove', move)
                      window.addEventListener('mouseup', up)
                    }}
                  >
                    <span data-camera-edge="left" className="absolute left-0 top-0 z-10 flex h-full w-3 cursor-ew-resize items-center justify-center"><span className="h-7 w-1 rounded-full bg-violet-500 group-hover/camera:h-9" /></span>
                    <span className="pointer-events-none flex items-center gap-2 px-4 text-xs font-semibold tracking-wide text-foreground"><Camera className="h-4 w-4 shrink-0 text-violet-500" /><span className="truncate">3D CAMERA · {motion.name}</span></span>
                    <span data-camera-edge="right" className="absolute right-0 top-0 z-10 flex h-full w-3 cursor-ew-resize items-center justify-center"><span className="h-7 w-1 rounded-full bg-violet-500 group-hover/camera:h-9" /></span>
                  </div>
                </div>
              })}

              <div className="absolute inset-x-0 top-0 h-full">
                {visualEffects.map((effect) => {
                  const selected = selectedRegionId === effect.id
                  const colors: Record<string, string> = { mask: 'bg-slate-500/35 border-slate-500', blur: 'bg-sky-500/25 border-sky-500', focus: 'bg-amber-500/25 border-amber-500', border: 'bg-fuchsia-500/25 border-fuchsia-500' }
                  const beginDrag = (event: React.MouseEvent, edge: 'move' | 'end') => {
                    event.preventDefault(); event.stopPropagation(); setSelectedRegionId(effect.id)
                    const startX = event.clientX; const initialStart = effect.startTime; const initialDuration = effect.duration
                    const move = (moveEvent: MouseEvent) => {
                      const delta = pxToTime(moveEvent.clientX - startX)
                      if (edge === 'end') updateVisualEffect(effect.id, { duration: Math.max(.1, Math.min(duration - initialStart, initialDuration + delta)) })
                      else updateVisualEffect(effect.id, { startTime: Math.max(0, Math.min(duration - initialDuration, initialStart + delta)) })
                    }
                    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
                    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
                  }
                  return <div key={effect.id} data-region-id={effect.id} onMouseDown={event => beginDrag(event, 'move')} title={`${effect.kind}: ${formatTime(effect.startTime)}–${formatTime(effect.startTime + effect.duration)}`} className={`absolute top-[17rem] flex h-6 cursor-grab items-center overflow-hidden rounded border text-[10px] font-semibold ${colors[effect.kind]} ${selected ? 'ring-2 ring-primary' : ''}`} style={{ left: `${timeToPx(effect.startTime)}px`, width: `${Math.max(24, timeToPx(effect.duration))}px`, zIndex: selected ? 120 : 30 }}><span className="truncate px-2">{effect.kind.toUpperCase()} · {formatTime(effect.duration)}</span><span onMouseDown={event => beginDrag(event, 'end')} className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-current/30" /></div>
                })}
                {compositionLayouts.map((range) => {
                  const selected = selectedRegionId === range.id
                  const beginLayoutDrag = (event: React.MouseEvent, edge: 'move' | 'end') => {
                    event.preventDefault(); event.stopPropagation(); setSelectedRegionId(range.id)
                    const startX = event.clientX, initialStart = range.startTime, initialDuration = range.duration
                    const move = (moveEvent: MouseEvent) => {
                      const delta = pxToTime(moveEvent.clientX - startX)
                      if (edge === 'end') updateCompositionLayout(range.id, { duration: Math.max(.1, Math.min(duration-initialStart, initialDuration+delta)) })
                      else updateCompositionLayout(range.id, { startTime: Math.max(0, Math.min(duration-initialDuration, initialStart+delta)) })
                    }
                    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
                    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
                  }
                  return <div key={range.id} data-region-id={range.id} onMouseDown={(event) => beginLayoutDrag(event, 'move')} title={`${range.layout}: ${formatTime(range.startTime)}–${formatTime(range.startTime+range.duration)}`} className={`absolute top-56 flex h-6 cursor-grab items-center overflow-hidden rounded border text-[10px] font-semibold ${selected ? 'ring-2 ring-primary' : ''} bg-primary/10 border-primary/60 text-foreground`} style={{ left: `${timeToPx(range.startTime)}px`, width: `${Math.max(28, timeToPx(range.duration))}px`, zIndex: selected ? 130 : 40 }}><span className="truncate px-2">LAYOUT · {range.layout.toUpperCase()}</span><span onMouseDown={(event) => beginLayoutDrag(event, 'end')} className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-primary/30" /></div>
                })}
                {allRegionsToRender.map((region) => {
                  const isSelected = selectedRegionId === region.id
                  const zIndex = isSelected ? 100 : (region.zIndex ?? 1)
                  const regionStyle: React.CSSProperties = {
                    left: `${timeToPx(region.startTime)}px`,
                    width: `${timeToPx(region.duration)}px`,
                    zIndex: zIndex,
                  }

                  if (region.type === 'zoom' || region.type === 'cut') {
                    return (
                      <div key={region.id} className={cn('absolute', region.type === 'zoom' ? 'top-44 h-12' : 'top-0 h-12')} style={regionStyle}>
                        {region.type === 'zoom' && <ZoomRegionBlock region={region} isSelected={isSelected} isBeingDragged={draggingRegionId === region.id} onMouseDown={handleRegionMouseDown} setRef={(el) => regionRefs.current.set(region.id, el)} />}
                        {region.type === 'cut' && <CutRegionBlock region={region} isSelected={isSelected} isDraggable={region.id !== previewCutRegion?.id} isBeingDragged={draggingRegionId === region.id} onMouseDown={handleRegionMouseDown} setRef={(el) => regionRefs.current.set(region.id, el)} />}
                      </div>
                    )
                  }
                  if (region.type === 'speed') {
                    return <div key={region.id} className="absolute top-0 h-12" style={regionStyle}><SpeedRegionBlock region={region} isSelected={isSelected} isBeingDragged={draggingRegionId === region.id} onMouseDown={handleRegionMouseDown} setRef={(el) => regionRefs.current.set(region.id, el)} /></div>
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
                  height={Math.floor((timelineRef.current?.clientHeight ?? 0) * 0.9)}
                  isDragging={false}
                  onMouseDown={handlePlayheadMouseDown}
                />
              </div>
            )}
          </div>
        </div>

        <div
          className="w-8 shrink-0 h-full bg-gradient-to-b from-card to-muted/30 flex items-center justify-center transition-all duration-200 cursor-ew-resize select-none border-l border-border hover:bg-accent/40 active:bg-accent/60 group"
          onMouseDown={handleRightStripMouseDown}
        >
          <FlipScissorsIcon size={16} className="text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>
      </div>
    </div>
    </>
  )
}