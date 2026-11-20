import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CircleCheck, ExternalLink, FileDownload, Folder, Loader2, Refresh, Share, Trash, X } from 'tabler-icons-react'
import { ICON_SIZE, ICON_STROKE } from '../../ui/icons'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { useEditorStore } from '../../../store/editorStore'
import { useMorphSurface } from '../../../hooks/useMorphSurface'
import { cn } from '../../../lib/utils'
import { RESOLUTIONS, type ResolutionKey } from '../../../../shared/export-resolutions'
import {
  creditsToUsd,
  estimatePublishCredits,
  formatBytes,
  type PublicationKind,
  type PublishingCapabilities,
} from '../../../../shared/publish-cost'
import { formatCredits } from '../../../../shared/license'
import { ASSUMED_BITRATE_MBPS, estimateFileMB, estimateLocalSeconds, framesFor } from '../../../lib/export-estimate'
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
import type { ExportResult } from '../../../hooks/useExportProcess'

export type ExportSettings = {
  format: 'mp4' | 'gif'
  resolution: ResolutionKey
  fps: 30 | 60
  quality: 'low' | 'medium' | 'high'
}

export type ModalTab = 'export-publish' | 'analytics'
export type WorkflowMode = 'local' | 'cloud'

export interface UnifiedExportPublishModalProps {
  isOpen: boolean
  onClose: () => void
  initialTab?: ModalTab
  initialMode?: WorkflowMode
  triggerSelector?: string

  // Local export props
  isExporting?: boolean
  exportProgress?: number
  exportStage?: string | null
  exportResult?: ExportResult | null
  onStartExport?: (settings: ExportSettings, outputPath: string) => Promise<void> | void
  onCancelExport?: () => void

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

/** Overlapping crossfade text helper */
function CrossfadeText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn('inline-grid items-center', className)}>
      <span key={text} className="col-start-1 row-start-1 transition-all duration-300 ease-golden animate-in fade-in">
        {text}
      </span>
    </span>
  )
}

