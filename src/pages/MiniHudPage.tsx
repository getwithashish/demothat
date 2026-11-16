import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import {
  PlayerPlay,
  PlayerPause,
  Microphone,
  MicrophoneOff,
  Minus,
  Video,
  Broadcast,
  GripHorizontal,
  FlipHorizontal,
  Headphones,
  HeadphonesOff,
} from 'tabler-icons-react'
import { ICON_SIZE, ICON_STROKE } from '../components/ui/icons'
import { Button } from '../components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip'
import { cn } from '../lib/utils'
import type { VirtualStudioStatus } from '../../shared/virtual-camera-types'

export function MiniHudPage() {
  const [status, setStatus] = useState<Partial<VirtualStudioStatus>>({
    isStreaming: false,
    activeSource: 'webcam',
    isMicMuted: false,
    isPlaying: false,
    isCameraActive: true,
    isMicActive: true,
    isMirrored: false,
    isLocalAudioMonitoringEnabled: true,
  })

  const [thumbnailDataUrl, setThumbnailDataUrl] = useState<string | null>(null)
  const webcamVideoRef = useRef<HTMLVideoElement>(null)
  const [cameraStreamError, setCameraStreamError] = useState(false)

  // Configure surface for transparency in tokens.css
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-surface', 'mini-hud')
    return () => {
      document.documentElement.removeAttribute('data-surface')
    }
  }, [])

  // Sync studio status across windows via Electron IPC
  useEffect(() => {
    if (window.electronAPI?.virtualStudio?.getStatus) {
      window.electronAPI.virtualStudio
        .getStatus()
        .then((s) => {
          if (s) setStatus(s)
        })
        .catch(() => {})
    }

    if (window.electronAPI?.virtualStudio?.onStatusChange) {
      const unsub = window.electronAPI.virtualStudio.onStatusChange((newStatus) => {
        setStatus(newStatus)
      })
      return () => {
        unsub?.()
      }
    }
  }, [])

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

  const isWebcam = status.activeSource === 'webcam'
  const isCameraActive = status.isCameraActive ?? true
  const webcamDeviceId = status.webcamDeviceId

  // Manage physical webcam feed when source is webcam
  useEffect(() => {
    let localStream: MediaStream | null = null
    const videoEl = webcamVideoRef.current

    if (isWebcam && isCameraActive) {
      const constraints: MediaStreamConstraints = {
        video: webcamDeviceId ? { deviceId: { exact: webcamDeviceId } } : true,
        audio: false,
      }

      navigator.mediaDevices
        ?.getUserMedia(constraints)
        .then((stream) => {
          localStream = stream
          if (videoEl) {
            videoEl.srcObject = stream
          }
          setCameraStreamError(false)
        })
        .catch(() => {
          setCameraStreamError(true)
        })
    }

    return () => {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop())
      }
      if (videoEl) {
        videoEl.srcObject = null
      }
    }
  }, [isWebcam, isCameraActive, webcamDeviceId])

  // Minimize HUD window action
  const handleMinimize = useCallback(async () => {
    if (window.electronAPI?.virtualStudio?.triggerAction) {
      await window.electronAPI.virtualStudio.triggerAction('toggle-hud')
    }
  }, [])

  // Play/Pause demo action
  const handleTogglePlay = useCallback(async () => {
    if (window.electronAPI?.virtualStudio?.triggerAction) {
      await window.electronAPI.virtualStudio.triggerAction('toggle-playback')
    }
  }, [])

  // Mic mute action
  const handleToggleMicMute = useCallback(async () => {
    if (window.electronAPI?.virtualStudio?.triggerAction) {
      await window.electronAPI.virtualStudio.triggerAction('toggle-mic-mute')
    }
  }, [])

  // Mirror toggle action
  const handleToggleMirror = useCallback(async () => {
    if (window.electronAPI?.virtualStudio?.triggerAction) {
      await window.electronAPI.virtualStudio.triggerAction('toggle-mirror')
    }
  }, [])

  // Local audio monitor toggle action
  const handleToggleAudioMonitor = useCallback(async () => {
    if (window.electronAPI?.virtualStudio?.triggerAction) {
      await window.electronAPI.virtualStudio.triggerAction('toggle-audio-monitor')
    }
  }, [])

  const isPlaying = status.isPlaying ?? false
  const isMicMuted = status.isMicMuted ?? false
  const isMirrored = status.isMirrored ?? false
  const isLocalAudioMonitoringEnabled = status.isLocalAudioMonitoringEnabled ?? true

  return (
    <main className="h-screen w-screen overflow-hidden p-1.5 flex flex-col justify-between bg-transparent select-none">
      <div className="flex h-full w-full flex-col justify-between rounded-pv border border-line bg-panel p-2 shadow-[var(--sa-preview-shadow)] text-fg">
        {/* Draggable header bar using native OS window drag */}
        <header
          style={{ WebkitAppRegion: 'drag' }}
          className="flex h-6 shrink-0 cursor-grab items-center justify-between pb-1.5 border-b border-line active:cursor-grabbing"
        >
          <div className="flex items-center gap-1.5">
            <GripHorizontal size={13} strokeWidth={ICON_STROKE} className="text-muted shrink-0" />
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-danger">ON AIR</span>
            <span className="rounded bg-ctl px-1 py-0.2 text-[11px] text-muted font-medium">
              {isWebcam ? 'Webcam' : 'Canvas'}
            </span>
          </div>

          <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' }}>
            {/* Mirror toggle button */}
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleToggleMirror}
                    className={cn(
                      'h-5 w-5 rounded text-muted hover:bg-ctl hover:text-fg',
                      isMirrored && 'text-accent bg-ctl',
                    )}
                    aria-label="Toggle Mirroring"
                    title={isMirrored ? 'Mirroring ON (Camera & HUD flipped)' : 'Mirroring OFF (Normal)'}
                  >
                    <FlipHorizontal size={13} strokeWidth={ICON_STROKE} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <span className="text-[11px]">
                    {isMirrored ? 'Mirroring ON (Camera & HUD flipped)' : 'Mirroring OFF (Normal)'}
                  </span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Minimize button [-] */}
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleMinimize}
                    className="h-5 w-5 rounded text-muted hover:bg-ctl hover:text-fg"
                    aria-label="Minimize Mini-HUD"
                    title="Minimize Mini-HUD"
                  >
                    <Minus size={13} strokeWidth={ICON_STROKE} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <span className="text-[11px]">Minimize Mini-HUD</span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </header>

        {/* Outgoing feed preview thumbnail */}
        <div className="relative my-1 flex-1 min-h-0 w-full overflow-hidden rounded-ctl border border-line bg-stage">
          {thumbnailDataUrl ? (
            <img src={thumbnailDataUrl} alt="Outgoing Feed" className="h-full w-full object-cover" />
          ) : isWebcam ? (
            <>
              <video
                ref={webcamVideoRef}
                autoPlay
                playsInline
                muted
                className={cn('h-full w-full object-cover', isMirrored && '-scale-x-100')}
              />
              {cameraStreamError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-stage text-muted">
                  <Video size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                  <span className="text-[11px]">Webcam Feed</span>
                </div>
              )}
            </>
          ) : thumbnailDataUrl ? (
            <img src={thumbnailDataUrl} alt="Outgoing Canvas Preview" className="h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-stage p-1.5 text-center">
              <Broadcast size={20} strokeWidth={ICON_STROKE} className="text-accent animate-pulse" />
              <div className="text-[11px] font-medium text-fg">Canvas Outgoing Feed</div>
              <span className="text-[11px] text-muted">
                {isPlaying ? 'Streaming demo playback' : 'Playback paused'}
              </span>
            </div>
          )}

          {/* Source indicator chip */}
          <div className="absolute bottom-1 left-1 rounded border border-line/50 bg-panel/90 px-1 py-0.2 text-[11px] font-mono text-fg shadow-sm backdrop-blur-sm">
            {isWebcam ? 'LIVE WEBCAM' : 'CANVAS STREAM'}
          </div>
        </div>

        {/* Control Action Bar */}
        <footer
          style={{ WebkitAppRegion: 'no-drag' }}
          className="flex h-7 shrink-0 items-center justify-between gap-1.5"
        >
          <Button
            variant={isPlaying ? 'primary' : 'secondary'}
            size="sm"
            onClick={handleTogglePlay}
            className="flex-1 h-7 gap-1 text-[11px] font-medium px-2"
            title={
              isPlaying ? 'Pause Demo (Auto-return to physical webcam)' : 'Resume Demo (Auto-switch to canvas preview)'
            }
          >
            {isPlaying ? (
              <>
                <PlayerPause size={13} strokeWidth={ICON_STROKE} />
                <span>Pause Demo</span>
              </>
            ) : (
              <>
                <PlayerPlay size={13} strokeWidth={ICON_STROKE} />
                <span>Resume Demo</span>
              </>
            )}
          </Button>

          <Button
            variant={isMicMuted ? 'destructive' : 'secondary'}
            size="sm"
            onClick={handleToggleMicMute}
            className={cn(
              'h-7 px-2 gap-1 text-[11px] font-medium transition-colors',
              isMicMuted && 'border border-danger/40 bg-danger/15 text-danger hover:bg-danger/25',
            )}
            title={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMicMuted ? (
              <>
                <MicrophoneOff size={13} strokeWidth={ICON_STROKE} />
                <span>Muted</span>
              </>
            ) : (
              <>
                <Microphone size={13} strokeWidth={ICON_STROKE} />
                <span>Mic On</span>
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
                    'h-7 px-2 gap-1 text-[11px] font-medium transition-colors',
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
                    <Headphones size={13} strokeWidth={ICON_STROKE} />
                  ) : (
                    <HeadphonesOff size={13} strokeWidth={ICON_STROKE} />
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
        </footer>
      </div>
    </main>
  )
}
