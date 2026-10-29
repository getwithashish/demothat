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
  estimateFileMB,
  estimateLocalSeconds,
  estimateRemainingSeconds,
  framesFor,
  roughRange,
} from '../../lib/export-estimate'
import { PanelHeader } from './PanelHeader'
import { estimateCloudCredits } from '../../../shared/cloud-cost'
import { formatCredits, CREDIT_PACKS } from '../../../shared/license'
import { CloudConsentDialog } from './cloud/CloudConsentDialog'
import { CloudExportProgress } from './cloud/CloudExportProgress'
import { CancelExportDialog } from './cloud/CancelExportDialog'
import { OutOfCreditsDialog } from './cloud/OutOfCreditsDialog'
import type { CloudProgressInfo, CloudRetryRequest, ExportResult } from '../../hooks/useExportProcess'

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
  onStartExport: (settings: ExportSettings, outputPath: string, options?: { cloud?: boolean }) => void
  onCancelExport: () => void
  isExporting: boolean
  progress: number
  /** Current export stage, for the cloud flow's labels. */
  stage?: string | null
  /** Cloud stages: credits held/used and the server's ETA. */
  cloudProgress?: CloudProgressInfo | null
  result: ExportResult | null
  /** Re-runs the cloud step on the render that already exists. */
  onRetryCloud?: (request: CloudRetryRequest) => void
  /** Upscales that render locally instead. */
  onFallbackStandard?: (request: Omit<CloudRetryRequest, 'fps'> & { quality?: ExportSettings['quality'] }) => void
}

const generateFilename = (format: 'mp4' | 'gif') => {
  const now = new Date()
  const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19)
  return `DemoThat-${timestamp}.${format}`
}

/** The cloud client's view of the backend (contract: `GET /v1/capabilities`). */
interface CloudConfig {
  /** Pricing table, keyed by target ("1080p", "4k", "8k", …). */
  creditsPerFrame: Record<string, number>
  /** The server's minimum charge once GPU work has started. */
  minChargeCredits: number
  cloudEnabled: boolean
  /** Measured connection speeds, used only for the upload estimate. */
  uplinkMbps: number
  downlinkMbps: number
  /** The remembered consent decision, or null when the user has not been asked. */
  consent: { acceptedAt: number } | null
}

interface EntitlementInfo {
  pro: boolean
  credits: number
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
  onStartExport: (settings: ExportSettings, outputPath: string, options?: { cloud?: boolean }) => void
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
      .catch(() => setEntitlement({ pro: false, credits: 0 }))
    window.electronAPI
      .getExportPerfSamples()
      .then((samples) => setPerfSamples(samples as ExportPerfSample[]))
      .catch(() => setPerfSamples([]))