export function UnifiedExportPublishModal({
  isOpen,
  onClose,
  initialTab = 'export-publish',
  initialMode = 'local',
  triggerSelector = '#export-trigger-btn',
  isExporting = false,
  exportProgress = 0,
  exportStage,
  exportResult,
  onStartExport,
  onCancelExport,
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
  // Store values
  const { duration, currentProjectPath, subtitleCues, balance, pushToast } = useEditorStore(
    useShallow((state) => ({
      duration: state.duration,
      currentProjectPath: state.currentProjectPath,
      subtitleCues: state.subtitleCues,
      balance: state.balance,
      pushToast: state.pushToast,
    })),
  )

  // Active persistent tab and mode
  const [activeTab, setActiveTab] = useState<ModalTab>(initialTab)
  const [mode, setMode] = useState<WorkflowMode>(initialMode)

  // Sync initial tab & mode when modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab)
      setMode(initialMode)
      setPublishOutcome(null)
      setSaveCopySuccess(false)
    }
  }, [isOpen, initialTab, initialMode])

  // Quality settings (shared)
  const [settings, setSettings] = useState<ExportSettings>({
    format: 'mp4',
    resolution: '1080p',
    fps: 30,
    quality: 'medium',
  })

  // Local export settings
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

  // Cloud publish settings
  const [kind, setKind] = useState<PublicationKind>('page')
  const [storageDays, setStorageDays] = useState<number>(365)
  const [cloudTitle, setCloudTitle] = useState('')
  const [includeCaptions, setIncludeCaptions] = useState(true)

  // Initialize cloud title from current project name
  useEffect(() => {
    if (currentProjectPath) {
      const parts = currentProjectPath.split(/[\\/]/)
      const base = parts[parts.length - 1]?.replace(/\.demothat$/, '') ?? 'My Video'
      setCloudTitle(base)
    } else {
      setCloudTitle('DemoThat Video')
    }
  }, [currentProjectPath])

  // Set default storageDays and kind from capabilities
  const capabilities: PublishingCapabilities | null = publishStatus?.publishing ?? null
  useEffect(() => {
    if (capabilities) {
      setStorageDays(capabilities.defaultDurationDays)
      setKind(capabilities.kinds.includes('page') ? 'page' : (capabilities.kinds[0] ?? 'links'))
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

  // Morph surface hook for fluid organic flight to/from button trigger
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

  // Estimated file size calculation
  const estimatedMB = useMemo(() => {
    const dur = duration > 0 ? duration : 30
    const bitrate = ASSUMED_BITRATE_MBPS[settings.quality]
    return estimateFileMB(dur, bitrate)
  }, [duration, settings.quality])

  const estimatedSizeBytes = useMemo(() => {
    return Math.round(estimatedMB * 1_000_000)
  }, [estimatedMB])

  // Estimated local render seconds
  const estimatedSeconds = useMemo(() => {
    const frames = framesFor(duration > 0 ? duration : 30, settings.fps)
    const { width, height } = RESOLUTIONS[settings.resolution]
    return estimateLocalSeconds({
      frames,
      targetWidth: width,
      targetHeight: height,
      resolution: settings.resolution,
      codec: 'h264',
      settingFps: settings.fps,
      samples: [],
    }).seconds
  }, [duration, settings.fps, settings.resolution])

  // Estimated publish credits calculation
  const quotedCredits = useMemo(() => {
    if (!capabilities) return 900
    return estimatePublishCredits(capabilities, {
      sizeBytes: estimatedSizeBytes,
      storageDays,
      kind,
    })
  }, [capabilities, estimatedSizeBytes, storageDays, kind])

  // Handle browse folder / save path
  const handleBrowseSavePath = async () => {
    const res = await window.electronAPI.showSaveDialog({
      title: 'Choose Destination',
      defaultPath: outputPath,
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
    })
    if (!res.canceled && res.filePath) {
      setOutputPath(res.filePath)
      const filename = res.filePath.split(/[\\/]/).pop()
      if (filename) setLocalFilename(filename)
    }
  }

  // Handle Local Export click
  const handleTriggerLocalExport = async () => {
    if (!onStartExport) return
    await onStartExport(settings, outputPath)
  }

  // Build full project state for renderAndPublish
  const getProjectStateSnapshot = (): ExportProjectState => {
    return extractExportProjectState(useEditorStore.getState() as unknown as Record<string, unknown>)
  }

  // Handle Cloud Render & Publish click
  const handleTriggerCloudPublish = async () => {
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
          kind,
          storageDays,
          title,
          cues,
        },
      })
      setPublishOutcome(outcome)
    } else if (onPublish) {
      // Fallback if rendered path already exists
      const outcome = await onPublish({
        filePath: outputPath,
        kind,
        storageDays,
        title,
        durationSec: duration,
        captions: cues,
      })
      setPublishOutcome(outcome)
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
    } finally {
      setIsDeleting(false)
    }
  }

  if (!isRendered) return null

  // Resolution selection choices (720p, 1080p, 4k)
  const resolutionChoices: { key: ResolutionKey; label: string; sub: string }[] = [
    { key: '720p', label: '720p', sub: 'HD' },
    { key: '1080p', label: '1080p', sub: 'Full HD' },
    { key: '4k', label: '4K', sub: 'Ultra HD' },
  ]

  // Quality choices
  const qualityChoices: { key: 'low' | 'medium' | 'high'; label: string }[] = [
    { key: 'low', label: 'Low' },
    { key: 'medium', label: 'Medium' },
    { key: 'high', label: 'High' },
  ]

  // FPS choices
  const fpsChoices: (30 | 60)[] = [30, 60]

  // Term options for cloud publish
  const termChoices = [
    { days: 30, label: '30 Days' },
    { days: 90, label: '90 Days' },
    { days: 365, label: '1 Year' },
  ]

  // Kind options for cloud publish
  const kindChoices: { kind: PublicationKind; label: string; desc: string }[] = [
    {
      kind: 'page',
      label: 'Landing page',
      desc: 'Hosted page with player, share links, and download',
    },
    {
      kind: 'embed',
      label: 'Embed',
      desc: 'Embeddable player code for blogs, docs, and apps',
    },
    {
      kind: 'links',
      label: 'Direct links',
      desc: 'Direct video and captions download URLs only',
    },
  ]

  // Published video object if publish was successful
  const successfulPublication = publishOutcome?.ok ? publishOutcome.publication : null

  return (
    <div className="modal-backdrop flex items-center justify-center p-4" onClick={requestClose}>
      <div
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unified-modal-title"
        className="card-clean pointer-events-auto relative flex w-full max-w-2xl flex-col overflow-hidden transition-[height] duration-500 ease-golden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-line bg-panel px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-ctl bg-ctl text-accent">
              <Share size={18} strokeWidth={ICON_STROKE} />
            </div>
            <div>
              <h2 id="unified-modal-title" className="text-title font-semibold text-fg">
                <CrossfadeText
                  text={activeTab === 'export-publish' ? 'Export & Publish' : 'Published Videos & Analytics'}
                />
              </h2>
              <p className="text-xs text-muted">
                {activeTab === 'export-publish'
                  ? 'Render your demo locally or publish it instantly to the cloud'
                  : 'Manage active links and view viewer engagement analytics'}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={requestClose}
            aria-label="Close dialog"
            className="h-8 w-8 rounded-ctl text-muted hover:bg-ctl hover:text-fg"
          >
            <X size={16} strokeWidth={ICON_STROKE} />
          </Button>
        </div>

        {/* Persistent Top Navigation Tabs with Sliding Pill */}
        <div className="border-b border-line bg-panel/50 px-6 pt-3 pb-3">
          <div className="relative flex rounded-ctl bg-ctl p-1 border border-line">
            {/* Gliding pill indicator */}
            <div
              className="absolute top-1 bottom-1 rounded-[5px] bg-panel shadow-sm transition-all duration-400 ease-golden"
              style={{
                left: activeTab === 'export-publish' ? '4px' : 'calc(50% + 2px)',
                width: 'calc(50% - 6px)',
              }}
            />
            <button
              type="button"
              onClick={() => setActiveTab('export-publish')}
              className={cn(
                'relative z-10 flex-1 py-1.5 px-3 text-ui font-medium text-center transition-colors duration-200',
                activeTab === 'export-publish' ? 'text-fg font-semibold' : 'text-muted hover:text-fg',
              )}
            >
              Export & Publish
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('analytics')}
              className={cn(
                'relative z-10 flex-1 py-1.5 px-3 text-ui font-medium text-center transition-colors duration-200',
                activeTab === 'analytics' ? 'text-fg font-semibold' : 'text-muted hover:text-fg',
              )}
            >
              Published Videos & Analytics
            </button>
          </div>
        </div>

        {/* Modal Body Container with Smooth Transition */}
        <div className="max-h-[72vh] overflow-y-auto px-6 py-5 stable-scrollbar">
          {activeTab === 'export-publish' ? (
            /* TAB 1: EXPORT & PUBLISH */
            <div className="space-y-6">
              {/* Common Video Quality Settings */}
              <div className="space-y-3 rounded-pv border border-line bg-panel p-4">
                <div className="flex items-center justify-between">
                  <span className="text-label font-semibold uppercase tracking-wider text-muted">
                    Video Quality Settings
                  </span>
                  <span className="font-mono text-xs text-muted">
                    Est. size: ~
                    {estimatedMB >= 1000 ? `${(estimatedMB / 1000).toFixed(1)} GB` : `${Math.round(estimatedMB)} MB`}
                  </span>
                </div>

                {/* Resolution */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-fg">Resolution</label>
                  <div className="grid grid-cols-3 gap-2">
                    {resolutionChoices.map((res) => {
                      const isSelected = settings.resolution === res.key
                      return (
                        <button
                          key={res.key}
                          type="button"
                          onClick={() => setSettings((prev) => ({ ...prev, resolution: res.key }))}
                          className={cn(
                            'flex flex-col items-center justify-center rounded-ctl border py-2 px-3 text-center transition-all duration-200',
                            isSelected
                              ? 'border-accent bg-accent/15 text-accent font-semibold shadow-sm'
                              : 'border-line bg-ctl text-fg hover:bg-ctl-hover',
                          )}
                        >
                          <span className="text-ui font-medium">{res.label}</span>
                          <span className="text-[11px] text-muted">{res.sub}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Quality & FPS Row */}
                <div className="grid grid-cols-2 gap-4 pt-1">
                  {/* Quality */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-fg">Quality</label>
                    <div className="grid grid-cols-3 gap-1 rounded-ctl bg-ctl p-1 border border-line">
                      {qualityChoices.map((q) => {
                        const isSelected = settings.quality === q.key
                        return (
                          <button
                            key={q.key}
                            type="button"
                            onClick={() => setSettings((prev) => ({ ...prev, quality: q.key }))}
                            className={cn(
                              'rounded-[5px] py-1 text-center text-xs transition-all duration-200',
                              isSelected ? 'bg-panel font-semibold text-fg shadow-sm' : 'text-muted hover:text-fg',
                            )}
                          >
                            {q.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* FPS */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-fg">Frame Rate</label>
                    <div className="grid grid-cols-2 gap-1 rounded-ctl bg-ctl p-1 border border-line">
                      {fpsChoices.map((f) => {
                        const isSelected = settings.fps === f
                        return (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setSettings((prev) => ({ ...prev, fps: f }))}
                            className={cn(
                              'rounded-[5px] py-1 text-center text-xs transition-all duration-200',
                              isSelected ? 'bg-panel font-semibold text-fg shadow-sm' : 'text-muted hover:text-fg',
                            )}
                          >
                            {f} fps
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Workflow Mode Selector with Gliding Indicator */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-label font-semibold uppercase tracking-wider text-muted">Destination Mode</span>
                </div>
                <div className="relative flex rounded-ctl bg-ctl p-1 border border-line">
                  {/* Gliding pill indicator */}
                  <div
                    className="absolute top-1 bottom-1 rounded-[5px] bg-panel shadow-sm transition-all duration-400 ease-golden"
                    style={{
                      left: mode === 'local' ? '4px' : 'calc(50% + 2px)',
                      width: 'calc(50% - 6px)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setMode('local')}
                    className={cn(
                      'relative z-10 flex-1 py-1.5 px-3 text-ui font-medium text-center transition-colors duration-200',
                      mode === 'local' ? 'text-fg font-semibold' : 'text-muted hover:text-fg',
                    )}
                  >
                    Local Export
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('cloud')}
                    className={cn(
                      'relative z-10 flex-1 py-1.5 px-3 text-ui font-medium text-center transition-colors duration-200',
                      mode === 'cloud' ? 'text-fg font-semibold' : 'text-muted hover:text-fg',
                    )}
                  >
                    Cloud Publish
                  </button>
                </div>
              </div>

              {/* MODE SPECIFIC VIEWS */}
              {mode === 'local' ? (
                /* LOCAL EXPORT VIEW */
                <div className="space-y-4">
                  {/* In-progress local export view */}
                  {isExporting ? (
                    <div className="space-y-4 rounded-pv border border-line bg-panel p-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-ui font-medium text-fg">
                          <Loader2 size={ICON_SIZE} strokeWidth={ICON_STROKE} className="animate-spin text-accent" />
                          <CrossfadeText
                            text={
                              exportStage
                                ? `${exportStage}... ${Math.round(exportProgress)}%`
                                : `Exporting video with effects... ${Math.round(exportProgress)}%`
                            }
                          />
                        </div>
                        <Button variant="secondary" size="sm" onClick={onCancelExport}>
                          Cancel
                        </Button>
                      </div>

                      {/* Animated Progress Bar */}
                      <div className="h-2 w-full overflow-hidden rounded-full bg-ctl">
                        <div
                          className="h-full bg-accent transition-all duration-300 ease-golden"
                          style={{ width: `${Math.max(3, exportProgress)}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted">Rendering high fidelity frames, audio tracks, and effects.</p>
                    </div>
                  ) : exportResult?.success ? (
                    /* Local Export Success View */
                    <div className="space-y-4 rounded-pv border border-line bg-panel p-5">
                      <div className="flex items-center gap-2 text-ui font-medium text-fg">
                        <CircleCheck size={ICON_SIZE} strokeWidth={ICON_STROKE} className="text-accent" />
                        <span>Export completed successfully!</span>
                      </div>
                      <div className="rounded-ctl border border-line bg-ctl/50 p-3">
                        <span className="block text-[11px] text-muted">Saved to:</span>
                        <span className="break-all font-mono text-xs text-fg">
                          {exportResult.outputPath || outputPath}
                        </span>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            if (exportResult.outputPath) {
                              window.electronAPI.showItemInFolder?.(exportResult.outputPath)
                            }
                          }}
                        >
                          <Folder size={14} strokeWidth={ICON_STROKE} className="mr-1.5" />
                          Show in folder
                        </Button>
                        <Button size="sm" onClick={requestClose}>
                          Done
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* Default Local Export Settings */
                    <div className="space-y-4 rounded-pv border border-line bg-panel p-4">
                      {/* Filename & Path */}
                      <div className="space-y-2">
                        <label className="block text-xs font-medium text-fg">File Destination</label>
                        <div className="flex gap-2">
                          <Input
                            value={outputPath}
                            onChange={(e) => setOutputPath(e.target.value)}
                            aria-label="Output path"
                            className="font-mono text-xs"
                          />
                          <Button variant="secondary" size="sm" onClick={() => void handleBrowseSavePath()}>
                            <Folder size={14} strokeWidth={ICON_STROKE} className="mr-1.5" />
                            Browse
                          </Button>
                        </div>
                      </div>

                      {/* Estimate Details */}
                      <div className="flex items-center justify-between rounded-ctl border border-line bg-ctl/40 px-3 py-2 text-xs text-muted">
                        <span>Estimated render duration:</span>
                        <span className="font-mono font-medium text-fg">~{Math.round(estimatedSeconds)}s</span>
                      </div>

                      {/* Local Export Action Button */}
                      <Button
                        className="w-full h-10 text-ui font-semibold shadow-sm"
                        disabled={duration <= 0 || isExporting}
                        onClick={() => void handleTriggerLocalExport()}
                      >
                        Export Video
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                /* CLOUD PUBLISH VIEW */
                <div className="space-y-4">
                  {/* Live Progress View */}
                  {isPublishing ? (
                    <div className="space-y-4 rounded-pv border border-line bg-panel p-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-ui font-medium text-fg">
                          <Loader2 size={ICON_SIZE} strokeWidth={ICON_STROKE} className="animate-spin text-accent" />
                          <CrossfadeText
                            text={
                              publishProgress?.stage === 'Rendering'
                                ? `Rendering video with effects... ${Math.round(publishProgress.stagePercent)}%`
                                : `Uploading video... ${Math.round(publishProgress?.stagePercent ?? 0)}%`
                            }
                          />
                        </div>
                        <Button variant="secondary" size="sm" onClick={onCancelPublish}>
                          Cancel
                        </Button>
                      </div>

                      {/* Progress bar */}
                      <div className="h-2 w-full overflow-hidden rounded-full bg-ctl">
                        <div
                          className="h-full bg-accent transition-all duration-300 ease-golden"
                          style={{ width: `${Math.max(3, publishProgress?.stagePercent ?? 0)}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted">
                        Nothing is charged until the upload finishes. Cancelling before completion costs nothing.
                      </p>
                    </div>
                  ) : successfulPublication ? (
                    /* POST-PUBLISH SUCCESS VIEW */
                    <div className="space-y-4 rounded-pv border border-line bg-panel p-5">
                      <div className="flex items-center gap-2 text-ui font-semibold text-fg">
                        <CircleCheck size={ICON_SIZE} strokeWidth={ICON_STROKE} className="text-accent" />
                        <span>Published successfully!</span>
                        <span className="text-xs font-normal text-muted">
                          (Live until {formatDate(successfulPublication.expiresAt)})
                        </span>
                      </div>

                      {/* Share links */}
                      <div className="space-y-2 rounded-ctl border border-line bg-ctl/30 p-3">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                          Share Links
                        </span>

                        {successfulPublication.links.pageUrl && (
                          <div className="flex items-center justify-between gap-3 border-b border-line pb-2">
                            <div className="min-w-0">
                              <span className="block text-xs font-medium text-fg">Landing page</span>
                              <span
                                className="block truncate font-mono text-xs text-muted"
                                title={successfulPublication.links.pageUrl}
                              >
                                {successfulPublication.links.pageUrl}
                              </span>
                            </div>
                            <CopyButton
                              value={successfulPublication.links.pageUrl}
                              label="Landing page link"
                              onCopied={onCopied}
                            />
                          </div>
                        )}

                        {successfulPublication.links.embedUrl && (
                          <div className="flex items-center justify-between gap-3 border-b border-line pb-2">
                            <div className="min-w-0">
                              <span className="block text-xs font-medium text-fg">Player URL</span>
                              <span
                                className="block truncate font-mono text-xs text-muted"
                                title={successfulPublication.links.embedUrl}
                              >
                                {successfulPublication.links.embedUrl}
                              </span>
                            </div>
                            <CopyButton
                              value={successfulPublication.links.embedUrl}
                              label="Player link"
                              onCopied={onCopied}
                            />
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <span className="block text-xs font-medium text-fg">Direct Video Download</span>
                            <span
                              className="block truncate font-mono text-xs text-muted"
                              title={successfulPublication.links.videoDownloadUrl}
                            >
                              {successfulPublication.links.videoDownloadUrl}
                            </span>
                          </div>
                          <CopyButton
                            value={successfulPublication.links.videoDownloadUrl}
                            label="Video download link"
                            onCopied={onCopied}
                          />
                        </div>
                      </div>

                      {/* Embed Code Snippet */}
                      {successfulPublication.links.embedCode && (
                        <div className="space-y-1.5">
                          <label className="block text-xs font-medium text-fg">Embed Player Code</label>
                          <textarea
                            readOnly
                            value={successfulPublication.links.embedCode}
                            className="h-16 w-full resize-none rounded-ctl border border-line bg-ctl/50 p-2 font-mono text-xs text-fg"
                          />
                          <div className="flex gap-2">
                            <CopyButton
                              value={successfulPublication.links.embedCode}
                              label="Embed code"
                              onCopied={onCopied}
                            />
                            {successfulPublication.links.embedUrl && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  window.electronAPI.openExternal(successfulPublication.links.embedUrl as string)
                                }
                              >
                                <ExternalLink size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-1.5" />
                                Preview in browser
                              </Button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Prompt: Would you like to save a copy of this rendered video to your computer? */}
                      <div className="rounded-ctl border border-line bg-ctl/40 p-4 space-y-3">
                        <div className="text-xs font-medium text-fg">
                          Would you like to save a copy of this rendered video to your computer?
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={isSavingCopy || saveCopySuccess}
                            onClick={() => void handleSaveRenderedCopy()}
                          >
                            {isSavingCopy ? (
                              <Loader2 size={14} strokeWidth={ICON_STROKE} className="mr-1.5 animate-spin" />
                            ) : (
                              <FileDownload size={14} strokeWidth={ICON_STROKE} className="mr-1.5" />
                            )}
                            {saveCopySuccess ? 'Saved to Computer' : 'Save to Computer...'}
                          </Button>
                          <Button size="sm" onClick={requestClose}>
                            Done
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Default Cloud Publish Configuration */
                    <div className="space-y-4 rounded-pv border border-line bg-panel p-4">
                      {/* Publication Title */}
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-fg">Publication Title</label>
                        <Input
                          value={cloudTitle}
                          onChange={(e) => setCloudTitle(e.target.value)}
                          placeholder="Project or video title"
                          className="text-xs"
                        />
                      </div>

                      {/* Publication Kind */}
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-fg">Publication Kind</label>
                        <div className="grid grid-cols-3 gap-2">
                          {kindChoices.map((kc) => {
                            const isSelected = kind === kc.kind
                            return (
                              <button
                                key={kc.kind}
                                type="button"
                                onClick={() => setKind(kc.kind)}
                                className={cn(
                                  'flex flex-col items-start rounded-ctl border p-2.5 text-left transition-all duration-200',
                                  isSelected
                                    ? 'border-accent bg-accent/15 text-accent font-semibold shadow-sm'
                                    : 'border-line bg-ctl text-fg hover:bg-ctl-hover',
                                )}
                              >
                                <span className="text-xs font-medium">{kc.label}</span>
                                <span className="mt-1 text-[11px] leading-tight text-muted">{kc.desc}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {/* Storage Term */}
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-fg">Hosting Term</label>
                        <div className="grid grid-cols-3 gap-2">
                          {termChoices.map((tc) => {
                            const isSelected = storageDays === tc.days
                            return (
                              <button
                                key={tc.days}
                                type="button"
                                onClick={() => setStorageDays(tc.days)}
                                className={cn(
                                  'rounded-ctl border py-2 text-center text-xs font-medium transition-all duration-200',
                                  isSelected
                                    ? 'border-accent bg-accent/15 text-accent font-semibold shadow-sm'
                                    : 'border-line bg-ctl text-fg hover:bg-ctl-hover',
                                )}
                              >
                                {tc.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {/* Captions Toggle */}
                      {subtitleCues.length > 0 && (
                        <div className="flex items-center justify-between rounded-ctl border border-line bg-ctl/30 px-3 py-2 text-xs">
                          <div>
                            <span className="font-medium text-fg">Include Subtitle Captions</span>
                            <span className="block text-[11px] text-muted">
                              {subtitleCues.length} cue{subtitleCues.length === 1 ? '' : 's'} available
                            </span>
                          </div>
                          <input
                            type="checkbox"
                            checked={includeCaptions}
                            onChange={(e) => setIncludeCaptions(e.target.checked)}
                            className="h-4 w-4 rounded accent-accent"
                          />
                        </div>
                      )}

                      {/* Credits and Balance Quote */}
                      <div className="flex items-center justify-between rounded-ctl border border-line bg-ctl/40 px-3 py-2 text-xs">
                        <span className="text-muted">Estimated Credits:</span>
                        <div className="text-right">
                          <span className="font-mono font-medium text-fg">
                            {quotedCredits} credits (~${creditsToUsd(quotedCredits).toFixed(2)})
                          </span>
                          <span className="block text-[11px] text-muted">
                            Current balance: {formatCredits(balance)}
                          </span>
                        </div>
                      </div>

                      <p className="text-[11px] text-muted">
                        Credits are charged upon successful upload. Deleting the publication stops hosting but credits
                        are not refunded.
                      </p>

                      {/* Render & Publish Button */}
                      <Button
                        className="w-full h-10 text-ui font-semibold shadow-sm"
                        disabled={duration <= 0 || isPublishing}
                        onClick={() => void handleTriggerCloudPublish()}
                      >
                        Render & Publish
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* TAB 2: PUBLISHED VIDEOS & ANALYTICS */
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-fg">Your Published Videos</h3>
                  {publications.length > 0 && (
                    <span className="rounded-pv bg-ctl px-2 py-0.5 text-xs text-muted">
                      {publications.length} {publications.length === 1 ? 'item' : 'items'}
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onLoadPublications && void onLoadPublications()}
                  disabled={isLoadingList}
                  className="h-8 gap-1.5 text-xs"
                >
                  <Refresh size={14} strokeWidth={ICON_STROKE} className={cn(isLoadingList && 'animate-spin')} />
                  Refresh
                </Button>
              </div>

              {publications.length === 0 && !isLoadingList ? (
                /* Designed Empty State */
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ctl text-accent">
                    <Share size={28} strokeWidth={ICON_STROKE} />
                  </div>
                  <h4 className="mt-4 text-ui font-semibold text-fg">No published videos yet</h4>
                  <p className="mt-1 max-w-sm text-xs text-muted">
                    Publish your videos to share them with clients, colleagues, or teams with instant landing pages and
                    analytics.
                  </p>
                  <Button variant="secondary" size="sm" onClick={() => setActiveTab('export-publish')} className="mt-4">
                    Switch to Export & Publish
                  </Button>
                </div>
              ) : (
                /* Publications Grid/List & Analytics */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Left Column: Publication Items */}
                  <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1 stable-scrollbar">
                    {publications.map((pub) => {
                      const isSelected = selectedPublicationId === pub.publicationId
                      const isActive = pub.status === 'active'
                      return (
                        <div
                          key={pub.publicationId}
                          onClick={() => setSelectedPublicationId(pub.publicationId)}
                          className={cn(
                            'cursor-pointer rounded-ctl border p-3 transition-all duration-200',
                            isSelected
                              ? 'border-accent bg-accent/10 shadow-sm'
                              : 'border-line bg-panel hover:bg-ctl/50',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold text-fg" title={pub.title}>
                              {pub.title || 'Untitled video'}
                            </span>
                            <span
                              className={cn(
                                'rounded-pv px-1.5 py-0.5 text-[11px] font-medium',
                                isActive ? 'bg-accent/20 text-accent' : 'bg-ctl text-muted',
                              )}
                            >
                              {isActive ? 'Active' : pub.status}
                            </span>
                          </div>

                          <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                            <span>Expires: {formatDate(pub.expiresAt)}</span>
                            <span>{pub.sizeBytes ? formatBytes(pub.sizeBytes) : ''}</span>
                          </div>

                          {/* Action toolbar */}
                          <div className="mt-2.5 flex items-center justify-between border-t border-line/60 pt-2">
                            <div className="flex gap-1.5">
                              {pub.links.pageUrl && (
                                <CopyButton
                                  value={pub.links.pageUrl}
                                  label="Link"
                                  className="h-6 px-2 text-[11px]"
                                  onCopied={onCopied}
                                />
                              )}
                              {(pub.links.pageUrl || pub.links.embedUrl) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-[11px]"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    const url = pub.links.pageUrl || pub.links.embedUrl
                                    if (url) window.electronAPI.openExternal(url)
                                  }}
                                >
                                  <ExternalLink size={12} strokeWidth={ICON_STROKE} className="mr-1" />
                                  View
                                </Button>
                              )}
                            </div>

                            {/* Delete trigger */}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[11px] text-danger hover:bg-danger/10 hover:text-danger"
                              onClick={(e) => {
                                e.stopPropagation()
                                setConfirmDeleteId(pub.publicationId)
                              }}
                            >
                              <Trash size={12} strokeWidth={ICON_STROKE} />
                            </Button>
                          </div>

                          {/* Delete Confirmation Inline */}
                          {confirmDeleteId === pub.publicationId && (
                            <div
                              className="mt-2 rounded-ctl border border-danger/40 bg-danger/10 p-2 text-xs text-fg space-y-2"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <p className="text-[11px] text-fg">
                                Delete link? Storage stops immediately, but credits are not refunded.
                              </p>
                              <div className="flex justify-end gap-1.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-[11px]"
                                  onClick={() => setConfirmDeleteId(null)}
                                >
                                  Keep
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  disabled={isDeleting}
                                  className="h-6 text-[11px]"
                                  onClick={() => void handleDeletePublication(pub.publicationId)}
                                >
                                  Confirm Delete
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Right Column: Detailed Analytics */}
                  <div className="rounded-pv border border-line bg-panel p-4 space-y-4">
                    <div className="flex items-center justify-between border-b border-line pb-2.5">
                      <span className="text-xs font-semibold text-fg">Viewer Analytics</span>
                      {/* Range Buttons */}
                      <div className="flex gap-1">
                        {(['7d', '30d', '90d', 'all'] as PublicationAnalyticsRange[]).map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setAnalyticsRange(r)}
                            className={cn(
                              'rounded-ctl border px-2 py-0.5 text-[11px] transition-colors',
                              analyticsRange === r
                                ? 'border-accent bg-accent/15 text-accent font-semibold'
                                : 'border-line text-muted hover:text-fg',
                            )}
                          >
                            {r === 'all' ? 'All' : r}
                          </button>
                        ))}
                      </div>
                    </div>

                    {!selectedPublicationId ? (
                      <div className="py-12 text-center text-xs text-muted">
                        Select a publication on the left to see views, watch times, and breakdown.
                      </div>
                    ) : isLoadingAnalytics ? (
                      <div className="flex items-center justify-center py-12 gap-2 text-xs text-muted">
                        <Loader2 size={16} strokeWidth={ICON_STROKE} className="animate-spin text-accent" />
                        Loading analytics...
                      </div>
                    ) : analyticsError ? (
                      <div className="py-8 text-center text-xs text-danger">{analyticsError}</div>
                    ) : analyticsData ? (
                      <div className="space-y-4">
                        {/* Summary Metrics */}
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="rounded-ctl border border-line bg-ctl/40 p-2">
                            <span className="block text-[11px] text-muted">Views</span>
                            <span className="font-mono text-sm font-semibold text-fg">
                              {analyticsData.totals.views}
                            </span>
                            <span className="block text-[11px] text-muted">
                              {analyticsData.totals.uniqueViewers} unique
                            </span>
                          </div>
                          <div className="rounded-ctl border border-line bg-ctl/40 p-2">
                            <span className="block text-[11px] text-muted">Avg Watch</span>
                            <span className="font-mono text-sm font-semibold text-fg">
                              {formatDuration(analyticsData.totals.avgWatchSeconds)}
                            </span>
                            <span className="block text-[11px] text-muted">per viewer</span>
                          </div>
                          <div className="rounded-ctl border border-line bg-ctl/40 p-2">
                            <span className="block text-[11px] text-muted">Completed</span>
                            <span className="font-mono text-sm font-semibold text-fg">
                              {Math.round(analyticsData.totals.completionRate * 100)}%
                            </span>
                            <span className="block text-[11px] text-muted">
                              {analyticsData.totals.completions} finished
                            </span>
                          </div>
                        </div>

                        {/* Devices Breakdown */}
                        {analyticsData.devices.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="block text-[11px] font-semibold uppercase text-muted">
                              Devices Breakdown
                            </span>
                            <div className="space-y-1 text-xs">
                              {analyticsData.devices.map((d) => (
                                <div key={d.key} className="flex items-center justify-between">
                                  <span className="text-muted capitalize">{d.key}</span>
                                  <span className="font-mono text-fg">{d.uniqueViewers} viewers</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Countries Breakdown */}
                        {analyticsData.countries.length > 0 && (
                          <div className="space-y-1.5 border-t border-line/60 pt-2">
                            <span className="block text-[11px] font-semibold uppercase text-muted">Top Countries</span>
                            <div className="space-y-1 text-xs">
                              {analyticsData.countries.slice(0, 4).map((c) => (
                                <div key={c.key} className="flex items-center justify-between">
                                  <span className="text-muted">{c.key}</span>
                                  <span className="font-mono text-fg">{c.uniqueViewers} viewers</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="py-8 text-center text-xs text-muted">No analytics data available</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
