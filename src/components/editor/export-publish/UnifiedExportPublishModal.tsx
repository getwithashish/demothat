import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Ban, CircleCheck, CircleX, Cloud, Folder, Loader2, Refresh, Share, Trash, X } from 'tabler-icons-react'
import { ICON_SIZE, ICON_STROKE } from '../../ui/icons'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { useEditorStore } from '../../../store/editorStore'
import { useMorphSurface } from '../../../hooks/useMorphSurface'
import { cn, formatTime } from '../../../lib/utils'
import {
  RESOLUTIONS,
  RESOLUTION_OPTIONS,
  exportDimensions,
  type ResolutionKey,
} from '../../../../shared/export-resolutions'
import { GIF_MAX_HEIGHT, selectExportCodec } from '../../../../shared/export-codec'
import { detectUpscale, maxCameraScale, maxZoomLevel } from '../../../lib/upscale'
import {
  ASSUMED_BITRATE_MBPS,
  estimateFileMB,
  estimateLocalSeconds,
  framesFor,
  roughRange,
  type ExportPerfSample,
} from '../../../lib/export-estimate'
import { estimateCloudCredits } from '../../../../shared/cloud-cost'
import { formatCredits } from '../../../../shared/license'
import { firstPurchaseProductId } from '../../../../shared/pricing'
import { CloudConsentDialog } from '../cloud/CloudConsentDialog'
import { CloudExportProgress } from '../cloud/CloudExportProgress'
import { CancelExportDialog } from '../cloud/CancelExportDialog'
import { OutOfCreditsDialog } from '../cloud/OutOfCreditsDialog'
import { estimatePublishCredits, formatBytes, type PublishingCapabilities } from '../../../../shared/publish-cost'
import {
  extractExportProjectState,
  type ExportProjectState,
  type PublicationAnalytics,
  type PublicationAnalyticsRange,
  type PublicationView,
  type PublishOutcome,
  type PublishProgress,
  type PublishRequest,
  type PublishStatus,
  type RenderAndPublishParams,
  type RenderExportSettings,
  type RenderPublishOptions,
} from '../../../hooks/usePublish'
import type { CloudProgressInfo, CloudRetryRequest, ExportResult } from '../../../hooks/useExportProcess'

export type ExportSettings = {
  format: 'mp4' | 'gif'
  resolution: ResolutionKey
  fps: 30 | 60
  quality: 'low' | 'medium' | 'high'
}

export type ModalTab = 'export' | 'publish' | 'analytics'

export interface UnifiedExportPublishModalProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: ModalTab
  triggerSelector?: string

  // Local & Cloud export props
  isExporting?: boolean
  exportProgress?: number
  exportStage?: string | null
  cloudProgress?: CloudProgressInfo | null
  exportResult?: ExportResult | null
  onStartExport?: (settings: ExportSettings, outputPath: string, options?: { cloud?: boolean }) => Promise<void> | void
  onCancelExport?: () => void
  onMinimize?: () => void
  onRetryCloud?: (request: CloudRetryRequest) => void

  // Cloud publish & analytics props
  publishStatus?: PublishStatus | null
  isPublishing?: boolean
  publishProgress?: PublishProgress | null
  publications?: PublicationView[]
  isLoadingList?: boolean
  onRenderAndPublish?: (
    projectStateOrParams: ExportProjectState | RenderAndPublishParams,
    maybeExportSettings?: RenderExportSettings,
    maybePublishOptions?: RenderPublishOptions,
  ) => Promise<PublishOutcome>
  onPublish?: (request: PublishRequest) => Promise<PublishOutcome>
  onCancelPublish?: () => void
  onLoadPublications?: () => Promise<{ ok: boolean; error?: string }>
  onDeletePublication?: (id: string) => Promise<{ ok: boolean; error?: string; creditsRefunded?: number }>
  onAnalytics?: (
    id: string,
    range: PublicationAnalyticsRange,
  ) => Promise<{ ok: true; analytics: PublicationAnalytics } | { ok: false; error: string }>
  onSaveRenderedCopy?: (destinationPath: string) => Promise<{ ok: boolean; error?: string }>
  onCopied?: (label: string) => void
}

/** Formats ISO date to friendly string */
function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Compact duration string */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/** Generates default filename */
function generateFilename(prefix = 'DemoThat', format = 'mp4'): string {
  const now = new Date()
  const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19)
  return `${prefix}-${timestamp}.${format}`
}

/** Copy-to-clipboard button with checkmark transition */
function CopyButton({
  value,
  label,
  onCopied,
  className,
}: {
  value: string
  label: string
  onCopied?: (label: string) => void
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="secondary"
      size="sm"
      className={cn('h-8 text-xs', className)}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          onCopied?.(label)
          setTimeout(() => setCopied(false), 1600)
        })
      }}
    >
      {copied ? (
        <CircleCheck size={14} strokeWidth={ICON_STROKE} className="mr-1.5 text-accent" />
      ) : (
        <Share size={14} strokeWidth={ICON_STROKE} className="mr-1.5 text-muted" />
      )}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}

/** Pro Badge for upscale resolutions */
const ProBadge = () => (
  <span className="rounded-pv bg-ctl px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
    Pro
  </span>
)

/** Estimate row helper */
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
  <div className="flex items-start justify-between gap-3 text-xs">
    <span className="text-fg">
      {label}
      {highlight && (
        <span className="ml-2 rounded-pv bg-ctl px-1.5 py-0.5 text-[11px] font-semibold text-accent">{highlight}</span>
      )}
    </span>
    <span className="text-right font-mono tabular-nums text-muted">
      {value}
      {hint && <span className="block font-sans text-xs text-muted">{hint}</span>}
    </span>
  </div>
)

interface CloudConfig {
  creditsPerFrame: Record<string, number>
  minChargeCredits: number
  cloudEnabled: boolean
  uplinkMbps: number
  downlinkMbps: number
  consent: { acceptedAt: number } | null
}

interface EntitlementInfo {
  pro: boolean
  credits: number
}

