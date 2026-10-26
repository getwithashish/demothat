import React, { useEffect, useRef, memo, useState, useCallback } from 'react'
import { useEditorStore, usePlaybackState } from '../../store/editorStore'
import { Movie } from 'tabler-icons-react'
import { FullscreenIcon, ExitFullscreenIcon, ICON_SIZE, ICON_STROKE } from '../ui/icons'
import {
  PlayerPlay,
  PlayerTrackPrev as RewindIcon,
  PlayerPause,
  PlayerSkipBack,
  PlayerSkipForward,
} from 'tabler-icons-react'
import { useShallow } from 'zustand/react/shallow'
import { formatTime } from '../../lib/utils'
import { Slider } from '../ui/slider'
import { Button } from '../ui/button'
import { drawScene, getClipSourceTime, type VideoClipLayer } from '../../lib/renderer'
import { cn } from '../../lib/utils'
import type { VisualEffectRegion } from '../../types'
import { usePreviewAudioMixer } from '../../hooks/usePreviewAudioMixer'
import { mapSourceTimeToExportTime } from '../../lib/utils'

const mediaUrl = (filePath: string) => `media://${encodeURI(filePath).replace(/#/g, '%23').replace(/\?/g, '%3F')}`

export const Preview = memo(
  ({
    videoRef,
    onSeekFrame,
  }: {
    videoRef: React.RefObject<HTMLVideoElement>
    onSeekFrame: (direction: 'next' | 'prev') => void
  }) => {
    const {
      videoUrl,
      cutRegions,
      speedRegions,
      webcamVideoUrl,
      duration,
      currentTime,
      togglePlay,
      isPreviewFullScreen,
      togglePreviewFullScreen,
      frameStyles,
      cameraMotions,
      isWebcamVisible,
      webcamPosition,
      webcamStyles,
      videoDimensions,
      canvasDimensions,
      volume,
      isMuted,
      setCurrentTime,
      cursorStyles,
      cursorBitmapsToRender,
      videoClips,
      subtitleCues,
    } = useEditorStore(
      useShallow((state) => ({
        videoUrl: state.videoUrl,
        cutRegions: state.cutRegions,
        speedRegions: state.speedRegions,
        webcamVideoUrl: state.webcamVideoUrl,
        duration: state.duration,
        currentTime: state.currentTime,
        togglePlay: state.togglePlay,
        isPreviewFullScreen: state.isPreviewFullScreen,
        togglePreviewFullScreen: state.togglePreviewFullScreen,
        frameStyles: state.frameStyles,
        cameraMotions: state.cameraMotions,
        isWebcamVisible: state.isWebcamVisible,
        webcamPosition: state.webcamPosition,
        webcamStyles: state.webcamStyles,
        videoDimensions: state.videoDimensions,
        canvasDimensions: state.canvasDimensions,
        volume: state.volume,
        isMuted: state.isMuted,
        setCurrentTime: state.setCurrentTime,
        cursorStyles: state.cursorStyles,
        cursorBitmapsToRender: state.cursorBitmapsToRender,
        videoClips: state.videoClips,
        subtitleCues: state.subtitleCues,
      })),
    )

    const { setPlaying, setDuration, setVideoDimensions, setHasAudioTrack } = useEditorStore.getState()
    const { isPlaying, isCurrentlyCut } = usePlaybackState()

    // The recording's audio tracks, mixed separately from the video element so each
    // source can be muted and balanced on its own. While the mixer is carrying the
    // audio the element is silenced — see the volume effect below.
    const { mixerOwnsAudio } = usePreviewAudioMixer({ videoRef, isPlaying })

    const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const webcamVideoRef = useRef<HTMLVideoElement>(null)
    const clipVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())
    const animationFrameId = useRef<number>()
    const [controlBarWidth, setControlBarWidth] = useState(0)
    const [effectOverlayBounds, setEffectOverlayBounds] = useState({ left: 0, top: 0, width: 0, height: 0 })
    const visualEffects = useEditorStore((state) => state.visualEffects)
    // Drives the "Mask" chip: true while an effect covers the playhead.
    const maskActive = visualEffects.some(
      (effect) => currentTime >= effect.startTime && currentTime < effect.startTime + effect.duration,
    )
    const selectedRegionId = useEditorStore((state) => state.selectedRegionId)
    const setSelectedRegionId = useEditorStore((state) => state.setSelectedRegionId)
    const updateVisualEffect = useEditorStore((state) => state.updateVisualEffect)

    // --- Start of Changes for Fullscreen Controls ---
    const [isControlBarVisible, setIsControlBarVisible] = useState(false)
    const [isCursorHidden, setIsCursorHidden] = useState(false)
    const inactivityTimerRef = useRef<number | null>(null)
    const previewContainerRef = useRef<HTMLDivElement>(null)

    // This effect handles the auto-hiding control bar in fullscreen mode.
    useEffect(() => {
      if (!isPreviewFullScreen) {
        if (inactivityTimerRef.current) {
          window.clearTimeout(inactivityTimerRef.current)
          inactivityTimerRef.current = null
        }
        setIsCursorHidden(false)
        return // Do nothing if not in fullscreen
      }

      // Start with controls hidden
      setIsControlBarVisible(false)

      // Hide cursor after 3 seconds of inactivity
      const initialHideTimeout = window.setTimeout(() => {
        setIsCursorHidden(true)
      }, 3000)

      const showControlsAndSetTimer = () => {
        setIsControlBarVisible(true)
        setIsCursorHidden(false)
        if (inactivityTimerRef.current) {
          window.clearTimeout(inactivityTimerRef.current)
        }
        inactivityTimerRef.current = window.setTimeout(() => {
          setIsControlBarVisible(false)
          setIsCursorHidden(true) // Ẩn con trỏ khi hết thời gian chờ
        }, 3000) // Hide after 3 seconds of inactivity
      }

      const container = previewContainerRef.current
      if (container) {
        container.addEventListener('mousemove', showControlsAndSetTimer)
      }

      // Cleanup function
      return () => {
        clearTimeout(initialHideTimeout)
        if (inactivityTimerRef.current) {
          window.clearTimeout(inactivityTimerRef.current)
        }
        if (container) {
          container.removeEventListener('mousemove', showControlsAndSetTimer)
        }
      }
    }, [isPreviewFullScreen])
    // --- End of Changes for Fullscreen Controls ---

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const resizeObserver = new ResizeObserver((entries) => {
        if (entries[0]) {
          const newWidth = entries[0].contentRect.width
          if (newWidth > 0) {
            setControlBarWidth(newWidth)
          }
        }
      })
      resizeObserver.observe(canvas)
      return () => {
        resizeObserver.disconnect()
      }
    }, [canvasDimensions])

    // Keep the interaction overlay aligned to the already-sized canvas. The canvas
    // dimensions and aspect-ratio styling are deliberately left untouched.
    useEffect(() => {
      const canvas = canvasRef.current
      const container = previewContainerRef.current
      if (!canvas || !container) return
      const syncBounds = () => {
        const canvasRect = canvas.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()
        setEffectOverlayBounds({
          left: canvasRect.left - containerRect.left,
          top: canvasRect.top - containerRect.top,
          width: canvasRect.width,
          height: canvasRect.height,
        })
      }
      syncBounds()
      const observer = new ResizeObserver(syncBounds)
      observer.observe(canvas)
      observer.observe(container)
      window.addEventListener('resize', syncBounds)
      const frame = requestAnimationFrame(syncBounds)
      return () => {
        observer.disconnect()
        window.removeEventListener('resize', syncBounds)
        cancelAnimationFrame(frame)
      }
    }, [canvasDimensions, isPreviewFullScreen, videoUrl])

    const beginEffectTransform = (event: React.MouseEvent, effect: VisualEffectRegion, mode: 'move' | 'resize') => {
      event.preventDefault()
      event.stopPropagation()
      setSelectedRegionId(effect.id)
      const startX = event.clientX
      const startY = event.clientY
      const initial = { x: effect.x, y: effect.y, width: effect.width, height: effect.height }
      const bounds = canvasRef.current?.getBoundingClientRect()
      if (!bounds || !bounds.width || !bounds.height) return
      const move = (moveEvent: MouseEvent) => {
        const dx = (moveEvent.clientX - startX) / bounds.width
        const dy = (moveEvent.clientY - startY) / bounds.height
        if (mode === 'move') {
          updateVisualEffect(effect.id, {
            x: Math.max(0, Math.min(1 - initial.width, initial.x + dx)),
            y: Math.max(0, Math.min(1 - initial.height, initial.y + dy)),
          })
          return
        }
        let width = Math.max(0.01, Math.min(1 - initial.x, initial.width + dx))
        let height = Math.max(0.01, Math.min(1 - initial.y, initial.height + dy))
        if (effect.shape === 'square' || effect.shape === 'circle') {
          const side = Math.max(0.01, Math.min(width, height, 1 - initial.x, 1 - initial.y))
          width = side
          height = side
        }
        updateVisualEffect(effect.id, { width, height })
      }
      const up = () => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    }

    useEffect(() => {
      const background = frameStyles.background
      if ((background.type === 'image' || background.type === 'wallpaper') && background.imageUrl) {
        const img = new Image()
        img.onload = () => {
          setBgImage(img)
        }
        const finalUrl = background.imageUrl.startsWith('blob:')
          ? background.imageUrl
          : `media://${background.imageUrl}`
        img.src = finalUrl
      } else {
        setBgImage(null)
      }
    }, [frameStyles.background])

    // Keep each imported clip's hidden <video> in sync with the playhead.
    // Playing clips run freely and are only re-seeked on noticeable drift;
    // while paused or scrubbing they are seeked exactly so frames are stable.
    const syncClipVideos = useCallback(
      (playing: boolean, time: number) => {
        for (const clip of videoClips) {
          const element = clipVideoRefs.current.get(clip.id)
          if (!element) continue
          const active = time >= clip.startTime && time < clip.startTime + clip.duration
          if (!active) {
            if (!element.paused) element.pause()
            continue
          }
          const sourceDuration = clip.sourceDuration || element.duration || 0
          const sourceTime = getClipSourceTime(clip, time, sourceDuration)
          if (playing) {
            if (Math.abs(element.currentTime - sourceTime) > 0.3) element.currentTime = sourceTime
            if (element.paused) void element.play().catch(() => undefined)
          } else {
            if (!element.paused) element.pause()
            if (Math.abs(element.currentTime - sourceTime) > 0.02) element.currentTime = sourceTime
          }
        }
      },
      [videoClips],
    )

    const renderCanvas = useCallback(async () => {
      const canvas = canvasRef.current
      const video = videoRef.current
      const webcamVideo = webcamVideoRef.current
      const state = useEditorStore.getState()
      const ctx = canvas?.getContext('2d')
      if (!canvas || !video || !ctx || !state.videoDimensions.width) {
        if (state.isPlaying) animationFrameId.current = requestAnimationFrame(renderCanvas)
        return
      }
      syncClipVideos(state.isPlaying, video.currentTime)
      const clipLayers: VideoClipLayer[] = []
      for (const clip of state.videoClips) {
        const element = clipVideoRefs.current.get(clip.id)
        if (element && element.readyState >= 2) clipLayers.push({ clip, element })
      }
      await drawScene(
        ctx,
        state,
        video,
        webcamVideo,
        video.currentTime,
        canvas.width,
        canvas.height,
        bgImage,
        clipLayers,
      )
      if (state.isPlaying) {
        animationFrameId.current = requestAnimationFrame(renderCanvas)
      }
    }, [videoRef, bgImage, syncClipVideos])

    useEffect(() => {
      if (isPlaying) {
        animationFrameId.current = requestAnimationFrame(renderCanvas)
      } else {
        renderCanvas()
      }
      return () => {
        if (animationFrameId.current) {
          cancelAnimationFrame(animationFrameId.current)
        }
      }
    }, [
      isPlaying,
      currentTime,
      renderCanvas,
      canvasDimensions,
      frameStyles,
      cameraMotions,
      isWebcamVisible,
      webcamPosition,
      webcamStyles,
      videoDimensions,
      cursorStyles,
      cursorBitmapsToRender,
      videoClips,
    ])

    useEffect(() => {
      const video = videoRef.current
      if (!video) return
      const webcamVideo = webcamVideoRef.current
      if (isPlaying) {
        video.play().catch(console.error)
        webcamVideo?.play().catch(console.error)
      } else {
        video.pause()
        webcamVideo?.pause()
        // When pausing, reset playbackRate to 1 so scrubbing is at normal speed
        video.playbackRate = 1
        if (webcamVideo) webcamVideo.playbackRate = 1
      }
    }, [isPlaying, videoRef])

    // Effect to handle volume and mute state.
    //
    // While the preview's mixer is carrying the recording's audio, the element's own
    // audio is silenced: the file holds both tracks and the element would play one of
    // them, so the first track would otherwise be heard twice. The user's mute still
    // applies on top — it silences the mix, not just the element.
    useEffect(() => {
      const video = videoRef.current
      if (video) {
        video.volume = volume
        video.muted = isMuted || mixerOwnsAudio
      }
    }, [volume, isMuted, mixerOwnsAudio, videoRef])

    useEffect(() => {
      const video = videoRef.current
      if (!video) return
      if (isPlaying && isCurrentlyCut) {
        const allCutRegions = Object.values(useEditorStore.getState().cutRegions)
        const activeCutRegion = allCutRegions.find(
          (r) => video.currentTime >= r.startTime && video.currentTime < r.startTime + r.duration,
        )
        if (activeCutRegion) {
          video.currentTime = activeCutRegion.startTime + activeCutRegion.duration
          setCurrentTime(video.currentTime)
        }
      }
    }, [isCurrentlyCut, isPlaying, videoRef, setCurrentTime])

    const handleTimeUpdate = () => {
      if (!videoRef.current) return
      const video = videoRef.current
      const newTime = video.currentTime

      // Handle speed regions
      const activeSpeedRegion = Object.values(speedRegions).find(
        (r) => newTime >= r.startTime && newTime < r.startTime + r.duration,
      )
      video.playbackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1

      const endTrimRegion = Object.values(cutRegions).find((r) => r.trimType === 'end')
      if (endTrimRegion && newTime >= endTrimRegion.startTime) {
        video.currentTime = endTrimRegion.startTime
        video.pause()
      }
      if (webcamVideoRef.current) {
        webcamVideoRef.current.currentTime = newTime
        webcamVideoRef.current.playbackRate = video.playbackRate // Sync webcam speed
      }
      setCurrentTime(newTime)
    }

    const handleLoadedMetadata = () => {
      const video = videoRef.current
      if (video) {
        setDuration(video.duration)
        setVideoDimensions({ width: video.videoWidth, height: video.videoHeight })

        // Check for audio tracks using type-safe checks
        const hasAudioTracks = video.audioTracks && video.audioTracks.length > 0
        const hasMozAudio = 'mozHasAudio' in video && video.mozHasAudio === true
        const hasWebkitAudio = 'webkitHasAudio' in video && video.webkitHasAudio === true

        setHasAudioTrack(!!(hasAudioTracks || hasMozAudio || hasWebkitAudio))

        // Chromium implements none of the checks above, so recorded mic audio
        // was always reported as missing (and then dropped on export). Ask
        // FFmpeg whether the file really has an audio stream.
        const { videoPath } = useEditorStore.getState()
        if (videoPath && !(hasAudioTracks || hasMozAudio || hasWebkitAudio)) {
          window.electronAPI
            .videoHasAudio(videoPath)
            .then((hasAudio) => setHasAudioTrack(hasAudio))
            .catch((err) => console.warn('[Preview] Audio stream probe failed:', err))
        }

        const timeFromStore = useEditorStore.getState().currentTime

        const onSeekComplete = () => {
          renderCanvas()
          video.removeEventListener('seeked', onSeekComplete)
        }

        video.addEventListener('seeked', onSeekComplete)
        // Restore the video's time from the store to prevent rewinding
        video.currentTime = timeFromStore
      }
    }

    const handleWebcamLoadedMetadata = useCallback(() => {
      const mainVideo = videoRef.current
      const webcamVideo = webcamVideoRef.current
      if (mainVideo && webcamVideo) {
        webcamVideo.currentTime = mainVideo.currentTime
        if (mainVideo.paused) {
          webcamVideo.pause()
        } else {
          webcamVideo.play().catch(console.error)
        }
      }
    }, [videoRef])

    const handleScrub = (value: number) => {
      if (videoRef.current) {
        videoRef.current.currentTime = value
        setCurrentTime(value)
      }
    }

    const handleRewind = () => {
      const startTrimRegion = Object.values(cutRegions).find((r) => r.trimType === 'start')
      const rewindTime = startTrimRegion ? startTrimRegion.startTime + startTrimRegion.duration : 0
      setCurrentTime(rewindTime)
      if (videoRef.current) {
        videoRef.current.currentTime = rewindTime
      }
    }

    // The caption under the playhead. The cues are in export time — they are what the
    // sidecar file will carry — and the preview plays the recording, so the playhead
    // has to be mapped through the timeline before it can be compared with them.
    const exportTimeAtPlayhead = mapSourceTimeToExportTime(currentTime, duration, cutRegions, speedRegions)
    const activeCue = subtitleCues.find((cue) => exportTimeAtPlayhead >= cue.start && exportTimeAtPlayhead < cue.end)

    return (
      <div
        ref={previewContainerRef}
        className={cn(
          'w-full h-full flex flex-col items-center justify-center relative',
          isPreviewFullScreen && isCursorHidden && 'cursor-none',
        )}
      >
        <div
          id="preview-container"
          className="transition-all duration-300 ease-out flex items-center justify-center w-full flex-1 min-h-0"
        >
          {videoUrl ? (
            // The wrapper hugs the canvas so the caption sits over the picture and not
            // over the empty space around it. `container-type` lets the caption's size
            // follow the preview's, which is the only way it stays legible when the
            // window is resized.
            <div className="relative flex items-center justify-center" style={{ containerType: 'inline-size' }}>
              <canvas
                ref={canvasRef}
                width={canvasDimensions.width}
                height={canvasDimensions.height}
                style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }}
                className="rounded-pv ring-1 ring-line shadow-[var(--sa-preview-shadow)]"
              />
              {activeCue && (
                <div
                  className="pointer-events-none absolute inset-x-0 bottom-[6%] flex justify-center px-[4%]"
                  data-preview-caption
                >
                  <span
                    className="rounded-[4px] bg-black/70 px-2 py-1 text-center leading-snug text-white"
                    style={{ fontSize: 'clamp(11px, 2.6cqw, 26px)' }}
                  >
                    {activeCue.text}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-pv border border-dashed border-line text-muted">
              <Movie size={32} strokeWidth={ICON_STROKE} className="text-muted" />
              <div className="space-y-0.5 text-center">
                <p className="text-title font-semibold text-fg">No project loaded</p>
                <p className="text-sm text-muted">Load a project to begin editing</p>
              </div>
            </div>
          )}
        </div>

        {videoUrl && effectOverlayBounds.width > 0 && effectOverlayBounds.height > 0 && (
          <div
            className="absolute z-20"
            style={{
              left: effectOverlayBounds.left,
              top: effectOverlayBounds.top,
              width: effectOverlayBounds.width,
              height: effectOverlayBounds.height,
              pointerEvents: 'none',
            }}
            aria-label="Visual effects positioning overlay"
          >
            {visualEffects
              .filter(
                (effect) =>
                  selectedRegionId === effect.id ||
                  (currentTime >= effect.startTime && currentTime < effect.startTime + effect.duration),
              )
              .map((effect) => {
                const selected = selectedRegionId === effect.id
                const shapeStyle: React.CSSProperties = {
                  position: 'absolute',
                  left: `${effect.x * 100}%`,
                  top: `${effect.y * 100}%`,
                  width: `${effect.width * 100}%`,
                  height: `${effect.height * 100}%`,
                  border: `${selected ? 2 : 1}px ${selected ? 'solid' : 'dashed'} ${effect.color}`,
                  backgroundColor: selected ? `${effect.color}22` : `${effect.color}0c`,
                  borderRadius: effect.shape === 'circle' ? '9999px' : '2px',
                  clipPath:
                    effect.shape === 'freeform'
                      ? `polygon(${effect.points.map((point) => `${point.x * 100}% ${point.y * 100}%`).join(',')})`
                      : undefined,
                  boxSizing: 'border-box',
                  pointerEvents: 'auto',
                  cursor: 'move',
                  touchAction: 'none',
                }
                return (
                  <div
                    key={effect.id}
                    role="button"
                    tabIndex={selected ? 0 : -1}
                    aria-label={`Move ${effect.kind} effect`}
                    onMouseDown={(event) => beginEffectTransform(event, effect, 'move')}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') setSelectedRegionId(effect.id)
                    }}
                    style={shapeStyle}
                    title={`${effect.kind} — drag to move${selected ? ', use corner handle to resize' : ''}`}
                  >
                    <span
                      className="absolute -left-px -top-5 rounded px-1.5 py-0.5 text-label font-semibold capitalize text-white shadow"
                      style={{ backgroundColor: effect.color, maxWidth: 120, overflow: 'hidden', whiteSpace: 'nowrap' }}
                    >
                      {effect.kind}
                    </span>
                    {selected && (
                      <span
                        role="presentation"
                        onMouseDown={(event) => beginEffectTransform(event, effect, 'resize')}
                        className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 rounded-ctl border-2 border-white shadow-md"
                        style={{ backgroundColor: effect.color, cursor: 'nwse-resize', pointerEvents: 'auto' }}
                      />
                    )}
                  </div>
                )
              })}
          </div>
        )}

        {/* "Mask" chip (DESIGN_SPEC §5): shown while a masking/visual effect is active at
            the playhead. Small panel-coloured chip with a 1px line. */}
        {videoUrl && maskActive && (
          <span className="pointer-events-none absolute left-3 top-3 z-20 rounded-ctl border border-line bg-panel px-2 py-1 text-sm text-muted">
            Mask
          </span>
        )}

        <video
          ref={videoRef}
          src={videoUrl || undefined}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          style={{ display: 'none' }}
        />
        {webcamVideoUrl && (
          <video
            ref={webcamVideoRef}
            src={webcamVideoUrl}
            muted
            playsInline
            onLoadedMetadata={handleWebcamLoadedMetadata}
            style={{ display: 'none' }}
          />
        )}
        {/* Hidden decoders for imported video clips — composited onto the canvas by drawScene. */}
        {videoClips.map((clip) => (
          <video
            key={clip.id}
            ref={(element) => {
              if (element) clipVideoRefs.current.set(clip.id, element)
              else clipVideoRefs.current.delete(clip.id)
            }}
            src={mediaUrl(clip.filePath)}
            muted
            playsInline
            preload="auto"
            style={{ display: 'none' }}
          />
        ))}

        {/* Control bar */}
        {videoUrl && (
          <div
            className={cn(
              'w-full mt-3 transition-opacity duration-200',
              isPreviewFullScreen && 'absolute bottom-6 left-0 right-0 mx-auto px-4 z-10',
              isPreviewFullScreen && !isControlBarVisible && 'opacity-0 pointer-events-none',
            )}
            style={{ maxWidth: isPreviewFullScreen ? 'min(90%, 800px)' : '100%' }}
          >
            {/* Transport (DESIGN_SPEC §5): play circle, time, progress track, duration. */}
            <div
              className="mx-auto flex max-w-full items-center gap-3 rounded-pv border border-line bg-panel px-3 py-2"
              style={{
                width: isPreviewFullScreen ? 'auto' : controlBarWidth,
                minWidth: isPreviewFullScreen ? 'auto' : 420,
              }}
            >
              <Button
                variant="secondary"
                size="icon"
                onClick={togglePlay}
                title="Play/Pause (Space)"
                aria-label="Play or pause"
                className="h-8 w-8 shrink-0 rounded-full"
              >
                {isPlaying ? (
                  <PlayerPause size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                ) : (
                  <PlayerPlay className="ml-0.5" size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRewind}
                title="Rewind to Start"
                aria-label="Rewind to start"
                className="h-8 w-8 shrink-0"
              >
                <RewindIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onSeekFrame('prev')}
                title="Previous Frame (J)"
                aria-label="Previous frame"
                className="h-8 w-8 shrink-0"
              >
                <PlayerSkipBack size={ICON_SIZE} strokeWidth={ICON_STROKE} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onSeekFrame('next')}
                title="Next Frame (K)"
                aria-label="Next frame"
                className="h-8 w-8 shrink-0"
              >
                <PlayerSkipForward size={ICON_SIZE} strokeWidth={ICON_STROKE} />
              </Button>

              <span className="ml-1 shrink-0 font-mono text-sm tabular-nums text-fg">
                {formatTime(currentTime, true)}
              </span>
              <Slider
                min={0}
                max={duration}
                step={0.01}
                value={currentTime}
                onChange={handleScrub}
                disabled={duration === 0}
                className="min-w-0 flex-1"
              />
              <span className="shrink-0 font-mono text-sm tabular-nums text-muted">{formatTime(duration, true)}</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={togglePreviewFullScreen}
                title="Fullscreen (F)"
                aria-label="Toggle fullscreen"
                className="h-8 w-8 shrink-0"
              >
                {isPreviewFullScreen ? (
                  <ExitFullscreenIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                ) : (
                  <FullscreenIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    )
  },
)
Preview.displayName = 'Preview'