    const loadCloud = async () => {
      try {
        // The client's own view: whether this device is activated, the live
        // pricing table, the limits and the consent state.
        const status = await window.electronAPI.cloudStatus()
        if (!status.configured || !status.capabilities) {
          setCloud(null)
          return
        }
        const uplinkMbps = Number(await window.electronAPI.getSetting('cloud.uplinkMbps')) || 20
        const downlinkMbps = Number(await window.electronAPI.getSetting('cloud.downlinkMbps')) || 100
        setCloud({
          creditsPerFrame: status.capabilities.creditsPerFrame ?? {},
          minChargeCredits: Number(status.capabilities.minChargeCredits) || 0,
          cloudEnabled: status.capabilities.cloudEnabled !== false,
          consent: status.consent ?? null,
          uplinkMbps,
          downlinkMbps,
        })
      } catch {
        setCloud(null)
      }
    }
    loadCloud()
  }, [])

  // Balance for the cost preflight, kept fresh by useLicenseSync.
  const balance = useEditorStore((state) => state.balance)

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
  // Ready means the backend is reachable, enabled and this device is activated.
  const cloudReady = cloud !== null && cloud.cloudEnabled
  // The AI/cloud upscaling path is ONLY for true upscales. Exporting at or below
  // the recorded resolution is Standard and never touched by the cloud, so it can
  // never be charged or require Pro — even if the user previously selected the AI
  // method for a higher resolution (the stored `upscaleMethod` must not leak in).
  const effectiveMethod = !selectedIsUpscale ? 'standard' : cloudReady ? upscaleMethod : 'standard'

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

  // Cost comes from the server's own pricing table. The server recomputes it
  // from its probe of the upload, and its number is final. Only shown for a true
  // upscale: exporting at/below the source resolution is Standard and free, so it
  // must not read as having a cost.
  const cloudCost =
    cloud && frames > 0 && selectedIsUpscale
      ? estimateCloudCredits(cloud.creditsPerFrame, targetDimensions.height, estimatedDuration, settings.fps)
      : null
  const cloudCredits = cloudCost?.credits ?? 0
  const insufficientCredits = cloudCost !== null && balance < cloudCredits
  const creditShortfall = Math.max(0, cloudCredits - balance)
  // Only the upload can be estimated locally: the contract publishes no
  // startup/upscale throughput, so the server reports the ETA once running.
  // Only ever uploaded for a true upscale (the AI path); Standard is local.
  const uploadSeconds =
    cloud && frames > 0 && selectedIsUpscale
      ? (estimateFileMB(estimatedDuration, ASSUMED_BITRATE_MBPS[settings.quality]) * 8) / Math.max(1, cloud.uplinkMbps)
      : 0

  const [consentOpen, setConsentOpen] = useState(false)
  const [outOfCreditsOpen, setOutOfCreditsOpen] = useState(false)

  const beginExport = () => onStartExport(settings, outputPath, { cloud: effectiveMethod === 'ai' })

  /** Consent and credits are checked here, before anything is rendered. */
  const handleStart = () => {
    if (effectiveMethod === 'ai') {
      if (insufficientCredits) {
        setOutOfCreditsOpen(true)
        return
      }
      if (!cloud?.consent) {
        setConsentOpen(true)
        return
      }
    }
    beginExport()
  }

  // Unlock Pro takes the same road as Get Pro / the activation dialogs: straight
  // to the Dodo checkout for the Pro pack. Opening the browser is the main
  // process's job (startPurchase → startCheckout); the WaitingForPaymentDialog
  // then gives the in-app feedback while the payment settles.
  const handleUnlock = () => {
    void useEditorStore.getState().startPurchase(CREDIT_PACKS[0].productId)
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
              />
            )}

            {uploadSeconds > 0 && (
              <EstimateRow
                label="Estimated upload (AI, cloud)"
                value={formatTime(uploadSeconds, true)}
                hint="cloud compute time is reported while the job runs"
              />
            )}

            {cloudCost && (
              <EstimateRow
                label="Cost (AI, cloud)"
                value={`${formatCredits(cloudCredits)} credits`}
                hint={
                  insufficientCredits
                    ? `You have ${formatCredits(balance)}. You need ${formatCredits(creditShortfall)} more.`
                    : `${formatCredits(balance)} now, ${formatCredits(balance - cloudCredits)} after`
                }
              />
            )}

            {frames > 0 && cloud && !cloudReady && (
              <p className="text-xs text-muted">
                Cloud upscaling is unavailable{cloud.cloudEnabled ? '' : ' right now'}. Activate a license to use it.
              </p>
            )}
          </div>
        </Section>
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-line p-4">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {effectiveMethod === 'ai' && insufficientCredits ? (
          // The Cost row says what is missing; this is the way out of it.
          <Button onClick={() => useEditorStore.getState().openBuyCredits(creditShortfall)}>Buy credits</Button>
        ) : (
          <Button
            onClick={handleStart}
            disabled={!outputPath || proLocked || (effectiveMethod === 'ai' && !cloudReady)}
          >
            Start export
          </Button>
        )}
      </div>

      <CloudConsentDialog
        isOpen={consentOpen}
        onClose={() => setConsentOpen(false)}
        onContinue={(dontAskAgain) => {
          setConsentOpen(false)
          // Remembering the choice is what "Don't ask again" means; either way
          // this export goes ahead now.
          if (dontAskAgain) void window.electronAPI.setCloudConsent(true)
          beginExport()
        }}
      />

      <OutOfCreditsDialog
        isOpen={outOfCreditsOpen}
        cost={cloudCredits}
        balance={balance}
        onClose={() => setOutOfCreditsOpen(false)}
      />
    </div>
  )
}