export function UnifiedExportPublishModal({
  isOpen,
  onClose,
  initialTab = 'export',
  triggerSelector = '#export-trigger-btn',
  isExporting = false,
  exportProgress = 0,
  exportStage,
  cloudProgress,
  exportResult,
  onStartExport,
  onCancelExport,
  onMinimize,
  onRetryCloud,
  publishStatus,
  isPublishing = false,
  publishProgress,
  publications = [],
  isLoadingList = false,
  onRenderAndPublish,
  onPublish,
  onCancelPublish,
  onLoadPublications,
  onDeletePublication,
  onAnalytics,
  onSaveRenderedCopy,
  onCopied,
}: UnifiedExportPublishModalProps) {
  const isBusy = Boolean(isExporting || isPublishing)

  // Store values
  const {
    duration,
    currentProjectPath,
    subtitleCues,
    balance,
    pushToast,
    cutRegions,
    speedRegions,
    videoDimensions,
    frameStyles,
    aspectRatio,
    zoomRegions,
    cameraMotions,
  } = useEditorStore(
    useShallow((state) => ({
      duration: state.duration,
      currentProjectPath: state.currentProjectPath,
      subtitleCues: state.subtitleCues,
      balance: state.balance,
      pushToast: state.pushToast,
      cutRegions: state.cutRegions,
      speedRegions: state.speedRegions,
      videoDimensions: state.videoDimensions,
      frameStyles: state.frameStyles,
      aspectRatio: state.aspectRatio,
      zoomRegions: state.zoomRegions,
      cameraMotions: state.cameraMotions,
    })),
  )

  // Active persistent tab
  const [activeTab, setActiveTab] = useState<ModalTab>(initialTab)

  // Sync initial tab when modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab)
    }
  }, [isOpen, initialTab])

  // Shared export settings
  const [settings, setSettings] = useState<ExportSettings>({
    format: 'mp4',
    resolution: '1080p',
    fps: 30,
    quality: 'medium',
  })

  // Hardware capabilities and cloud status
  const [encoderCapabilities, setEncoderCapabilities] = useState<{ libx265: boolean } | null>(null)
  const [entitlement, setEntitlement] = useState<EntitlementInfo | null>(null)
  const [perfSamples, setPerfSamples] = useState<ExportPerfSample[]>([])
  const [cloud, setCloud] = useState<CloudConfig | null>(null)

  // Load encoder, entitlement and cloud config
  useEffect(() => {
    if (!isOpen) return
    window.electronAPI
      .getExportCapabilities?.()
      .then(setEncoderCapabilities)
      .catch(() => setEncoderCapabilities(null))

    window.electronAPI
      .getEntitlement?.()
      .then(setEntitlement)
      .catch(() => setEntitlement({ pro: false, credits: 0 }))

    window.electronAPI
      .getExportPerfSamples?.()
      .then((samples) => setPerfSamples(samples as ExportPerfSample[]))
      .catch(() => setPerfSamples([]))

    const loadCloud = async () => {
      try {
        const status = await window.electronAPI.cloudStatus()
        if (!status?.configured || !status?.capabilities) {
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
    void loadCloud()
  }, [isOpen])

  // Output destination path
  const [outputPath, setOutputPath] = useState('')
  const [localFilename, setLocalFilename] = useState(() => generateFilename('DemoThat', 'mp4'))

  // Initialize output path
  useEffect(() => {
    let active = true
    void window.electronAPI
      .getPath('home')
      .then((homeDir) => {
        if (!active) return
        setOutputPath(`${homeDir}/${localFilename}`)
      })
      .catch(() => {
        if (!active) return
        setOutputPath(localFilename)
      })
    return () => {
      active = false
    }
  }, [localFilename])

  // Cloud publish settings (always 'page' so landing page, embed, code, download & captions are all generated)
  const [storageDays, setStorageDays] = useState<number>(365)
  const [cloudTitle, setCloudTitle] = useState('')
  const [includeCaptions, setIncludeCaptions] = useState(true)

  // Initialize cloud title from project name
  useEffect(() => {
    if (currentProjectPath) {
      const parts = currentProjectPath.split(/[\\/]/)
      const base = parts[parts.length - 1]?.replace(/\.demothat$/, '') ?? 'My Video'
      setCloudTitle(base)
    } else {
      setCloudTitle('DemoThat Video')
    }
  }, [currentProjectPath])

  // Set default storageDays from capabilities
  const capabilities: PublishingCapabilities | null = publishStatus?.publishing ?? null
  useEffect(() => {
    if (capabilities) {
      setStorageDays(capabilities.defaultDurationDays)
    }
  }, [capabilities])

  // Post-publish state
  const [publishOutcome, setPublishOutcome] = useState<PublishOutcome | null>(null)
  const [isSavingCopy, setIsSavingCopy] = useState(false)
  const [saveCopySuccess, setSaveCopySuccess] = useState(false)

  // Analytics tab state
  const [selectedPublicationId, setSelectedPublicationId] = useState<string | null>(null)
  const [analyticsRange, setAnalyticsRange] = useState<PublicationAnalyticsRange>('30d')
  const [analyticsData, setAnalyticsData] = useState<PublicationAnalytics | null>(null)
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false)
  const [analyticsError, setAnalyticsError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Cloud export consent & out-of-credits dialogs
  const [consentOpen, setConsentOpen] = useState(false)
  const [outOfCreditsOpen, setOutOfCreditsOpen] = useState(false)
  const [cancelExportModalOpen, setCancelExportModalOpen] = useState(false)

  // Morph surface hook for fluid organic flight
  const { surfaceRef, isRendered, requestClose } = useMorphSurface({
    isOpen,
    triggerSelector,
    targetRadius: 16,
    duration: 620,
    onClosed: onClose,
  })

  // Refresh publications on entering Analytics tab
  useEffect(() => {
    if (isOpen && activeTab === 'analytics' && onLoadPublications) {
      void onLoadPublications()
    }
  }, [isOpen, activeTab, onLoadPublications])

  // Fetch analytics when selected publication or range changes
  useEffect(() => {
    if (!isOpen || activeTab !== 'analytics' || !selectedPublicationId || !onAnalytics) return
    let active = true
    setIsLoadingAnalytics(true)
    setAnalyticsError(null)

    void onAnalytics(selectedPublicationId, analyticsRange)
      .then((res) => {
        if (!active) return
        if (res.ok) {
          setAnalyticsData(res.analytics)
        } else {
          setAnalyticsData(null)
          setAnalyticsError(res.error)
        }
      })
      .catch((err) => {
        if (!active) return
        setAnalyticsData(null)
        setAnalyticsError(String(err))
      })
      .finally(() => {
        if (active) setIsLoadingAnalytics(false)
      })

    return () => {
      active = false
    }
  }, [isOpen, activeTab, selectedPublicationId, analyticsRange, onAnalytics])

  // Calculate estimated duration with cuts and speed regions
  const estimatedDuration = useMemo(() => {
    if (duration === 0) return 0
    let finalDuration = duration
    Object.values(cutRegions).forEach((region) => {
      finalDuration -= region.duration
    })
    Object.values(speedRegions).forEach((region) => {
      finalDuration -= region.duration
      finalDuration += region.duration / region.speed
    })
    return Math.max(0, finalDuration)
  }, [duration, cutRegions, speedRegions])

  // Upscale calculation
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
  const isEntitled = entitlement?.pro ?? true
  const proLocked = selectedIsUpscale && !isEntitled
  const cloudReady = cloud !== null && cloud.cloudEnabled

  // Resolution disabled reason
  const resolutionDisabledReason = (key: ResolutionKey): string | null => {
    if (key === '8k' && encoderCapabilities && !encoderCapabilities.libx265) {
      return 'needs HEVC (libx265)'
    }
    if (settings.format === 'gif' && RESOLUTIONS[key].height > GIF_MAX_HEIGHT) {
      return 'GIF is limited to 2K'
    }
    return null
  }

  // Frames count
  const frames = framesFor(estimatedDuration, settings.fps)
  const exportCodec = selectExportCodec(RESOLUTIONS[settings.resolution].height)

  // Local render estimate (for standard local exports)
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

  // Cloud cost calculation
  const cloudCost =
    cloud && frames > 0 && selectedIsUpscale
      ? estimateCloudCredits(cloud.creditsPerFrame, targetDimensions.height, estimatedDuration, settings.fps)
      : null
  const cloudCredits = cloudCost?.credits ?? 0
  const insufficientCredits = cloudCost !== null && balance < cloudCredits
  const creditShortfall = Math.max(0, cloudCredits - balance)

  // Upload duration estimate
  const uploadSeconds =
    cloud && frames > 0 && selectedIsUpscale
      ? (estimateFileMB(estimatedDuration, ASSUMED_BITRATE_MBPS[settings.quality]) * 8) / Math.max(1, cloud.uplinkMbps)
      : 0

  // Estimated publish credits calculation
  const quotedPublishCredits = useMemo(() => {
    if (!capabilities) return 900
    const estMB = estimateFileMB(estimatedDuration > 0 ? estimatedDuration : 30, ASSUMED_BITRATE_MBPS[settings.quality])
    return estimatePublishCredits(capabilities, {
      sizeBytes: Math.round(estMB * 1_000_000),
      storageDays,
      kind: 'page',
    })
  }, [capabilities, estimatedDuration, settings.quality, storageDays])

  const totalPublishCredits = quotedPublishCredits + (selectedIsUpscale ? cloudCredits : 0)
  const insufficientPublishCredits = selectedIsUpscale && cloudCost !== null && balance < totalPublishCredits
  const publishCreditShortfall = Math.max(0, totalPublishCredits - balance)

  // Handle format change
  const handleFormatChange = (newFormat: 'mp4' | 'gif') => {
    setSettings((prev) => {
      const resolution =
        newFormat === 'gif' && RESOLUTIONS[prev.resolution].height > GIF_MAX_HEIGHT ? '1080p' : prev.resolution
      const newExt = newFormat
      const updatedPath = outputPath ? outputPath.replace(/\.(mp4|gif)$/i, `.${newExt}`) : ''
      setOutputPath(updatedPath)
      setLocalFilename((fn) => fn.replace(/\.(mp4|gif)$/i, `.${newExt}`))
      return { ...prev, format: newFormat, resolution }
    })
  }

  // Handle browse destination path
  const handleBrowseSavePath = async () => {
    const res = await window.electronAPI.showSaveDialog({
      title: 'Choose Destination',
      defaultPath: outputPath,
      filters:
        settings.format === 'mp4'
          ? [{ name: 'MP4 Video', extensions: ['mp4'] }]
          : [{ name: 'GIF Animation', extensions: ['gif'] }],
    })
    if (!res.canceled && res.filePath) {
      setOutputPath(res.filePath)
      const filename = res.filePath.split(/[\\/]/).pop()
      if (filename) setLocalFilename(filename)
    }
  }

  // Handle Unlock Pro
  const handleUnlockPro = () => {
    void (async () => {
      const catalogue = (await window.electronAPI.listProducts?.())?.products ?? null
      const productId = firstPurchaseProductId(catalogue)
      if (!productId) {
        useEditorStore.setState({
          purchaseError: 'The credit packs could not be loaded. Check your connection and try again.',
          buyCreditsOpen: false,
          waitingForPayment: true,
          checkoutUserInitiated: false,
        })
        return
      }
      await useEditorStore.getState().startPurchase(productId)
    })()
  }

  // Handle Local / Cloud Export execution
  const executeExport = (isCloud: boolean) => {
    if (!onStartExport) return
    void onStartExport(settings, outputPath, { cloud: isCloud })
  }

  const handleStartExportClick = () => {
    if (isExporting || isPublishing) return
    // If selected resolution requires upscale -> strictly Cloud Upscale
    if (selectedIsUpscale) {
      if (insufficientCredits) {
        setOutOfCreditsOpen(true)
        return
      }
      if (!cloud?.consent) {
        setConsentOpen(true)
        return
      }
      executeExport(true)
    } else {
      executeExport(false)
    }
  }

  // Build full project state for renderAndPublish
  const getProjectStateSnapshot = (): ExportProjectState => {
    return extractExportProjectState(useEditorStore.getState() as unknown as Record<string, unknown>)
  }

  // Handle Cloud Render & Publish click
  const handleTriggerCloudPublish = async () => {
    if (duration <= 0 || isPublishing || isExporting) return

    setPublishOutcome(null)
    setSaveCopySuccess(false)

    if (selectedIsUpscale) {
      if (proLocked) {
        handleUnlockPro()
        return
      }
      if (insufficientPublishCredits) {
        setOutOfCreditsOpen(true)
        return
      }
      if (!cloud?.consent) {
        setConsentOpen(true)
        return
      }
    }

    const cues = includeCaptions && subtitleCues.length > 0 ? subtitleCues : undefined
    const title = cloudTitle.trim() || 'DemoThat Video'

    if (onRenderAndPublish) {
      const outcome = await onRenderAndPublish({
        projectState: getProjectStateSnapshot(),
        exportSettings: {
          format: 'mp4',
          resolution: settings.resolution,
          fps: settings.fps,
          quality: settings.quality,
        },
        publishOptions: {
          kind: 'page',
          storageDays,
          title,
          cues,
        },
        cloud: selectedIsUpscale,
      })
      setPublishOutcome(outcome)
      if (outcome.ok) {
        pushToast({ message: 'Video published successfully!' })
      } else if (outcome.reason !== 'canceled') {
        pushToast({ message: outcome.error || 'Publishing failed.' })
      }
    } else if (onPublish) {
      const outcome = await onPublish({
        filePath: outputPath,
        kind: 'page',
        storageDays,
        title,
        durationSec: duration,
        captions: cues,
      })
      setPublishOutcome(outcome)
      if (outcome.ok) {
        pushToast({ message: 'Video published successfully!' })
      } else if (outcome.reason !== 'canceled') {
        pushToast({ message: outcome.error || 'Publishing failed.' })
      }
    }
  }

  // Handle Save copy of rendered video to computer
  const handleSaveRenderedCopy = async () => {
    try {
      const res = await window.electronAPI.showSaveDialog({
        title: 'Save a Copy of Rendered Video',
        defaultPath: `${localFilename}`,
        filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
      })
      if (!res.canceled && res.filePath) {
        setIsSavingCopy(true)
        if (onSaveRenderedCopy) {
          const outcome = await onSaveRenderedCopy(res.filePath)
          if (outcome.ok) {
            setSaveCopySuccess(true)
            pushToast({ message: 'Copy saved to your computer' })
          } else {
            pushToast({ message: outcome.error || 'Failed to save copy' })
          }
        } else {
          setSaveCopySuccess(true)
          pushToast({ message: 'Copy saved to your computer' })
        }
      }
    } catch (e) {
      pushToast({ message: `Save error: ${e}` })
    } finally {
      setIsSavingCopy(false)
    }
  }

  // Handle publication deletion
  const handleDeletePublication = async (publicationId: string) => {
    if (!onDeletePublication) return
    setIsDeleting(true)
    try {
      const res = await onDeletePublication(publicationId)
      if (res.ok) {
        pushToast({ message: 'Publication deleted' })
        setConfirmDeleteId(null)
        if (selectedPublicationId === publicationId) {
          setSelectedPublicationId(null)
          setAnalyticsData(null)
        }
      } else {
        pushToast({ message: res.error || 'Could not delete publication' })
      }
    } catch (err) {
      pushToast({ message: err instanceof Error ? err.message : 'Could not delete publication' })
    } finally {
      setIsDeleting(false)
    }
  }

  if (!isRendered) return null

  const handleModalClose = () => {
    if (isBusy && onMinimize) {
      onMinimize()
    } else {
      setPublishOutcome(null)
      setSaveCopySuccess(false)
      requestClose()
    }
  }

  // Tab definitions
  const tabs: { id: ModalTab; label: string }[] = [
    { id: 'export', label: 'Export (File)' },
    { id: 'publish', label: 'Publish (Cloud Link)' },
    { id: 'analytics', label: 'Published Videos & Analytics' },
  ]

  // Render Result View (when exportResult exists)
  if (exportResult && activeTab === 'export') {
    const isCancelled = !exportResult.success && exportResult.error === 'Export cancelled.'
    const isCloudCanceled = !exportResult.success && exportResult.cloudReason === 'canceled'
    const isRejected = !exportResult.success && exportResult.cloudReason === 'insufficient_credits'
    const canRetry =
      !exportResult.success && exportResult.canRetryCloud === true && Boolean(exportResult.intermediatePath)
    const retryParams = exportResult.cloudRetry

    return (
      <div className="modal-backdrop flex items-center justify-center" onClick={requestClose}>
        <div
          ref={surfaceRef}
          className="card-clean pointer-events-auto relative m-4 flex w-full max-w-xl flex-col overflow-hidden transition-[height] duration-500 ease-golden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col items-center p-8 text-center">
            {isCancelled || isCloudCanceled ? (
              <Ban size={ICON_SIZE} strokeWidth={ICON_STROKE} className="text-muted" />
            ) : exportResult.success ? (
              <svg
                className="ok-draw h-12 w-12 text-accent"
                viewBox="0 0 64 64"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
              >
                <circle cx="32" cy="32" r="29" />
                <path d="M20 33l8 8 16-18" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <CircleX size={ICON_SIZE} strokeWidth={ICON_STROKE} className="text-danger" />
            )}

            <h2 className="mt-4 text-base font-semibold text-fg">
              {isRejected
                ? 'Not enough credits'
                : isCloudCanceled || isCancelled
                  ? 'Export cancelled'
                  : exportResult.success
                    ? 'Export successful'
                    : canRetry
                      ? "The cloud upscale didn't finish"
                      : 'Export failed'}
            </h2>

            <p className="mt-1 max-w-sm text-xs text-muted">
              {isRejected
                ? exportResult.cost !== undefined
                  ? `This export needs ${formatCredits(exportResult.cost)} credits and the account has ${formatCredits(
                      exportResult.balance ?? 0,
                    )}.`
                  : 'The upscaling service refused this export because the account is out of credits.'
                : isCloudCanceled
                  ? (exportResult.refund ?? 0) > 0
                    ? `${formatCredits(exportResult.charge ?? 0)} credits used, ${formatCredits(
                        exportResult.refund ?? 0,
                      )} returned. No video was saved.`
                    : 'No credits were used. No video was saved.'
                  : isCancelled
                    ? 'The export process was stopped.'
                    : exportResult.success
                      ? 'Your video has been saved to the selected destination.'
                      : canRetry
                        ? 'Your rendered intermediate is still on this computer. You can retry the cloud upscale.'
                        : exportResult.error || 'An unknown error occurred.'}
            </p>

            <div className="mt-6 flex w-full gap-2">
              {exportResult.success ? (
                <>
                  <Button onClick={requestClose} variant="secondary" className="flex-1">
                    Close
                  </Button>
                  <Button
                    onClick={() => {
                      if (exportResult.outputPath) window.electronAPI.showItemInFolder(exportResult.outputPath)
                    }}
                    className="flex-1"
                  >
                    <Folder size={14} strokeWidth={ICON_STROKE} className="mr-1.5" />
                    Open folder
                  </Button>
                </>
              ) : isRejected ? (
                <>
                  <Button onClick={requestClose} variant="secondary" className="flex-1">
                    Close
                  </Button>
                  <Button
                    onClick={() =>
                      useEditorStore
                        .getState()
                        .openBuyCredits(Math.max(0, (exportResult.cost ?? 0) - (exportResult.balance ?? 0)))
                    }
                    className="flex-1"
                  >
                    Buy credits
                  </Button>
                </>
              ) : canRetry &&
                onRetryCloud &&
                exportResult.intermediatePath &&
                exportResult.outputPath &&
                retryParams ? (
                <>
                  <Button onClick={requestClose} variant="secondary" className="flex-1">
                    Close
                  </Button>
                  <Button
                    onClick={() =>
                      onRetryCloud({
                        ...retryParams,
                        intermediatePath: exportResult.intermediatePath!,
                        outputPath: exportResult.outputPath!,
                      })
                    }
                    className="flex-1"
                  >
                    Try again
                  </Button>
                </>
              ) : (
                <Button onClick={requestClose} className="flex-1">
                  Close
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Render Exporting Progress View
  if (isExporting && activeTab === 'export') {
    if (cloudProgress) {
      return (
        <div className="modal-backdrop flex items-center justify-center" onClick={handleModalClose}>
          <div
            ref={surfaceRef}
            className="card-clean pointer-events-auto relative m-4 flex w-full max-w-xl flex-col overflow-hidden transition-[height] duration-500 ease-golden"
            onClick={(e) => e.stopPropagation()}
          >
            {onMinimize && (
              <div className="flex justify-end px-4 pt-3">
                <Button variant="ghost" size="sm" onClick={onMinimize}>
                  Run in background
                </Button>
              </div>
            )}
            <CloudExportProgress
              stage={cloudProgress.stage}
              percent={exportProgress}
              reserved={cloudProgress.reserved}
              consumed={cloudProgress.consumed}
              etaSeconds={cloudProgress.etaSeconds}
              onCancel={() => setCancelExportModalOpen(true)}
            />
            <CancelExportDialog
              isOpen={cancelExportModalOpen}
              stage={cloudProgress.stage}
              reserved={cloudProgress.reserved ?? 0}
              consumed={cloudProgress.consumed ?? 0}
              minChargeCredits={cloudProgress.minChargeCredits ?? 0}
              cost={cloudProgress.reserved ?? 0}
              onKeepExporting={() => setCancelExportModalOpen(false)}
              onConfirmCancel={() => {
                setCancelExportModalOpen(false)
                onCancelExport?.()
              }}
            />
          </div>
        </div>
      )
    }

    return (
      <div className="modal-backdrop flex items-center justify-center" onClick={handleModalClose}>
        <div
          ref={surfaceRef}
          className="card-clean pointer-events-auto relative m-4 flex w-full max-w-xl flex-col overflow-hidden transition-[height] duration-500 ease-golden"
          onClick={(e) => e.stopPropagation()}
        >
          {onMinimize && (
            <div className="flex justify-end px-4 pt-3">
              <Button variant="ghost" size="sm" onClick={onMinimize}>
                Run in background
              </Button>
            </div>
          )}
          <div className="flex flex-col items-center p-8 text-center">
            <Loader2 size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mb-4 animate-spin text-accent" />
            <h2 className="text-base font-semibold text-fg">Exporting video…</h2>
            <p className="mt-1 text-xs text-muted">
              {exportStage ? `${exportStage}…` : 'Rendering frames with composited effects…'}
            </p>
            <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-ctl">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${Math.max(3, exportProgress)}%` }}
              />
            </div>
            <p className="mt-2.5 font-mono text-xs tabular-nums text-muted">{Math.round(exportProgress)}%</p>
            <Button variant="secondary" onClick={onCancelExport} className="mt-6 w-full">
              Cancel
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop flex items-center justify-center" onClick={handleModalClose}>
      <div
        ref={surfaceRef}
        className="card-clean pointer-events-auto relative m-4 flex w-full max-w-2xl flex-col overflow-hidden transition-[height] duration-500 ease-golden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Title and Close */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Share size={16} strokeWidth={ICON_STROKE} className="text-accent" />
            <h2 className="text-sm font-semibold text-fg">Export & Instant Publishing</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={handleModalClose} className="h-8 w-8 p-0">
            <X size={14} strokeWidth={ICON_STROKE} />
          </Button>
        </div>

        {/* Gliding Persistent Tab Bar */}
        <div className="border-b border-line bg-panel px-5 py-2">
          <div className="relative flex rounded-ctl bg-ctl/60 p-1">
            {tabs.map((tab) => {
              const isSelected = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  disabled={isBusy}
                  onClick={() => !isBusy && setActiveTab(tab.id)}
                  className={cn(
                    'relative z-10 flex-1 rounded-pv py-1.5 text-xs font-medium transition-colors duration-200',
                    isSelected ? 'text-fg font-semibold' : 'text-muted hover:text-fg',
                    isBusy && !isSelected && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  {isSelected && (
                    <span className="absolute inset-0 z-[-1] rounded-pv bg-panel shadow-sm transition-all duration-300 ease-golden" />
                  )}
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="max-h-[70vh] overflow-y-auto p-5">
          {/* TAB 1: EXPORT (FILE) */}
          {activeTab === 'export' && (
            <div className="space-y-4">
              {/* Format & Resolution */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted">Format</label>
                  <Select value={settings.format} onValueChange={(v) => handleFormatChange(v as 'mp4' | 'gif')}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mp4">MP4 Video</SelectItem>
                      <SelectItem value="gif">GIF Animation (Max 2K)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted">Resolution (up to 8K)</label>
                  <Select
                    value={settings.resolution}
                    onValueChange={(v) => setSettings((s) => ({ ...s, resolution: v as ResolutionKey }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RESOLUTION_OPTIONS.map((opt) => {
                        const reason = resolutionDisabledReason(opt.key)
                        const isUpscale = upscaleByResolution.get(opt.key)?.isUpscale ?? false
                        return (
                          <SelectItem
                            key={opt.key}
                            value={opt.key}
                            disabled={reason !== null}
                            title={reason ?? undefined}
                          >
                            <span className="flex items-center gap-2">
                              <span>{reason ? `${opt.label} — ${reason}` : opt.label}</span>
                              {isUpscale && <ProBadge />}
                            </span>
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Quality & FPS */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted">Quality</label>
                  <Select
                    value={settings.quality}
                    onValueChange={(v) => setSettings((s) => ({ ...s, quality: v as ExportSettings['quality'] }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted">Frame Rate</label>
                  <Select
                    value={String(settings.fps)}
                    onValueChange={(v) => setSettings((s) => ({ ...s, fps: v === '60' ? 60 : 30 }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">30 FPS</SelectItem>
                      <SelectItem value="60">60 FPS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Strict Cloud-Only Upscaling Notice */}
              {selectedIsUpscale && (
                <div className="rounded-ctl border border-accent/40 bg-accent/5 p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                      <ProBadge /> AI Cloud Upscaling Required
                    </span>
                    <span className="font-mono text-xs font-medium text-accent">
                      {cloudCost ? `${cloudCredits} credits` : 'Calculating…'}
                    </span>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">
                    Upscaling beyond native resolution ({RESOLUTIONS[settings.resolution].width}×
                    {RESOLUTIONS[settings.resolution].height}) is performed exclusively on dedicated cloud GPUs with AI
                    super-resolution.
                  </p>
                  {proLocked && (
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs text-muted">Requires Pro membership.</span>
                      <Button size="sm" onClick={handleUnlockPro}>
                        Unlock Pro
                      </Button>
                    </div>
                  )}
                  {!proLocked && insufficientCredits && (
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs text-danger">
                        Insufficient credits: you have {formatCredits(balance)}, shortfall of{' '}
                        {formatCredits(creditShortfall)}.
                      </span>
                      <Button size="sm" onClick={() => useEditorStore.getState().openBuyCredits(creditShortfall)}>
                        Buy credits
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Destination Output Path */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted">Destination File</label>
                <div className="flex items-center gap-2">
                  <Input
                    value={outputPath}
                    onChange={(e) => setOutputPath(e.target.value)}
                    placeholder="Output path…"
                    className="flex-1 font-mono text-xs"
                  />
                  <Button variant="secondary" size="sm" onClick={handleBrowseSavePath}>
                    Browse…
                  </Button>
                </div>
              </div>

              {/* Estimates Panel */}
              <div className="rounded-ctl border border-line bg-ctl/30 p-3 space-y-2">
                <EstimateRow label="Estimated Duration" value={formatTime(estimatedDuration, true)} />
                {frames > 0 && <EstimateRow label="Total Frames" value={`${frames.toLocaleString()} frames`} />}
                {!selectedIsUpscale && (
                  <EstimateRow
                    label="Estimated Local Render Time"
                    value={
                      localEstimate.seconds <= 0
                        ? '—'
                        : localRange
                          ? `${formatTime(localRange.min, true)} – ${formatTime(localRange.max, true)}`
                          : formatTime(localEstimate.seconds, true)
                    }
                    hint="runs locally on your machine"
                  />
                )}
                {selectedIsUpscale && uploadSeconds > 0 && (
                  <EstimateRow
                    label="Estimated Cloud Upload"
                    value={formatTime(uploadSeconds, true)}
                    hint="cloud compute time reported live during run"
                  />
                )}
                {selectedIsUpscale && cloudCost && (
                  <EstimateRow
                    label="Cloud Cost"
                    value={`${formatCredits(cloudCredits)} credits`}
                    hint={
                      insufficientCredits
                        ? `You have ${formatCredits(balance)}. Need ${formatCredits(creditShortfall)} more.`
                        : `Balance after export: ${formatCredits(Math.max(0, balance - cloudCredits))}`
                    }
                  />
                )}
              </div>

              {/* Bottom Actions */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
                <Button variant="secondary" size="sm" onClick={requestClose}>
                  Cancel
                </Button>
                {selectedIsUpscale && insufficientCredits ? (
                  <Button size="sm" onClick={() => useEditorStore.getState().openBuyCredits(creditShortfall)}>
                    Buy credits
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={handleStartExportClick}
                    disabled={
                      !outputPath ||
                      proLocked ||
                      (selectedIsUpscale && !cloudReady) ||
                      duration <= 0 ||
                      isExporting ||
                      isPublishing
                    }
                  >
                    {selectedIsUpscale ? 'Export with Cloud AI' : 'Export Video'}
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: PUBLISH (CLOUD LINK) */}
          {activeTab === 'publish' && (
            <div className="space-y-4">
              {publishOutcome ? (
                /* Post-Publish Success Screen */
                <div className="space-y-4">
                  {publishOutcome.ok ? (
                    <>
                      <div className="flex items-center gap-2 rounded-ctl border border-accent/30 bg-accent/10 p-3 text-xs font-medium text-fg">
                        <CircleCheck size={18} strokeWidth={ICON_STROKE} className="text-accent shrink-0" />
                        <span>Video published successfully! Your share links are active.</span>
                      </div>

                      {/* Links Card */}
                      <div className="rounded-ctl border border-line bg-ctl/30 p-3 space-y-2.5">
                        {publishOutcome.publication.links.pageUrl && (
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <div className="min-w-0">
                              <span className="font-medium text-muted">Landing Page</span>
                              <div
                                className="truncate font-mono text-fg"
                                title={publishOutcome.publication.links.pageUrl}
                              >
                                {publishOutcome.publication.links.pageUrl}
                              </div>
                            </div>
                            <CopyButton
                              value={publishOutcome.publication.links.pageUrl}
                              label="Landing Page URL"
                              onCopied={onCopied}
                            />
                          </div>
                        )}
                        {publishOutcome.publication.links.embedUrl && (
                          <div className="flex items-center justify-between gap-3 text-xs border-t border-line/40 pt-2">
                            <div className="min-w-0">
                              <span className="font-medium text-muted">Embed Player</span>
                              <div
                                className="truncate font-mono text-fg"
                                title={publishOutcome.publication.links.embedUrl}
                              >
                                {publishOutcome.publication.links.embedUrl}
                              </div>
                            </div>
                            <CopyButton
                              value={publishOutcome.publication.links.embedUrl}
                              label="Embed URL"
                              onCopied={onCopied}
                            />
                          </div>
                        )}
                        {publishOutcome.publication.links.embedCode && (
                          <div className="flex items-center justify-between gap-3 text-xs border-t border-line/40 pt-2">
                            <div className="min-w-0">
                              <span className="font-medium text-muted">Embed HTML Code</span>
                              <div
                                className="truncate font-mono text-fg"
                                title={publishOutcome.publication.links.embedCode}
                              >
                                {publishOutcome.publication.links.embedCode}
                              </div>
                            </div>
                            <CopyButton
                              value={publishOutcome.publication.links.embedCode}
                              label="Embed HTML Code"
                              onCopied={onCopied}
                            />
                          </div>
                        )}
                        {publishOutcome.publication.links.videoDownloadUrl && (
                          <div className="flex items-center justify-between gap-3 text-xs border-t border-line/40 pt-2">
                            <div className="min-w-0">
                              <span className="font-medium text-muted">Direct Download</span>
                              <div
                                className="truncate font-mono text-fg"
                                title={publishOutcome.publication.links.videoDownloadUrl}
                              >
                                {publishOutcome.publication.links.videoDownloadUrl}
                              </div>
                            </div>
                            <CopyButton
                              value={publishOutcome.publication.links.videoDownloadUrl}
                              label="Download URL"
                              onCopied={onCopied}
                            />
                          </div>
                        )}
                        {publishOutcome.publication.links.captionsDownloadUrl && (
                          <div className="flex items-center justify-between gap-3 text-xs border-t border-line/40 pt-2">
                            <div className="min-w-0">
                              <span className="font-medium text-muted">Captions (VTT)</span>
                              <div
                                className="truncate font-mono text-fg"
                                title={publishOutcome.publication.links.captionsDownloadUrl}
                              >
                                {publishOutcome.publication.links.captionsDownloadUrl}
                              </div>
                            </div>
                            <CopyButton
                              value={publishOutcome.publication.links.captionsDownloadUrl}
                              label="Captions URL"
                              onCopied={onCopied}
                            />
                          </div>
                        )}
                      </div>

                      {/* Post-Publish Prompt: Save Copy to Computer */}
                      <div className="rounded-ctl border border-line bg-panel p-3.5 space-y-2">
                        <span className="text-xs font-semibold text-fg">Save a copy to your computer?</span>
                        <p className="text-xs text-muted">
                          Your video has already been rendered with all composited effects. You can save a copy directly
                          to your disk without re-rendering.
                        </p>
                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleSaveRenderedCopy}
                            disabled={isSavingCopy || saveCopySuccess}
                          >
                            {isSavingCopy ? (
                              <Loader2 size={14} className="mr-1.5 animate-spin text-accent" />
                            ) : saveCopySuccess ? (
                              <CircleCheck size={14} className="mr-1.5 text-accent" />
                            ) : (
                              <Folder size={14} className="mr-1.5 text-muted" />
                            )}
                            {saveCopySuccess ? 'Saved' : 'Save to Computer…'}
                          </Button>
                        </div>
                      </div>

                      {/* Done and View in Analytics Actions */}
                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setActiveTab('analytics')
                            setPublishOutcome(null)
                            setSaveCopySuccess(false)
                          }}
                        >
                          View in Analytics
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setPublishOutcome(null)
                            setSaveCopySuccess(false)
                            requestClose()
                          }}
                        >
                          Done
                        </Button>
                      </div>
                    </>
                  ) : (
                    /* Error view */
                    <div className="space-y-3 p-4 text-center">
                      <CircleX size={32} strokeWidth={ICON_STROKE} className="mx-auto text-danger" />
                      <h3 className="text-sm font-semibold text-fg">Publishing Failed</h3>
                      <p className="text-xs text-muted">{publishOutcome.error}</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setPublishOutcome(null)
                          setSaveCopySuccess(false)
                        }}
                      >
                        Back to Settings
                      </Button>
                    </div>
                  )}
                </div>
              ) : isPublishing ? (
                /* Dual-Stage Progress */
                <div className="flex flex-col items-center p-8 text-center">
                  {onMinimize && (
                    <div className="flex w-full justify-end -mt-4 mb-2">
                      <Button variant="ghost" size="sm" onClick={onMinimize}>
                        Run in background
                      </Button>
                    </div>
                  )}
                  <Loader2 size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mb-4 animate-spin text-accent" />
                  <h3 className="text-sm font-semibold text-fg">
                    {publishProgress?.stage === 'Rendering' ? 'Rendering with all effects…' : 'Publishing to cloud…'}
                  </h3>
                  <p className="mt-1 text-xs text-muted">
                    {publishProgress?.stage === 'Rendering'
                      ? 'Stitching camera feed, mouse click animations, and zoom motions…'
                      : 'Uploading and generating instant share links…'}
                  </p>
                  <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-ctl">
                    <div
                      className="h-full bg-accent transition-all duration-300"
                      style={{ width: `${Math.max(3, publishProgress?.stagePercent ?? 0)}%` }}
                    />
                  </div>
                  <p className="mt-2 font-mono text-xs tabular-nums text-muted">
                    {Math.round(publishProgress?.stagePercent ?? 0)}%
                  </p>
                  <Button variant="secondary" size="sm" onClick={onCancelPublish} className="mt-6">
                    Cancel
                  </Button>
                </div>
              ) : (
                /* Publish Form */
                <div className="space-y-4">
                  {/* Quality Settings */}
                  <div className="grid grid-cols-3 gap-2.5">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted">Resolution</label>
                      <Select
                        value={settings.resolution}
                        onValueChange={(v) => setSettings((s) => ({ ...s, resolution: v as ResolutionKey }))}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RESOLUTION_OPTIONS.map((opt) => {
                            const isUpscale = upscaleByResolution.get(opt.key)?.isUpscale ?? false
                            return (
                              <SelectItem key={opt.key} value={opt.key}>
                                <span className="flex items-center gap-2">
                                  <span>{opt.label}</span>
                                  {isUpscale && <ProBadge />}
                                </span>
                              </SelectItem>
                            )
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted">Quality</label>
                      <Select
                        value={settings.quality}
                        onValueChange={(v) => setSettings((s) => ({ ...s, quality: v as ExportSettings['quality'] }))}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted">Frame Rate</label>
                      <Select
                        value={String(settings.fps)}
                        onValueChange={(v) => setSettings((s) => ({ ...s, fps: v === '60' ? 60 : 30 }))}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="30">30 FPS</SelectItem>
                          <SelectItem value="60">60 FPS</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Title */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted">Title</label>
                    <Input
                      value={cloudTitle}
                      onChange={(e) => setCloudTitle(e.target.value)}
                      placeholder="Video Title…"
                      maxLength={180}
                      className="text-xs"
                    />
                  </div>

                  {/* Hosting Duration */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted">Hosting Duration</label>
                    <Select value={String(storageDays)} onValueChange={(v) => setStorageDays(Number(v))}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="30">30 Days</SelectItem>
                        <SelectItem value="90">90 Days</SelectItem>
                        <SelectItem value="365">1 Year</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted">
                      Publishes hosted landing page, responsive embed player, embed code snippet, and direct download
                      links all at once.
                    </p>
                  </div>

                  {/* Captions inclusion */}
                  {subtitleCues.length > 0 && (
                    <div className="flex items-center justify-between rounded-ctl border border-line bg-ctl/30 p-3">
                      <div className="text-xs">
                        <span className="font-medium text-fg">Include Captions</span>
                        <p className="text-muted">Includes {subtitleCues.length} subtitle cues with player track</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={includeCaptions}
                        onChange={(e) => setIncludeCaptions(e.target.checked)}
                        className="rounded border-line bg-ctl text-accent"
                      />
                    </div>
                  )}

                  {/* Publishing Cost & Balance */}
                  <div className="rounded-ctl border border-line bg-ctl/30 p-3 space-y-1.5 text-xs">
                    {selectedIsUpscale && (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-muted">
                            <ProBadge />
                            <span>
                              Cloud AI Upscaling ({targetDimensions.width}×{targetDimensions.height})
                            </span>
                          </span>
                          <span className="font-medium text-fg">
                            {cloudCost ? `${cloudCredits} credits` : 'Calculating…'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted">Publish CDN Storage</span>
                          <span className="font-medium text-fg">{quotedPublishCredits} credits</span>
                        </div>
                        <div className="flex items-center justify-between border-t border-line/60 pt-1 font-semibold">
                          <span className="text-fg">Total Credits</span>
                          <span className="text-accent">{totalPublishCredits} credits</span>
                        </div>
                      </>
                    )}
                    {!selectedIsUpscale && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted">Estimated Publish Storage</span>
                        <span className="font-medium text-fg">{quotedPublishCredits} credits</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-muted pt-0.5">
                      <span>Account Balance</span>
                      <span>{formatCredits(balance)}</span>
                    </div>
                  </div>

                  {selectedIsUpscale && (
                    <div className="rounded-ctl border border-line bg-panel p-3 text-xs text-muted space-y-1">
                      <div className="flex items-center gap-1.5 font-medium text-fg">
                        <Cloud size={14} className="text-accent" />
                        <ProBadge />
                        <span>Automated Cloud AI Upscaling</span>
                      </div>
                      <p>
                        Target resolution ({targetDimensions.width}×{targetDimensions.height}) exceeds source recording.
                        The app will automatically render, AI-upscale on dedicated cloud GPUs, and publish with all
                        effects intact.
                      </p>
                    </div>
                  )}

                  {selectedIsUpscale && insufficientPublishCredits && (
                    <div className="rounded-ctl border border-danger/30 bg-danger/5 p-3 text-xs space-y-2">
                      <p className="text-fg">
                        Insufficient credits for upscaled publishing ({publishCreditShortfall} credits short).
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 text-xs text-accent"
                        onClick={() => useEditorStore.getState().openBuyCredits(publishCreditShortfall)}
                      >
                        Buy Credits
                      </Button>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
                    <Button variant="secondary" size="sm" onClick={requestClose}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleTriggerCloudPublish}
                      disabled={
                        duration <= 0 ||
                        isPublishing ||
                        isExporting ||
                        (selectedIsUpscale && (insufficientPublishCredits || !cloudReady))
                      }
                    >
                      {selectedIsUpscale ? 'Upscale & Publish' : 'Render & Publish'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: PUBLISHED VIDEOS & ANALYTICS */}
          {activeTab === 'analytics' && (
            <div className="space-y-4">
              {publications.length === 0 && !isLoadingList ? (
                <div className="flex flex-col items-center justify-center p-8 text-center">
                  <Share size={32} strokeWidth={ICON_STROKE} className="mb-2 text-muted" />
                  <h3 className="text-sm font-semibold text-fg">No Published Videos Yet</h3>
                  <p className="mt-1 max-w-xs text-xs text-muted">
                    Publish your first video to share with landing pages, embeddable players, and track viewer
                    analytics.
                  </p>
                  <Button size="sm" onClick={() => setActiveTab('publish')} className="mt-4">
                    Publish Video Now
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted">
                      {publications.length} Published Video{publications.length === 1 ? '' : 's'}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onLoadPublications?.()}
                      disabled={isLoadingList}
                      className="h-7 text-xs"
                    >
                      <Refresh size={12} className={cn('mr-1', isLoadingList && 'animate-spin')} />
                      Refresh
                    </Button>
                  </div>

                  {/* Publication List */}
                  <div className="space-y-2">
                    {publications.map((pub) => {
                      const isSelected = selectedPublicationId === pub.publicationId
                      return (
                        <div
                          key={pub.publicationId}
                          className={cn(
                            'rounded-ctl border p-3 transition-colors duration-150',
                            isSelected
                              ? 'border-accent bg-accent/5'
                              : 'border-line/60 bg-ctl/20 hover:border-accent/40',
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div
                              className="min-w-0 flex-1 cursor-pointer"
                              onClick={() => setSelectedPublicationId(isSelected ? null : pub.publicationId)}
                            >
                              <div className="flex items-center gap-2">
                                <span className="truncate text-xs font-semibold text-fg">
                                  {pub.title || 'Untitled Publication'}
                                </span>
                                <span
                                  className={cn(
                                    'rounded px-1.5 py-0.5 text-[11px] font-medium capitalize',
                                    pub.status === 'active' ? 'bg-accent/15 text-accent' : 'bg-muted/20 text-muted',
                                  )}
                                >
                                  {pub.status}
                                </span>
                              </div>
                              <p className="mt-0.5 text-xs text-muted">
                                Expires {formatDate(pub.expiresAt)} · {formatBytes(pub.sizeBytes ?? 0)}
                              </p>
                            </div>

                            <div className="flex items-center gap-1.5">
                              {pub.links?.pageUrl && (
                                <CopyButton value={pub.links.pageUrl} label="URL" onCopied={onCopied} />
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-muted hover:text-danger"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setConfirmDeleteId(pub.publicationId)
                                }}
                              >
                                <Trash size={14} strokeWidth={ICON_STROKE} />
                              </Button>
                            </div>
                          </div>

                          {/* Delete Confirmation Card */}
                          {confirmDeleteId === pub.publicationId && (
                            <div className="mt-2.5 rounded-ctl border border-danger/30 bg-danger/5 p-2.5 space-y-2">
                              <p className="text-xs text-fg">
                                Delete this publication? The link will stop working immediately. Credits are
                                non-refundable.
                              </p>
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="h-7 text-xs"
                                >
                                  Cancel
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleDeletePublication(pub.publicationId)}
                                  disabled={isDeleting}
                                  className="h-7 text-xs"
                                >
                                  {isDeleting ? <Loader2 size={12} className="animate-spin" /> : 'Delete'}
                                </Button>
                              </div>
                            </div>
                          )}

                          {/* Expanded Details: Share Links & Viewer Analytics */}
                          {isSelected && (
                            <div className="mt-3 border-t border-line/40 pt-3 space-y-3">
                              {/* Share Links */}
                              <div className="space-y-1.5">
                                <span className="text-xs font-semibold text-fg">Share Links</span>
                                <div className="rounded-ctl border border-line bg-ctl/30 p-2.5 space-y-2 text-xs">
                                  {pub.links?.pageUrl && (
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="min-w-0">
                                        <span className="text-muted block text-[11px]">Landing Page</span>
                                        <div className="truncate font-mono text-fg" title={pub.links.pageUrl}>
                                          {pub.links.pageUrl}
                                        </div>
                                      </div>
                                      <CopyButton
                                        value={pub.links.pageUrl}
                                        label="Landing Page URL"
                                        onCopied={onCopied}
                                      />
                                    </div>
                                  )}
                                  {pub.links?.embedUrl && (
                                    <div className="flex items-center justify-between gap-2 border-t border-line/40 pt-1.5">
                                      <div className="min-w-0">
                                        <span className="text-muted block text-[11px]">Embed Player</span>
                                        <div className="truncate font-mono text-fg" title={pub.links.embedUrl}>
                                          {pub.links.embedUrl}
                                        </div>
                                      </div>
                                      <CopyButton value={pub.links.embedUrl} label="Embed URL" onCopied={onCopied} />
                                    </div>
                                  )}
                                  {pub.links?.embedCode && (
                                    <div className="flex items-center justify-between gap-2 border-t border-line/40 pt-1.5">
                                      <div className="min-w-0">
                                        <span className="text-muted block text-[11px]">Embed HTML Code</span>
                                        <div className="truncate font-mono text-fg" title={pub.links.embedCode}>
                                          {pub.links.embedCode}
                                        </div>
                                      </div>
                                      <CopyButton
                                        value={pub.links.embedCode}
                                        label="Embed HTML Code"
                                        onCopied={onCopied}
                                      />
                                    </div>
                                  )}
                                  {pub.links?.videoDownloadUrl && (
                                    <div className="flex items-center justify-between gap-2 border-t border-line/40 pt-1.5">
                                      <div className="min-w-0">
                                        <span className="text-muted block text-[11px]">Direct Download</span>
                                        <div className="truncate font-mono text-fg" title={pub.links.videoDownloadUrl}>
                                          {pub.links.videoDownloadUrl}
                                        </div>
                                      </div>
                                      <CopyButton
                                        value={pub.links.videoDownloadUrl}
                                        label="Download URL"
                                        onCopied={onCopied}
                                      />
                                    </div>
                                  )}
                                  {pub.links?.captionsDownloadUrl && (
                                    <div className="flex items-center justify-between gap-2 border-t border-line/40 pt-1.5">
                                      <div className="min-w-0">
                                        <span className="text-muted block text-[11px]">Captions (VTT)</span>
                                        <div
                                          className="truncate font-mono text-fg"
                                          title={pub.links.captionsDownloadUrl}
                                        >
                                          {pub.links.captionsDownloadUrl}
                                        </div>
                                      </div>
                                      <CopyButton
                                        value={pub.links.captionsDownloadUrl}
                                        label="Captions URL"
                                        onCopied={onCopied}
                                      />
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Viewer Analytics */}
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-semibold text-fg">Viewer Analytics</span>
                                  <div className="flex rounded-ctl bg-ctl p-0.5 text-[11px]">
                                    {(['7d', '30d', '90d', 'all'] as PublicationAnalyticsRange[]).map((r) => (
                                      <button
                                        key={r}
                                        type="button"
                                        onClick={() => setAnalyticsRange(r)}
                                        className={cn(
                                          'rounded px-2 py-0.5 uppercase transition-colors',
                                          analyticsRange === r
                                            ? 'bg-panel font-semibold text-fg shadow-sm'
                                            : 'text-muted hover:text-fg',
                                        )}
                                      >
                                        {r}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {isLoadingAnalytics ? (
                                  <div className="flex items-center justify-center py-4 text-xs text-muted">
                                    <Loader2 size={14} className="mr-1.5 animate-spin text-accent" />
                                    Loading analytics…
                                  </div>
                                ) : analyticsData ? (
                                  <div className="grid grid-cols-3 gap-2">
                                    <div className="rounded-ctl bg-panel p-2.5 text-center">
                                      <span className="block text-xs text-muted">Total Views</span>
                                      <span className="font-mono text-sm font-semibold text-fg">
                                        {analyticsData.totals.views.toLocaleString()}
                                      </span>
                                    </div>
                                    <div className="rounded-ctl bg-panel p-2.5 text-center">
                                      <span className="block text-xs text-muted">Avg Watch</span>
                                      <span className="font-mono text-sm font-semibold text-fg">
                                        {formatDuration(analyticsData.totals.avgWatchSeconds)}
                                      </span>
                                    </div>
                                    <div className="rounded-ctl bg-panel p-2.5 text-center">
                                      <span className="block text-xs text-muted">Completion</span>
                                      <span className="font-mono text-sm font-semibold text-fg">
                                        {Math.round(analyticsData.totals.completionRate * 100)}%
                                      </span>
                                    </div>
                                  </div>
                                ) : analyticsError ? (
                                  <p className="text-xs text-danger">{analyticsError}</p>
                                ) : null}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Cloud Consent & Out of Credits Dialogs */}
        <CloudConsentDialog
          isOpen={consentOpen}
          onClose={() => setConsentOpen(false)}
          onContinue={(dontAskAgain) => {
            setConsentOpen(false)
            if (dontAskAgain) void window.electronAPI.setCloudConsent(true)
            executeExport(true)
          }}
        />

        <OutOfCreditsDialog
          isOpen={outOfCreditsOpen}
          cost={cloudCredits}
          balance={balance}
          onClose={() => setOutOfCreditsOpen(false)}
        />
      </div>
    </div>
  )
}
