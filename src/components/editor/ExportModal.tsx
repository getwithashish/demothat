// Modal for configuring export settings and showing export progress (DESIGN_SPEC §10).
import { useEffect, useRef, useState, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Loader2, CircleCheck, CircleX, Folder, Ban } from 'tabler-icons-react'
import { ICON_SIZE, ICON_STROKE } from '../ui/icons'
import { Input } from '../ui/input'
import { Section } from '../ui/section'
import { useEditorStore } from '../../store/editorStore'
import { formatTime } from '../../lib/utils'
import {
  RESOLUTIONS,
  RESOLUTION_OPTIONS,
  exportDimensions,
  type ResolutionKey,
} from '../../../shared/export-resolutions'
import { GIF_MAX_HEIGHT, selectExportCodec } from '../../../shared/export-codec'
import { detectUpscale, maxCameraScale, maxZoomLevel } from '../../lib/upscale'
import {
  ASSUMED_BITRATE_MBPS,
  type ExportPerfSample,
  estimateCloudSeconds,
  estimateFileMB,
  estimateLocalSeconds,
  estimateRemainingSeconds,
  fasterMethod,
  framesFor,
  roughRange,
} from '../../lib/export-estimate'
import { PanelHeader } from './PanelHeader'

export type ExportSettings = {
  format: 'mp4' | 'gif'
  resolution: ResolutionKey
  fps: 30 | 60
  quality: 'low' | 'medium' | 'high'
}

interface ExportModalProps {
  isOpen: boolean
  onClose: () => void
  onMinimize?: () => void
  onStartExport: (settings: ExportSettings, outputPath: string) => void
  onCancelExport: () => void
  isExporting: boolean
  progress: number
  result: { success: boolean; outputPath?: string; error?: string } | null
}

const generateFilename = (format: 'mp4' | 'gif') => {
  const now = new Date()
  const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19)
  return `DemoThat-${timestamp}.${format}`
}

/** Config the cloud client will populate (Phase 5); absent means "not set up". */
interface CloudConfig {
  baseUrl: string
  startupSeconds: number
  upscaleFps: number
  uplinkMbps: number
  downlinkMbps: number
}

interface EntitlementInfo {
  pro: boolean
  credits: number
  unlockUrl: string
}

/** Marks a resolution whose export would upscale the source. */
const ProBadge = () => (
  <span className="rounded-pv bg-ctl px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
    Pro
  </span>
)

const EstimateRow = ({
  label,
  value,
  hint,
  highlight,
}: {
  label: string
  value: string
  hint?: string
  highlight?: string
}) => (
  <div className="flex items-start justify-between gap-3">
    <span className="text-ui text-fg">
      {label}
      {highlight && (
        <span className="ml-2 rounded-pv bg-ctl px-1.5 py-0.5 text-[11px] font-semibold text-accent">{highlight}</span>
      )}
    </span>
    <span className="text-right font-mono text-sm tabular-nums text-muted">
      {value}
      {hint && <span className="block font-sans text-xs text-muted">{hint}</span>}
    </span>
  </div>
)