const ProgressView = ({
  progress,
  cloudProgress,
  onCancel,
}: {
  progress: number
  cloudProgress?: CloudProgressInfo | null
  onCancel: () => void
}) => {
  // Live ETA from the progress events: elapsed / progress.
  const startedAt = useRef(Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [cancelOpen, setCancelOpen] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  // A cloud export has its own view: the stage, the credits meter and a Cancel
  // that explains what cancelling costs at this stage.
  if (cloudProgress) {
    const reserved = cloudProgress.reserved ?? 0
    return (
      <>
        <CloudExportProgress
          stage={cloudProgress.stage}
          percent={progress}
          reserved={cloudProgress.reserved}
          consumed={cloudProgress.consumed}
          etaSeconds={cloudProgress.etaSeconds}
          onCancel={() => setCancelOpen(true)}
        />
        <CancelExportDialog
          isOpen={cancelOpen}
          stage={cloudProgress.stage}
          reserved={reserved}
          consumed={cloudProgress.consumed ?? 0}
          minChargeCredits={cloudProgress.minChargeCredits ?? 0}
          cost={reserved}
          onKeepExporting={() => setCancelOpen(false)}
          onConfirmCancel={onCancel}
        />
      </>
    )
  }

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

const ResultView = ({
  result,
  onClose,
  onRetryCloud,
  onFallbackStandard,
}: {
  result: ExportResult
  onClose: () => void
  onRetryCloud?: (request: CloudRetryRequest) => void
  onFallbackStandard?: (request: Omit<CloudRetryRequest, 'fps'> & { quality?: ExportSettings['quality'] }) => void
}) => {
  const isCancelled = !result.success && result.error === 'Export cancelled.'
  const isCloudCanceled = !result.success && result.cloudReason === 'canceled'
  const isRejected = !result.success && result.cloudReason === 'insufficient_credits'
  // A cloud failure that still has the local render behind it (design §7).
  const canRetry = !result.success && result.canRetryCloud === true && Boolean(result.intermediatePath)
  const retryParams = result.cloudRetry
  const openBuyCredits = useEditorStore((state) => state.openBuyCredits)

  const handleOpenFolder = () => {
    if (result.success && result.outputPath) {
      window.electronAPI.showItemInFolder(result.outputPath)
    }
  }

  const handleRetry = () => {
    if (!onRetryCloud || !result.intermediatePath || !result.outputPath || !retryParams) return
    onRetryCloud({ ...retryParams, intermediatePath: result.intermediatePath, outputPath: result.outputPath })
  }

  const handleFallback = () => {
    if (!onFallbackStandard || !result.intermediatePath || !result.outputPath || !retryParams) return
    onFallbackStandard({
      intermediatePath: result.intermediatePath,
      outputPath: result.outputPath,
      targetWidth: retryParams.targetWidth,
      targetHeight: retryParams.targetHeight,
      durationSec: retryParams.durationSec,
    })
  }

  const getTitle = () => {
    if (isRejected) return 'Not enough credits'
    if (isCloudCanceled) return 'Export cancelled'
    if (isCancelled) return 'Export cancelled'
    if (result.success) return 'Export successful'
    if (canRetry) return "The cloud upscale didn't finish"
    return 'Export failed'
  }

  const getMessage = () => {
    if (isRejected) {
      return result.cost !== undefined
        ? `This export needs ${formatCredits(result.cost)} credits and the account has ${formatCredits(
            result.balance ?? 0,
          )}.`
        : 'The upscaling service refused this export because the account is out of credits.'
    }
    if (isCloudCanceled) {
      // The server's numbers, never the client's.
      const charge = result.charge ?? 0
      const refund = result.refund ?? 0
      return refund > 0
        ? `${formatCredits(charge)} credits used, ${formatCredits(refund)} returned. No video was saved.`
        : `No credits were used. No video was saved.`
    }
    if (isCancelled) return 'The export process was stopped.'
    if (result.success) return 'Your video has been saved to the selected location.'
    if (canRetry) {
      const refund = result.refund ?? 0
      const refundLine = refund > 0 ? `All ${formatCredits(refund)} credits were returned. ` : ''
      return `This was on our side. ${refundLine}Your rendered video is still on this computer.`
    }
    return result.error || 'An unknown error occurred.'
  }

  const getIcon = () => {
    if (isCancelled || isCloudCanceled) {
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
        ) : isRejected ? (
          <>
            <Button onClick={onClose} variant="secondary" className="flex-1">
              Close
            </Button>
            <Button onClick={() => openBuyCredits(Math.max(0, (result.cost ?? 0) - (result.balance ?? 0)))}>
              Buy credits
            </Button>
          </>
        ) : canRetry ? (
          <>
            <Button onClick={handleFallback} variant="secondary" className="flex-1">
              Use standard upscaling
            </Button>
            <Button onClick={handleRetry} className="flex-1">
              Try again
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
  cloudProgress,
  result,
  onRetryCloud,
  onFallbackStandard,
}: ExportModalProps) {
  if (!isOpen) return null

  const renderContent = () => {
    if (result) {
      return (
        <ResultView
          result={result}
          onClose={onClose}
          onRetryCloud={onRetryCloud}
          onFallbackStandard={onFallbackStandard}
        />
      )
    }
    if (isExporting) {
      return <ProgressView progress={progress} cloudProgress={cloudProgress} onCancel={onCancelExport} />
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
