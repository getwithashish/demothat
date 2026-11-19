import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Broadcast,
  Video,
  VideoOff,
  Microphone,
  MicrophoneOff,
  AlertTriangle,
  Check,
  Volume,
  Volume3,
  ChevronDown,
  Loader2,
  FlipVertical,
} from 'tabler-icons-react'
import { useEditorStore } from '../../../store/editorStore'
import { ICON_SIZE, ICON_STROKE } from '../../../components/ui/icons'
import { Button } from '../../../components/ui/button'
import { Switch } from '../../../components/ui/switch'
import { Slider } from '../../../components/ui/slider'
import { cn } from '../../../lib/utils'

interface MediaDeviceInfoItem {
  deviceId: string
  label: string
}

export const VirtualStudioHeaderPill: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfoItem[]>([])
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfoItem[]>([])

  const {
    isVirtualStudioActive,
    enableCamera,
    enableMic,
    activeSource,
    isMicMuted,
    isMiniHudVisible,
    isLocalAudioMonitoringEnabled,
    localMonitoringVolume,
    isMirrored,
    selectedCameraId,
    selectedMicId,
    cameraDriverInstalled,
    micDriverInstalled,
    isDriverInstalling,
    studioError,
  } = useEditorStore(
    useShallow((state) => ({
      isVirtualStudioActive: state.isVirtualStudioActive,
      enableCamera: state.enableCamera,
      enableMic: state.enableMic,
      activeSource: state.activeSource,
      isMicMuted: state.isMicMuted,
      isMiniHudVisible: state.isMiniHudVisible,
      isLocalAudioMonitoringEnabled: state.isLocalAudioMonitoringEnabled,
      localMonitoringVolume: state.localMonitoringVolume,
      isMirrored: state.isMirrored,
      selectedCameraId: state.selectedCameraId,
      selectedMicId: state.selectedMicId,
      cameraDriverInstalled: state.cameraDriverInstalled,
      micDriverInstalled: state.micDriverInstalled,
      isDriverInstalling: state.isDriverInstalling,
      studioError: state.studioError,
    })),
  )

  const {
    setVirtualStudioActive,
    setEnableCamera,
    setEnableMic,
    setMiniHudVisible,
    setLocalAudioMonitoringEnabled,
    setLocalMonitoringVolume,
    setIsMirrored,
    setSelectedCameraId,
    setSelectedMicId,
    setVirtualStudioStatus,
    setDriverInstalling,
    pushToast,
  } = useEditorStore.getState()

  const [sliderVol, setSliderVol] = useState(Math.round((localMonitoringVolume ?? 1.0) * 100))
  const isAdjustingSliderRef = useRef(false)
  const debounceCommitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!isAdjustingSliderRef.current) {
      setSliderVol(Math.round((localMonitoringVolume ?? 1.0) * 100))
    }
  }, [localMonitoringVolume])

  const handleSliderChange = useCallback(
    (val: number) => {
      isAdjustingSliderRef.current = true
      setSliderVol(val)
      setLocalMonitoringVolume(val / 100)

      if (debounceCommitTimeoutRef.current) {
        clearTimeout(debounceCommitTimeoutRef.current)
      }
      debounceCommitTimeoutRef.current = setTimeout(() => {
        isAdjustingSliderRef.current = false
      }, 300)
    },
    [setLocalMonitoringVolume],
  )

  // Enumerate physical camera and microphone devices
  const refreshDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return
      const devices = await navigator.mediaDevices.enumerateDevices()
      const cameras = devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${i + 1}`,
        }))
      const mics = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${i + 1}`,
        }))

      setVideoDevices(cameras)
      setAudioDevices(mics)

      if (cameras.length > 0 && !selectedCameraId) {
        setSelectedCameraId(cameras[0].deviceId)
      }
      if (mics.length > 0 && !selectedMicId) {
        setSelectedMicId(mics[0].deviceId)
      }
    } catch {
      // Permission or enumeration error ignored
    }
  }, [selectedCameraId, selectedMicId, setSelectedCameraId, setSelectedMicId])

  useEffect(() => {
    void refreshDevices()
    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', refreshDevices)
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', refreshDevices)
      }
    }
  }, [refreshDevices])

  // Query driver & studio status from Electron main on mount
  useEffect(() => {
    if (window.electronAPI?.virtualStudio?.getStatus) {
      window.electronAPI.virtualStudio
        .getStatus()
        .then((status) => {
          if (status) {
            setVirtualStudioStatus(status)
          }
        })
        .catch(() => {})
    }

    if (window.electronAPI?.virtualStudio?.onStatusChange) {
      const unsubscribe = window.electronAPI.virtualStudio.onStatusChange((status) => {
        setVirtualStudioStatus(status)
      })
      return () => {
        unsubscribe?.()
      }
    }
  }, [setVirtualStudioStatus])

  // Handle clicking outside the popover to close it
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handlePointerDown)
      document.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  // Master Studio toggle handler
  const handleToggleStudio = (checked: boolean) => {
    setVirtualStudioActive(checked)
    if (checked) {
      setMiniHudVisible(true)
      pushToast({ message: 'Virtual Studio is now On Air' })
    } else {
      pushToast({ message: 'Virtual Studio stopped' })
    }
  }

  // 1-click driver install handler
  const handleInstallDriver = async () => {
    if (!window.electronAPI?.virtualStudio?.installDriver) return
    setDriverInstalling(true)
    try {
      const res = await window.electronAPI.virtualStudio.installDriver()
      if (res.success) {
        pushToast({ message: 'Virtual Camera & Microphone drivers installed successfully' })
      } else {
        pushToast({ message: res.error || 'Driver installation failed' })
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err)
      pushToast({ message: `Driver installation error: ${error}` })
    } finally {
      setDriverInstalling(false)
    }
  }

  const driversMissing = !cameraDriverInstalled || !micDriverInstalled

  // Compute status badge readout
  const renderStatusChip = () => {
    if (!isVirtualStudioActive) {
      return <span className="rounded bg-ctl px-1.5 py-0.5 text-[11px] text-muted font-medium">Off</span>
    }

    if (activeSource === 'canvas') {
      return (
        <span className="flex items-center gap-1.5 rounded border border-accent/40 bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          On Air: Canvas Preview
        </span>
      )
    }

    return (
      <span className="flex items-center gap-1.5 rounded border border-danger/40 bg-danger/15 px-1.5 py-0.5 text-[11px] font-medium text-danger">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
        </span>
        On Air: Webcam
      </span>
    )
  }

  return (
    <div className="relative inline-block text-left" ref={popoverRef} style={{ WebkitAppRegion: 'no-drag' }}>
      {/* Pill trigger in Editor header */}
      <Button
        id="virtual-studio-pill-trigger"
        variant="secondary"
        size="sm"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'h-8 gap-2 border-line bg-ctl text-fg hover:bg-ctl-hover shadow-sm transition-all duration-150',
          isVirtualStudioActive && 'border-accent/40 bg-panel shadow-sm',
        )}
        title="Virtual Studio (Camera & Microphone)"
      >
        <Broadcast
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE}
          className={cn('transition-colors', isVirtualStudioActive ? 'text-accent' : 'text-muted')}
        />
        <span className="hidden sm:inline font-medium text-xs">Virtual Studio</span>
        {renderStatusChip()}
        <ChevronDown
          size={14}
          strokeWidth={ICON_STROKE}
          className={cn('text-muted transition-transform duration-150', isOpen && 'rotate-180')}
        />
      </Button>

      {/* Popover configuration panel */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Virtual Studio Settings"
          className={cn(
            'absolute right-0 top-full mt-2 z-[300] w-84 rounded-ctl border border-line bg-panel p-4 shadow-[var(--sa-popover-shadow)] text-fg',
            'animate-menu-in flex flex-col gap-4 select-none',
          )}
        >
          {/* Header & Master Switch */}
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-ui">Virtual Studio</span>
                {isVirtualStudioActive && (
                  <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[11px] font-medium text-accent">LIVE</span>
                )}
              </div>
              <p className="text-[11px] text-muted">Broadcast live to Zoom, Meet & OBS</p>
            </div>
            <Switch
              id="virtual-studio-master-switch"
              checked={isVirtualStudioActive}
              onCheckedChange={handleToggleStudio}
              aria-label="Toggle Virtual Studio Broadcast"
            />
          </div>

          {/* Missing Driver Alert & 1-click Authorization */}
          {driversMissing && (
            <div className="rounded-ctl border border-line bg-ctl p-3 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <AlertTriangle size={ICON_SIZE} strokeWidth={ICON_STROKE} className="text-danger shrink-0 mt-0.5" />
                <div className="text-[11px] leading-tight">
                  <span className="font-medium text-fg block">Virtual Drivers Required</span>
                  <span className="text-muted">
                    Install system loopback drivers to route high-definition camera & mic audio.
                  </span>
                </div>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={handleInstallDriver}
                disabled={isDriverInstalling}
                className="w-full text-xs h-7 gap-1.5"
              >
                {isDriverInstalling ? (
                  <>
                    <Loader2 size={14} strokeWidth={ICON_STROKE} className="animate-spin" />
                    <span>Authorizing Drivers...</span>
                  </>
                ) : (
                  <>
                    <Check size={14} strokeWidth={ICON_STROKE} />
                    <span>Authorize Virtual Drivers</span>
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Camera and Microphone Channels */}
          <div className="flex flex-col gap-3">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">Output Channels</span>

            {/* Camera channel toggle & device selection */}
            <div className="flex flex-col gap-1.5 rounded-ctl border border-line bg-ctl/50 p-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {enableCamera ? (
                    <Video size={16} strokeWidth={ICON_STROKE} className="text-accent" />
                  ) : (
                    <VideoOff size={16} strokeWidth={ICON_STROKE} className="text-muted" />
                  )}
                  <span className="text-xs font-medium">Virtual Camera</span>
                </div>
                <Switch
                  checked={enableCamera}
                  onCheckedChange={(checked) => {
                    setEnableCamera(checked)
                    window.electronAPI?.virtualStudio?.updateStatus({ isCameraActive: checked })
                  }}
                  aria-label="Enable Virtual Camera"
                />
              </div>

              {enableCamera && (
                <div className="mt-1">
                  <label htmlFor="vs-camera-select" className="block text-[11px] text-muted mb-1">
                    Webcam Source
                  </label>
                  <select
                    id="vs-camera-select"
                    value={selectedCameraId ?? ''}
                    onChange={(e) => setSelectedCameraId(e.target.value || null)}
                    className="w-full rounded-ctl border border-line bg-ctl px-2 py-1 text-xs text-fg hover:bg-ctl-hover focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {videoDevices.length === 0 ? (
                      <option value="">No cameras detected</option>
                    ) : (
                      videoDevices.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              )}
            </div>

            {/* Mic channel toggle & device selection */}
            <div className="flex flex-col gap-1.5 rounded-ctl border border-line bg-ctl/50 p-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {enableMic && !isMicMuted ? (
                    <Microphone size={16} strokeWidth={ICON_STROKE} className="text-accent" />
                  ) : (
                    <MicrophoneOff size={16} strokeWidth={ICON_STROKE} className="text-muted" />
                  )}
                  <span className="text-xs font-medium">Virtual Microphone</span>
                </div>
                <Switch
                  checked={enableMic}
                  onCheckedChange={(checked) => {
                    setEnableMic(checked)
                    window.electronAPI?.virtualStudio?.updateStatus({ isMicActive: checked })
                  }}
                  aria-label="Enable Virtual Microphone"
                />
              </div>

              {enableMic && (
                <div className="mt-1">
                  <label htmlFor="vs-mic-select" className="block text-[11px] text-muted mb-1">
                    Microphone Input
                  </label>
                  <select
                    id="vs-mic-select"
                    value={selectedMicId ?? ''}
                    onChange={(e) => setSelectedMicId(e.target.value || null)}
                    className="w-full rounded-ctl border border-line bg-ctl px-2 py-1 text-xs text-fg hover:bg-ctl-hover focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {audioDevices.length === 0 ? (
                      <option value="">No microphones detected</option>
                    ) : (
                      audioDevices.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Mirror Output toggle switch */}
          <div className="flex items-center justify-between rounded-ctl border border-line bg-ctl/50 p-2.5">
            <div className="flex items-center gap-2">
              <FlipVertical size={16} strokeWidth={ICON_STROKE} className={isMirrored ? 'text-accent' : 'text-muted'} />
              <div>
                <span className="text-xs font-medium block">Mirror Output</span>
                <span className="text-[11px] text-muted block">Flip video horizontally for webcam preview</span>
              </div>
            </div>
            <Switch
              id="vs-mirror-switch"
              checked={isMirrored}
              onCheckedChange={(checked) => {
                setIsMirrored(checked)
                window.electronAPI?.virtualStudio?.updateStatus({ isMirrored: checked })
              }}
              aria-label="Mirror Output"
            />
          </div>

          {/* Local Audio Monitor Volume */}
          <div className="flex flex-col gap-2 rounded-ctl border border-line bg-ctl/50 p-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isLocalAudioMonitoringEnabled ? (
                  <Volume size={16} strokeWidth={ICON_STROKE} className="text-accent" />
                ) : (
                  <Volume3 size={16} strokeWidth={ICON_STROKE} className="text-muted" />
                )}
                <div>
                  <span className="text-xs font-medium block">Audio Monitor</span>
                  <span className="text-[11px] text-muted block">
                    Mute your speakers so only meeting attendees hear demo audio
                  </span>
                </div>
              </div>
              <Switch
                id="vs-audio-monitor-switch"
                checked={isLocalAudioMonitoringEnabled}
                onCheckedChange={(checked) => {
                  setLocalAudioMonitoringEnabled(checked)
                  window.electronAPI?.virtualStudio?.updateStatus({ isLocalAudioMonitoringEnabled: checked })
                }}
                aria-label="Enable Local Audio Monitoring"
              />
            </div>

            {isLocalAudioMonitoringEnabled && (
              <div className="mt-1 px-1">
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={sliderVol}
                  onChange={handleSliderChange}
                  formatValue={(val) => `${val}%`}
                  showValue
                  className="w-full"
                />
              </div>
            )}
          </div>

          {/* Mini-HUD & Display Controls */}
          {isVirtualStudioActive && (
            <div className="flex items-center justify-between border-t border-line pt-3">
              <span className="text-xs text-muted">Mini-HUD window</span>
              <Button
                variant={isMiniHudVisible ? 'secondary' : 'primary'}
                size="sm"
                onClick={async () => {
                  if (window.electronAPI?.virtualStudio?.triggerAction) {
                    await window.electronAPI.virtualStudio.triggerAction('toggle-hud')
                  } else {
                    const next = !isMiniHudVisible
                    setMiniHudVisible(next)
                  }
                }}
                className="h-7 text-xs"
              >
                {isMiniHudVisible ? 'Hide Mini-HUD' : 'Show Mini-HUD'}
              </Button>
            </div>
          )}

          {studioError && (
            <div className="rounded border border-danger/30 bg-danger/10 p-2 text-[11px] text-danger">
              {studioError}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
