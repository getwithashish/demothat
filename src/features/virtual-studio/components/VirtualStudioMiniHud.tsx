import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  PlayerPlay,
  PlayerPause,
  Microphone,
  MicrophoneOff,
  Minus,
  Video,
  Broadcast,
  GripHorizontal,
  FlipVertical,
  Headphones,
  HeadphonesOff,
} from 'tabler-icons-react'
import { useEditorStore } from '../../../store/editorStore'
import { ICON_SIZE, ICON_STROKE } from '../../../components/ui/icons'
import { Button } from '../../../components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../components/ui/tooltip'
import { cn } from '../../../lib/utils'
import { virtualStudioStreamer } from '../services/virtual-studio-streamer'

export const VirtualStudioMiniHud: React.FC = () => {
  const {
    isVirtualStudioActive,
    isMiniHudVisible,
    activeSource,
    isMicMuted,
    isPlaying,
    enableCamera,
    selectedCameraId,
    isMirrored,
    isLocalAudioMonitoringEnabled,
  } = useEditorStore(
    useShallow((state) => ({
      isVirtualStudioActive: state.isVirtualStudioActive,
      isMiniHudVisible: state.isMiniHudVisible,
      activeSource: state.activeSource,
      isMicMuted: state.isMicMuted,
      isPlaying: state.isPlaying,
      enableCamera: state.enableCamera,
      selectedCameraId: state.selectedCameraId,
      isMirrored: state.isMirrored,
      isLocalAudioMonitoringEnabled: state.isLocalAudioMonitoringEnabled,
    })),
  )

  const { togglePlay, toggleMicMute, setMiniHudVisible, pushToast, toggleMirror, toggleLocalAudioMonitoring } =
    useEditorStore.getState()

  // Video element for live outgoing webcam feed
  const webcamVideoRef = useRef<HTMLVideoElement>(null)
  const [streamError, setStreamError] = useState(false)
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState<string | null>(null)

  // Floating draggable position
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const isDraggingRef = useRef(false)
  const dragStartOffsetRef = useRef({ x: 0, y: 0 })
  const hudRef = useRef<HTMLDivElement>(null)

  // Subscribe to live outgoing thumbnail preview frames from streamer
  useEffect(() => {
    if (window.electronAPI?.virtualStudio?.onPreviewFrame) {
      const unsub = window.electronAPI.virtualStudio.onPreviewFrame((dataUrl) => {
        setThumbnailDataUrl(dataUrl)
      })
      return () => {
        unsub?.()
      }
    }
  }, [])

  // Handle webcam stream when activeSource === 'webcam'
  useEffect(() => {
    let localStream: MediaStream | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const videoElement = webcamVideoRef.current

    if (isVirtualStudioActive && activeSource === 'webcam' && enableCamera && isMiniHudVisible) {
      // Reuse streamer webcam stream if available to avoid duplicate hardware device locks on /dev/video0
      const checkStreamer = () => {
        const streamerStream = virtualStudioStreamer.getWebcamStream?.()
        if (streamerStream && videoElement) {
          videoElement.srcObject = streamerStream
          setStreamError(false)
          return true
        }
        return false
      }

      if (checkStreamer()) return

      // Delay fallback getUserMedia briefly so streamer has time to provide shared hardware stream
      retryTimer = setTimeout(() => {
        if (checkStreamer()) return

        const constraints: MediaStreamConstraints = {
          video: selectedCameraId ? { deviceId: { exact: selectedCameraId } } : true,
          audio: false,
        }

        navigator.mediaDevices
          ?.getUserMedia(constraints)
          .then((stream) => {
            localStream = stream
            if (videoElement) {
              videoElement.srcObject = stream
            }
            setStreamError(false)
          })
          .catch(() => {
            setStreamError(true)
          })
      }, 300)
    }

    return () => {
      if (retryTimer !== null) clearTimeout(retryTimer)
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop())
      }
      if (videoElement) {
        videoElement.srcObject = null
      }
    }
  }, [isVirtualStudioActive, activeSource, enableCamera, selectedCameraId, isMiniHudVisible])

  // Dragging handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    isDraggingRef.current = true
    const rect = hudRef.current?.getBoundingClientRect()
    if (rect) {
      dragStartOffsetRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      }
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return
    const newX = Math.max(12, Math.min(window.innerWidth - 300, e.clientX - dragStartOffsetRef.current.x))
    const newY = Math.max(12, Math.min(window.innerHeight - 200, e.clientY - dragStartOffsetRef.current.y))
    setPosition({ x: newX, y: newY })
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Ignore release capture error
    }
  }

  // Minimize handler
  const handleMinimize = useCallback(() => {
    setMiniHudVisible(false)
    window.electronAPI?.virtualStudio?.updateStatus({ isMiniHudVisible: false })
    pushToast({
      message: 'Mini-HUD minimized. Restore it anytime from the Virtual Studio header pill or System Tray.',
    })
  }, [setMiniHudVisible, pushToast])

  // Mirror toggle handler
  const handleToggleMirror = useCallback(async () => {
    if (window.electronAPI?.virtualStudio?.triggerAction) {
      await window.electronAPI.virtualStudio.triggerAction('toggle-mirror')
    } else {
      toggleMirror()
    }
  }, [toggleMirror])

  // Local audio monitor toggle handler
  const handleToggleAudioMonitor = useCallback(async () => {
    if (window.electronAPI?.virtualStudio?.triggerAction) {
      await window.electronAPI.virtualStudio.triggerAction('toggle-audio-monitor')
    } else {
      toggleLocalAudioMonitoring()
    }
  }, [toggleLocalAudioMonitoring])

  if (!isVirtualStudioActive || !isMiniHudVisible) {
    return null
  }

  const isWebcamActive = activeSource === 'webcam'

  return (
    <aside
      ref={hudRef}
      aria-label="Virtual Studio Mini-HUD"
      className={cn(
        'fixed z-40 w-72 select-none overflow-hidden rounded-pv border border-line bg-panel p-3',
        'shadow-[var(--sa-preview-shadow)] transition-shadow duration-150',
      )}
      style={
        position
          ? { left: `${position.x}px`, top: `${position.y}px`, bottom: 'auto', right: 'auto' }
          : { right: '20px', bottom: '24px' }
      }
    >
      {/* Draggable header bar */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="flex cursor-grab items-center justify-between pb-2 border-b border-line active:cursor-grabbing"
      >
        <div className="flex items-center gap-2">
          <GripHorizontal size={14} strokeWidth={ICON_STROKE} className="text-muted" />
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-danger">ON AIR</span>
          </div>
          <span className="rounded bg-ctl px-1.5 py-0.5 text-[11px] text-muted font-medium">
            {isWebcamActive ? 'Webcam' : 'Canvas'}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Mirror toggle button */}
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleToggleMirror}
                  className={cn(
                    'h-6 w-6 rounded text-muted hover:bg-ctl hover:text-fg',
                    isMirrored && 'text-accent bg-ctl',
                  )}
                  aria-label="Toggle Mirroring"
                  title={isMirrored ? 'Mirroring ON (Camera & HUD flipped)' : 'Mirroring OFF (Normal)'}
                >
                  <FlipVertical size={14} strokeWidth={ICON_STROKE} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <span className="text-[11px]">
                  {isMirrored ? 'Mirroring ON (Camera & HUD flipped)' : 'Mirroring OFF (Normal)'}
                </span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Direct Minimize button [-] */}
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleMinimize}
                  className="h-6 w-6 rounded text-muted hover:bg-ctl hover:text-fg"
                  aria-label="Minimize Mini-HUD"
                  title="Minimize Mini-HUD"
                >
                  <Minus size={14} strokeWidth={ICON_STROKE} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <span className="text-[11px]">Minimize Mini-HUD</span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Outgoing feed preview thumbnail */}
      <div className="relative mt-2.5 aspect-video w-full overflow-hidden rounded-ctl border border-line bg-stage">
        {thumbnailDataUrl ? (
          <img src={thumbnailDataUrl} alt="Outgoing Feed" className="h-full w-full object-cover" />
        ) : isWebcamActive ? (
          <>
            <video
              ref={webcamVideoRef}
              autoPlay
              playsInline
              muted
              className={cn('h-full w-full object-cover', isMirrored && '-scale-x-100')}
            />
            {streamError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-stage text-muted">
                <Video size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                <span className="text-[11px]">Webcam Feed</span>
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-stage p-2 text-center">
            <Broadcast size={22} strokeWidth={ICON_STROKE} className="text-accent animate-pulse" />
            <div className="text-[11px] font-medium text-fg">Canvas Outgoing Feed</div>
            <span className="text-[11px] text-muted">{isPlaying ? 'Streaming demo playback' : 'Playback paused'}</span>
          </div>
        )}

        {/* Source indicator chip overlay */}
        <div className="absolute bottom-1.5 left-1.5 rounded border border-line/50 bg-panel/90 px-1.5 py-0.5 text-[11px] font-mono text-fg shadow-sm backdrop-blur-sm">
          {isWebcamActive ? 'LIVE WEBCAM' : 'CANVAS STREAM'}
        </div>
      </div>

      {/* Control Action Bar */}
      <div className="mt-3 flex items-center justify-between gap-2">
        {/* Play / Pause toggle */}
        <Button
          variant={isPlaying ? 'primary' : 'secondary'}
          size="sm"
          onClick={togglePlay}
          className="flex-1 h-8 gap-1.5 text-xs font-medium"
          title={
            isPlaying ? 'Pause Demo (Auto-return to physical webcam)' : 'Resume Demo (Auto-switch to canvas preview)'
          }
        >
          {isPlaying ? (
            <>
              <PlayerPause size={14} strokeWidth={ICON_STROKE} />
              <span>Pause Demo</span>
            </>
          ) : (
            <>
              <PlayerPlay size={14} strokeWidth={ICON_STROKE} />
              <span>Resume Demo</span>
            </>
          )}
        </Button>

        {/* Mic mute/unmute toggle */}
        <Button
          variant={isMicMuted ? 'destructive' : 'secondary'}
          size="sm"
          onClick={toggleMicMute}
          className={cn(
            'h-8 px-2.5 gap-1.5 text-xs font-medium transition-colors',
            isMicMuted && 'border border-danger/40 bg-danger/15 text-danger hover:bg-danger/25',
          )}
          title={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {isMicMuted ? (
            <>
              <MicrophoneOff size={14} strokeWidth={ICON_STROKE} />
              <span className="text-[11px]">Muted</span>
            </>
          ) : (
            <>
              <Microphone size={14} strokeWidth={ICON_STROKE} />
              <span className="text-[11px]">Mic On</span>
            </>
          )}
        </Button>

        {/* Local Audio Monitor toggle */}
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleToggleAudioMonitor}
                className={cn(
                  'h-8 px-2.5 gap-1.5 text-xs font-medium transition-colors',
                  !isLocalAudioMonitoringEnabled &&
                    'border border-warning/40 bg-warning/15 text-warning hover:bg-warning/25',
                )}
                aria-label="Toggle Local Audio Monitoring"
                title={
                  isLocalAudioMonitoringEnabled
                    ? 'Speaker monitoring ON (You hear playback)'
                    : 'Speaker monitoring OFF (Only meeting attendees hear playback)'
                }
              >
                {isLocalAudioMonitoringEnabled ? (
                  <Headphones size={14} strokeWidth={ICON_STROKE} />
                ) : (
                  <HeadphonesOff size={14} strokeWidth={ICON_STROKE} />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <span className="text-[11px]">
                {isLocalAudioMonitoringEnabled
                  ? 'Speaker monitoring ON (You hear playback)'
                  : 'Speaker monitoring OFF (Only meeting attendees hear playback)'}
              </span>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </aside>
  )
}