// --- Sub-components for different views ---
const SettingsView = ({
  onStartExport,
  onClose,
}: {
  onStartExport: (settings: ExportSettings, outputPath: string) => void
  onClose: () => void
}) => {
  const [settings, setSettings] = useState<ExportSettings>({
    format: 'mp4',
    resolution: '1080p',
    fps: 30,
    quality: 'medium',
  })
  const [outputPath, setOutputPath] = useState('')
  const [encoderCapabilities, setEncoderCapabilities] = useState<{ libx265: boolean } | null>(null)
  const [entitlement, setEntitlement] = useState<EntitlementInfo | null>(null)
  const [perfSamples, setPerfSamples] = useState<ExportPerfSample[]>([])
  const [cloud, setCloud] = useState<CloudConfig | null>(null)
  const [upscaleMethod, setUpscaleMethod] = useState<'standard' | 'ai'>('standard')
  const { duration, cutRegions, speedRegions, videoDimensions, frameStyles, aspectRatio, zoomRegions, cameraMotions } =
    useEditorStore(
      useShallow((state) => ({
        duration: state.duration,
        cutRegions: state.cutRegions,
        speedRegions: state.speedRegions,
        videoDimensions: state.videoDimensions,
        frameStyles: state.frameStyles,
        aspectRatio: state.aspectRatio,
        zoomRegions: state.zoomRegions,
        cameraMotions: state.cameraMotions,
      })),
    )

  // Which encoders the bundled FFmpeg has; a missing libx265 disables 8K.
  // Until the answer arrives, assume available so the option does not flicker
  // (the main process still refuses an impossible export).
  useEffect(() => {
    window.electronAPI
      .getExportCapabilities()
      .then(setEncoderCapabilities)
      .catch(() => setEncoderCapabilities(null))
  }, [])

  // Pro state, measured throughput and (when configured) the cloud client.
  // The Pro gate is a soft, local convenience — see features/entitlement.ts.
  useEffect(() => {
    window.electronAPI
      .getEntitlement()
      .then(setEntitlement)
      .catch(() => setEntitlement({ pro: false, credits: 0, unlockUrl: '' }))
    window.electronAPI
      .getExportPerfSamples()
      .then((samples) => setPerfSamples(samples as ExportPerfSample[]))
      .catch(() => setPerfSamples([]))

    const loadCloud = async () => {
      try {
        const baseUrl = await window.electronAPI.getSetting<string>('cloud.baseUrl')
        if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
          setCloud(null)
          return
        }
        const capabilities = await window.electronAPI.getSetting<{
          startupSeconds?: number
          upscaleFps?: number
        }>('cloud.capabilities')
        const uplinkMbps = Number(await window.electronAPI.getSetting('cloud.uplinkMbps')) || 20
        const downlinkMbps = Number(await window.electronAPI.getSetting('cloud.downlinkMbps')) || 100
        setCloud({
          baseUrl: baseUrl.trim(),
          startupSeconds: Number(capabilities?.startupSeconds) || 0,
          upscaleFps: Number(capabilities?.upscaleFps) || 0,
          uplinkMbps,
          downlinkMbps,
        })
      } catch {
        setCloud(null)
      }
    }
    loadCloud()
  }, [])

  const resolutionDisabledReason = (key: ResolutionKey): string | null => {
    if (key === '8k' && encoderCapabilities && !encoderCapabilities.libx265) {
      return 'needs HEVC (libx265), which this build lacks'
    }
    if (settings.format === 'gif' && RESOLUTIONS[key].height > GIF_MAX_HEIGHT) {
      return 'GIF is limited to 2K'
    }
    return null
  }

  const estimatedDuration = useMemo(() => {
    if (duration === 0) return 0

    let finalDuration = duration

    // Subtract cut regions
    Object.values(cutRegions).forEach((region) => {
      finalDuration -= region.duration
    })

    // Adjust for speed regions
    Object.values(speedRegions).forEach((region) => {
      // Subtract the original duration of the segment
      finalDuration -= region.duration
      // Add the new duration of the segment
      finalDuration += region.duration / region.speed
    })

    return Math.max(0, finalDuration)
  }, [duration, cutRegions, speedRegions])

  // --- Upscale detection, Pro gating and time estimates -------------------------
  // Whether each resolution stretches the source is derived from the same maths
  // the renderer draws with, so the badges match what actually happens.
  const paddingPercent = typeof frameStyles?.padding === 'number' ? frameStyles.padding : 0
  const maxZoomFactor = useMemo(() => maxZoomLevel(zoomRegions), [zoomRegions])
  const cameraScaleFactor = useMemo(() => maxCameraScale(cameraMotions), [cameraMotions])

  const upscaleByResolution = useMemo(() => {
    const map = new Map<ResolutionKey, { requiredScale: number; isUpscale: boolean }>()
    for (const option of RESOLUTION_OPTIONS) {
      const target = exportDimensions(option.key, aspectRatio)
      map.set(
        option.key,
        detectUpscale({
          targetWidth: target.width,
          targetHeight: target.height,
          paddingPercent,
          videoWidth: videoDimensions?.width ?? 0,
          videoHeight: videoDimensions?.height ?? 0,
          maxZoom: maxZoomFactor,
          cameraScale: cameraScaleFactor,
        }),
      )
    }
    return map
  }, [aspectRatio, paddingPercent, maxZoomFactor, cameraScaleFactor, videoDimensions])

  const targetDimensions = exportDimensions(settings.resolution, aspectRatio)
  const selectedUpscale = upscaleByResolution.get(settings.resolution)
  const selectedIsUpscale = selectedUpscale?.isUpscale ?? false
  // Optimistic while the answer is in flight, like the encoder probe above.
  const isEntitled = entitlement?.pro ?? true
  const proLocked = selectedIsUpscale && !isEntitled
  const cloudReady = cloud !== null && cloud.upscaleFps > 0
  const effectiveMethod = cloud ? upscaleMethod : 'standard'

  const frames = framesFor(estimatedDuration, settings.fps)
  const exportCodec = selectExportCodec(RESOLUTIONS[settings.resolution].height)
  const localEstimate = estimateLocalSeconds({
    frames,
    targetWidth: targetDimensions.width,
    targetHeight: targetDimensions.height,
    resolution: settings.resolution,
    codec: exportCodec,
    settingFps: settings.fps,
    samples: perfSamples,
  })
  const localRange = localEstimate.rough && localEstimate.seconds > 0 ? roughRange(localEstimate.seconds) : null

  const cloudEstimate =
    cloudReady && cloud && frames > 0
      ? estimateCloudSeconds({
          frames,
          fileMB: estimateFileMB(estimatedDuration, ASSUMED_BITRATE_MBPS[settings.quality]),
          outputMB: estimateFileMB(estimatedDuration, ASSUMED_BITRATE_MBPS[settings.quality] * 1.5),
          uplinkMbps: cloud.uplinkMbps,
          downlinkMbps: cloud.downlinkMbps,
          startupSeconds: cloud.startupSeconds,
          upscaleFps: cloud.upscaleFps,
        })
      : null
  const faster = cloudEstimate ? fasterMethod(localEstimate.seconds, cloudEstimate.totalSeconds) : null

  const handleUnlock = () => {
    const url = entitlement?.unlockUrl
    if (url) window.electronAPI.openExternal(url)
  }

  const handleValueChange = (key: keyof ExportSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const handleFormatChange = (value: string) => {
    setSettings((prev) => {
      const format = value as ExportSettings['format']
      // GIF cannot go above 2K, so fall back rather than leaving an invalid pair.
      const resolution =
        format === 'gif' && RESOLUTIONS[prev.resolution].height > GIF_MAX_HEIGHT ? '1080p' : prev.resolution
      return { ...prev, format, resolution }
    })
  }

  const handleFpsChange = (value: string) => {
    setSettings((prev) => ({ ...prev, fps: value === '60' ? 60 : 30 }))
  }

  const handleBrowse = async () => {
    const result = await window.electronAPI.showSaveDialog({
      title: 'Save Video',
      defaultPath: outputPath,
      filters:
        settings.format === 'mp4'
          ? [{ name: 'MP4 Video', extensions: ['mp4'] }]
          : [{ name: 'GIF Animation', extensions: ['gif'] }],
    })

    if (!result.canceled && result.filePath) {
      setOutputPath(result.filePath)
    }
  }

  useEffect(() => {
    const setDefaultPath = async () => {
      try {
        const homePath = await window.electronAPI.getPath('home')
        const filename = generateFilename(settings.format)
        setOutputPath(`${homePath}/${filename}`)
      } catch (error) {
        console.error('Failed to get home path, falling back to relative path.', error)
        setOutputPath(generateFilename(settings.format))
      }
    }

    setDefaultPath()
  }, [settings.format])

  return (
    <div className="flex min-h-0 flex-col">
      <PanelHeader title="Export settings" subtitle="Configure your export options" />

      <div className="min-h-0 flex-1 overflow-y-auto stable-scrollbar">
        <Section first>
          <div className="space-y-3.5">
            <Select value={settings.format} onValueChange={handleFormatChange}>
              <SelectTrigger label="Format" aria-label="Format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mp4">MP4 (Video)</SelectItem>
                <SelectItem value="gif">GIF (Animation)</SelectItem>
              </SelectContent>
            </Select>

            <Select value={settings.resolution} onValueChange={(value) => handleValueChange('resolution', value)}>
              <SelectTrigger label="Resolution" aria-label="Resolution">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOLUTION_OPTIONS.map((option) => {
                  const reason = resolutionDisabledReason(option.key)
                  const isPro = upscaleByResolution.get(option.key)?.isUpscale ?? false
                  return (
                    <SelectItem
                      key={option.key}
                      value={option.key}
                      disabled={reason !== null}
                      title={reason ?? undefined}
                    >
                      <span className="flex items-center gap-2">
                        <span>{reason ? `${option.label} — ${reason}` : option.label}</span>
                        {isPro && <ProBadge />}
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>

            {selectedIsUpscale && (
              <Select value={effectiveMethod} onValueChange={(value) => setUpscaleMethod(value as 'standard' | 'ai')}>
                <SelectTrigger label="Upscale method" aria-label="Upscale method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard (local, Lanczos)</SelectItem>
                  <SelectItem
                    value="ai"
                    disabled={!cloudReady}
                    title={cloudReady ? undefined : 'Set up cloud export to use this'}
                  >
                    {cloudReady ? 'AI (cloud)' : 'AI (cloud) — needs cloud setup'}
                  </SelectItem>
                </SelectContent>
              </Select>
            )}

            {proLocked && (
              <div className="space-y-2 rounded-pv border border-line bg-ctl p-3">
                <p className="text-sm text-fg">
                  Upscaling to {RESOLUTIONS[settings.resolution].height}p is a Pro feature.
                </p>
                {selectedUpscale && videoDimensions && videoDimensions.width > 0 && (
                  <p className="text-xs text-muted">
                    Your {videoDimensions.width}×{videoDimensions.height} source would be drawn at{' '}
                    {selectedUpscale.requiredScale.toFixed(2)}× its native pixels.
                  </p>
                )}
                <Button variant="secondary" size="sm" onClick={handleUnlock}>
                  Unlock Pro
                </Button>
              </div>
            )}

            <Select value={settings.quality} onValueChange={(value) => handleValueChange('quality', value)}>
              <SelectTrigger label="Quality" aria-label="Quality">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>

            <Select value={String(settings.fps)} onValueChange={handleFpsChange}>
              <SelectTrigger label="Frame rate" aria-label="Frame rate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 FPS</SelectItem>
                <SelectItem value="60">60 FPS</SelectItem>
              </SelectContent>
            </Select>

            <div className="space-y-1.5">
              <label htmlFor="export-output-path" className="block text-sm text-muted">
                Output file
              </label>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    id="export-output-path"
                    value={outputPath}
                    onChange={(e) => setOutputPath(e.target.value)}
                    placeholder="Loading default path…"
                    className="w-full"
                  />
                </div>
                <Button variant="secondary" onClick={handleBrowse} className="whitespace-nowrap">
                  Browse
                </Button>
              </div>
            </div>
          </div>
        </Section>

        <Section>
          <div className="space-y-3.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-ui text-fg">Estimated duration</span>
              <span className="font-mono text-sm tabular-nums text-muted">{formatTime(estimatedDuration, true)}</span>
            </div>

            {frames > 0 && <EstimateRow label="Frames to render" value={`${frames.toLocaleString()} frames`} />}

            {frames > 0 && (
              <EstimateRow
                label="Estimated render time (Standard)"
                value={
                  localEstimate.seconds <= 0
                    ? '—'
                    : localRange
                      ? `${formatTime(localRange.min, true)} – ${formatTime(localRange.max, true)}`
                      : formatTime(localEstimate.seconds, true)
                }
                hint={
                  localRange
                    ? 'rough — nothing measured for this setting yet'
                    : localEstimate.fromSample
                      ? 'measured on this machine'
                      : undefined
                }
                highlight={faster === 'local' ? 'faster' : undefined}
              />
            )}

            {cloudEstimate && (
              <EstimateRow
                label="Estimated render time (AI, cloud)"
                value={formatTime(cloudEstimate.totalSeconds, true)}
                hint={`upload ${formatTime(cloudEstimate.uploadSeconds, true)} · startup ${formatTime(
                  cloudEstimate.startupSeconds,
                  true,
                )} · upscale ${formatTime(cloudEstimate.computeSeconds, true)} · download ${formatTime(
                  cloudEstimate.downloadSeconds,
                  true,
                )}`}
                highlight={faster === 'cloud' ? 'faster' : undefined}
              />
            )}

            {frames > 0 && cloud && !cloudReady && (
              <p className="text-xs text-muted">
                Cloud estimates appear once the cloud client reports its capabilities.
              </p>
            )}
          </div>
        </Section>
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-line p-4">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => onStartExport(settings, outputPath)} disabled={!outputPath || proLocked}>
          Start export
        </Button>
      </div>
    </div>
  )
}

const ProgressView = ({ progress, onCancel }: { progress: number; onCancel: () => void }) => {
  // Live ETA from the progress events: elapsed / progress.
  const startedAt = useRef(Date.now())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const elapsedSeconds = (now - startedAt.current) / 1000
  const remainingSeconds = estimateRemainingSeconds(elapsedSeconds, progress)

  return (
    <div className="flex flex-col items-center p-8 text-center">
      <Loader2 size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mb-4 animate-spin text-muted" />
      <h2 className="text-title font-semibold text-fg">Exporting…</h2>
      <p className="mt-0.5 text-sm text-muted">Please wait while we process your video.</p>
      <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-ctl">
        <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-3 font-mono text-sm tabular-nums text-muted">
        {progress < 0.1 ? '< 1' : Math.round(progress)}%
        {remainingSeconds !== null && ` · about ${formatTime(remainingSeconds, true)} left`}
      </p>
      <Button variant="secondary" onClick={onCancel} className="mt-6 w-full">
        Cancel
      </Button>
    </div>
  )
}

const ResultView = ({ result, onClose }: { result: NonNullable<ExportModalProps['result']>; onClose: () => void }) => {
  const isCancelled = !result.success && result.error === 'Export cancelled.'

  const handleOpenFolder = () => {
    if (result.success && result.outputPath) {
      window.electronAPI.showItemInFolder(result.outputPath)
    }
  }

  const getTitle = () => {
    if (isCancelled) return 'Export cancelled'
    if (result.success) return 'Export successful'
    return 'Export failed'
  }

  const getMessage = () => {
    if (isCancelled) return 'The export process was stopped.'
    if (result.success) return 'Your video has been saved to the selected location.'
    return result.error || 'An unknown error occurred.'
  }

  const getIcon = () => {
    if (isCancelled) {
      return <Ban size={ICON_SIZE} strokeWidth={ICON_STROKE} className="text-muted" />
    }
    if (result.success) {
      return <CircleCheck size={ICON_SIZE} strokeWidth={ICON_STROKE} className="text-accent" />
    }
    return <CircleX size={ICON_SIZE} strokeWidth={ICON_STROKE} className="text-danger" />
  }

  return (
    <div className="flex flex-col items-center p-8 text-center">
      {getIcon()}
      <h2 className="mt-4 text-title font-semibold text-fg">{getTitle()}</h2>
      <p className="mt-0.5 max-w-xs break-words text-sm text-muted">{getMessage()}</p>
      <div className="mt-6 flex w-full gap-2">
        {result.success ? (
          <>
            <Button onClick={onClose} variant="secondary" className="flex-1">
              Close
            </Button>
            <Button onClick={handleOpenFolder} className="flex-1">
              <Folder size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
              Open folder
            </Button>
          </>
        ) : (
          <Button onClick={onClose} className="flex-1">
            Close
          </Button>
        )}
      </div>
    </div>
  )
}

// --- Main Modal Component ---
export function ExportModal({
  isOpen,
  onClose,
  onMinimize,
  onStartExport,
  onCancelExport,
  isExporting,
  progress,
  result,
}: ExportModalProps) {
  if (!isOpen) return null

  const renderContent = () => {
    if (result) {
      return <ResultView result={result} onClose={onClose} />
    }
    if (isExporting) {
      return <ProgressView progress={progress} onCancel={onCancelExport} />
    }
    return <SettingsView onStartExport={onStartExport} onClose={onClose} />
  }

  return (
    <div className="modal-backdrop flex items-center justify-center">
      <div
        className="card-clean pointer-events-auto m-4 flex w-full max-w-2xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {isExporting && onMinimize && (
          <div className="flex justify-end px-4 pt-3">
            <Button variant="ghost" size="sm" onClick={onMinimize}>
              Run in background
            </Button>
          </div>
        )}
        {renderContent()}
      </div>
    </div>
  )
}
