// Renderer-side access to instant publishing.
//
// Everything goes through the preload bridge; nothing here decides a price. The dialog
// quotes one from `shared/publish-cost.ts` (the same formula the server charges from),
// and the number that counts arrives in the completion payload.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { components } from '../../shared/api-types'
import type { SubtitleCue } from '../../shared/subtitles'
import type { ResolutionKey } from '../../shared/export-resolutions'

export type PublicationView = components['schemas']['PublicationView']
export type PublicationAnalytics = components['schemas']['PublicationAnalytics']
export type PublicationKind = components['schemas']['PublicationKind']
export type PublishingCapabilities = components['schemas']['PublishingCapabilities']
export type PublicationAnalyticsRange = '7d' | '30d' | '90d' | 'all'

export type { ResolutionKey } from '../../shared/export-resolutions'
export type { SubtitleCue } from '../../shared/subtitles'

export interface PublishStatus {
  configured: boolean
  pro: boolean
  publishing: PublishingCapabilities | null
  error: string | null
}

export interface PublishProgress {
  stage: string
  stagePercent: number
  estimatedCost?: number
}

export interface PublishRequest {
  filePath: string
  kind: PublicationKind
  storageDays: number
  title?: string
  durationSec?: number
  captions?: SubtitleCue[]
}

export type PublishOutcome =
  | { ok: true; publication: PublicationView; captionsIncluded: boolean }
  | { ok: false; reason: 'canceled' | 'failed' | 'rejected'; error: string; cost?: number; balance?: number }

export interface RenderExportSettings {
  format: 'mp4'
  resolution: ResolutionKey
  fps: 30 | 60
  quality: 'low' | 'medium' | 'high'
}

export interface RenderPublishOptions {
  kind: PublicationKind
  storageDays: number
  title?: string
  cues?: SubtitleCue[]
}

export interface ExportProjectState {
  aspectRatio?: string
  duration: number
  platform?: unknown
  videoPath?: string
  metadata?: unknown[]
  videoDimensions?: { width: number; height: number }
  frameStyles?: { padding?: number }
  cameraMotions?: unknown[]
  visualEffects?: unknown
  compositionLayouts?: unknown[]
  audioClips?: unknown[]
  mouseClickSoundsEnabled?: boolean
  mouseClickSoundPath?: string | null
  mouseClickSoundName?: string
  mouseClickSoundVolume?: number
  hasAudioTrack?: boolean
  audioTracks?: unknown[]
  subtitleCues?: SubtitleCue[]
  subtitlesEnabled?: boolean
  subtitleFormat?: 'srt' | 'vtt'
  volume?: number
  isMuted?: boolean
  zoomRegions?: unknown
  cutRegions?: unknown
  speedRegions?: unknown
  videoClips?: unknown[]
  webcamVideoPath?: string | null
  webcamPosition?: unknown
  webcamStyles?: unknown
  isWebcamVisible?: boolean
  recordingGeometry?: unknown
  cursorImages?: unknown
  cursorTheme?: unknown
  cursorStyles?: unknown
  syncOffset?: number
  [key: string]: unknown
}

export interface RenderAndPublishParams {
  projectState: ExportProjectState
  exportSettings: RenderExportSettings
  publishOptions: RenderPublishOptions
  cloud?: boolean
}

/**
 * Extracts a serializable ExportProjectState from the editorStore or partial state.
 */
export function extractExportProjectState(storeState: Record<string, unknown>): ExportProjectState {
  return {
    platform: storeState.platform,
    videoPath: storeState.videoPath as string | undefined,
    metadata: storeState.metadata as unknown[] | undefined,
    videoDimensions: storeState.videoDimensions as { width: number; height: number } | undefined,
    duration: typeof storeState.duration === 'number' ? storeState.duration : 0,
    frameStyles: storeState.frameStyles as { padding?: number } | undefined,
    aspectRatio: typeof storeState.aspectRatio === 'string' ? storeState.aspectRatio : '16:9',
    cameraMotions: storeState.cameraMotions as unknown[] | undefined,
    visualEffects: storeState.visualEffects,
    compositionLayouts: storeState.compositionLayouts as unknown[] | undefined,
    audioClips: storeState.audioClips as unknown[] | undefined,
    mouseClickSoundsEnabled: Boolean(storeState.mouseClickSoundsEnabled),
    mouseClickSoundPath: (storeState.mouseClickSoundPath as string | null) ?? null,
    mouseClickSoundName: storeState.mouseClickSoundName as string | undefined,
    mouseClickSoundVolume: storeState.mouseClickSoundVolume as number | undefined,
    hasAudioTrack: Boolean(storeState.hasAudioTrack),
    audioTracks: storeState.audioTracks as unknown[] | undefined,
    subtitleCues: storeState.subtitleCues as SubtitleCue[] | undefined,
    subtitlesEnabled: Boolean(storeState.subtitlesEnabled),
    subtitleFormat: storeState.subtitleFormat as 'srt' | 'vtt' | undefined,
    volume: storeState.volume as number | undefined,
    isMuted: Boolean(storeState.isMuted),
    zoomRegions: storeState.zoomRegions,
    cutRegions: storeState.cutRegions,
    speedRegions: storeState.speedRegions,
    videoClips: storeState.videoClips as unknown[] | undefined,
    webcamVideoPath: (storeState.webcamVideoPath as string | null) ?? null,
    webcamPosition: storeState.webcamPosition,
    webcamStyles: storeState.webcamStyles,
    isWebcamVisible: Boolean(storeState.isWebcamVisible),
    recordingGeometry: storeState.recordingGeometry,
    cursorImages: storeState.cursorImages,
    cursorTheme: storeState.cursorTheme,
    cursorStyles: storeState.cursorStyles,
    syncOffset: storeState.syncOffset as number | undefined,
  }
}

/**
 * Publishing status, the run itself, the library and its analytics.
 *
 * The status is read once when the hook mounts and again after a successful publish:
 * the balance the server knows about changes when credits are spent, and the dialog
 * should not keep showing the pre-publish number.
 */
export function usePublish() {
  const [status, setStatus] = useState<PublishStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [isPublishing, setPublishing] = useState(false)
  const [progress, setProgress] = useState<PublishProgress | null>(null)
  const [publications, setPublications] = useState<PublicationView[]>([])
  const [isLoadingList, setLoadingList] = useState(false)
  const [tempRenderPath, setTempRenderPath] = useState<string | null>(null)

  const mounted = useRef(true)
  const tempRenderPathRef = useRef<string | null>(null)
  const pipelinePhaseRef = useRef<'idle' | 'rendering' | 'publishing'>('idle')
  const canceledRef = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (tempRenderPathRef.current) {
        window.electronAPI.cleanupTempPublishFile(tempRenderPathRef.current).catch(() => undefined)
        tempRenderPathRef.current = null
      }
    }
  }, [])

  const refreshStatus = useCallback(async (): Promise<PublishStatus | null> => {
    try {
      const next = await window.electronAPI.publishStatus()
      if (mounted.current) {
        setStatus(next)
        setStatusError(next.error)
      }
      return next
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (mounted.current) setStatusError(message)
      return null
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  // Progress for whichever publish upload is in flight.
  useEffect(() => {
    const off = window.electronAPI.onPublishProgress((payload) => {
      if (!mounted.current) return
      setProgress({
        stage: payload.stage,
        stagePercent: payload.stagePercent,
        ...(payload.estimatedCost !== undefined ? { estimatedCost: payload.estimatedCost } : {}),
      })
    })
    // Wrapped rather than returned directly: the preload's unsubscribe returns the
    // IpcRenderer, which is not a valid effect destructor.
    return () => {
      off()
    }
  }, [])

  const cleanupTempRender = useCallback(async (): Promise<void> => {
    const current = tempRenderPathRef.current
    if (current) {
      try {
        await window.electronAPI.cleanupTempPublishFile(current)
      } catch {
        // Ignore errors during temp file cleanup
      } finally {
        tempRenderPathRef.current = null
        if (mounted.current) {
          setTempRenderPath(null)
        }
      }
    }
  }, [])

  const saveRenderedCopy = useCallback(async (destinationPath: string): Promise<{ ok: boolean; error?: string }> => {
    const source = tempRenderPathRef.current
    if (!source) {
      return { ok: false, error: 'No rendered video available to save' }
    }
    try {
      return await window.electronAPI.saveTempPublishFile(source, destinationPath)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }, [])

  const start = useCallback(
    async (request: PublishRequest): Promise<PublishOutcome> => {
      canceledRef.current = false
      pipelinePhaseRef.current = 'publishing'
      setPublishing(true)
      setProgress({ stage: 'Preparing', stagePercent: 0 })
      try {
        const outcome = (await window.electronAPI.startPublish(request)) as PublishOutcome
        if (outcome.ok) {
          // The list is stale the moment something is published.
          setPublications((current) => [...current, outcome.publication])
          void refreshStatus()
        }
        return outcome
      } catch (error) {
        return {
          ok: false,
          reason: 'failed',
          error: error instanceof Error ? error.message : String(error),
        }
      } finally {
        pipelinePhaseRef.current = 'idle'
        if (mounted.current) {
          setPublishing(false)
          setProgress(null)
        }
      }
    },
    [refreshStatus],
  )

  const cancel = useCallback(() => {
    canceledRef.current = true
    if (pipelinePhaseRef.current === 'rendering') {
      window.electronAPI.cancelExport()
      window.electronAPI.cancelCloudRetry?.()
    } else {
      window.electronAPI.cancelPublish()
    }
  }, [])

  const renderAndPublish = useCallback(
    async (
      projectStateOrParams: ExportProjectState | RenderAndPublishParams,
      maybeExportSettings?: RenderExportSettings,
      maybePublishOptions?: RenderPublishOptions,
    ): Promise<PublishOutcome> => {
      let projectState: ExportProjectState
      let exportSettings: RenderExportSettings
      let publishOptions: RenderPublishOptions
      let cloud = false

      if (
        typeof projectStateOrParams === 'object' &&
        projectStateOrParams !== null &&
        'projectState' in projectStateOrParams &&
        'exportSettings' in projectStateOrParams &&
        'publishOptions' in projectStateOrParams
      ) {
        const params = projectStateOrParams as RenderAndPublishParams
        projectState = params.projectState
        exportSettings = params.exportSettings
        publishOptions = params.publishOptions
        cloud = Boolean(params.cloud)
      } else {
        projectState = projectStateOrParams as ExportProjectState
        exportSettings = maybeExportSettings!
        publishOptions = maybePublishOptions!
      }

      if (!projectState || !exportSettings || !publishOptions) {
        return {
          ok: false,
          reason: 'failed',
          error: 'Missing required arguments for renderAndPublish',
        }
      }

      if (pipelinePhaseRef.current !== 'idle') {
        return {
          ok: false,
          reason: 'failed',
          error: 'A render or publish operation is already in progress',
        }
      }

      canceledRef.current = false
      setPublishing(true)
      setProgress({ stage: 'Rendering', stagePercent: 0 })

      try {
        if (tempRenderPathRef.current) {
          await cleanupTempRender()
        }

        // 1. Calls window.electronAPI.getTempPublishPath() to get a tempPath.
        const tempPath = await window.electronAPI.getTempPublishPath()
        tempRenderPathRef.current = tempPath
        if (mounted.current) {
          setTempRenderPath(tempPath)
        }

        if (canceledRef.current) {
          await cleanupTempRender()
          return { ok: false, reason: 'canceled', error: 'Publish canceled' }
        }

        // 2 & 3. Initiates rendering and tracks render progress.
        pipelinePhaseRef.current = 'rendering'
        const renderResult = await new Promise<{ ok: boolean; reason?: 'canceled' | 'failed'; error?: string }>(
          (resolve) => {
            let finished = false
            const finish = (res: { ok: boolean; reason?: 'canceled' | 'failed'; error?: string }) => {
              if (finished) return
              finished = true
              cleanProgress()
              cleanComplete()
              resolve(res)
            }

            const cleanProgress = window.electronAPI.onExportProgress((payload) => {
              if (!mounted.current) return
              const percent =
                typeof payload.stagePercent === 'number'
                  ? Math.round(payload.stagePercent)
                  : typeof payload.progress === 'number'
                    ? Math.round(payload.progress)
                    : 0
              const stageName =
                payload.stage &&
                payload.stage.toLowerCase() !== 'rendering' &&
                payload.stage !== 'Local intermediate render'
                  ? `Upscaling (${payload.stage})`
                  : 'Rendering'
              setProgress({
                stage: stageName,
                stagePercent: Math.min(100, Math.max(0, percent)),
              })
            })

            const cleanComplete = window.electronAPI.onExportComplete((payload) => {
              if (payload.success) {
                finish({ ok: true })
              } else {
                const isCanceled =
                  canceledRef.current || (payload.error ? payload.error.toLowerCase().includes('cancel') : false)
                finish({
                  ok: false,
                  reason: isCanceled ? 'canceled' : 'failed',
                  error: payload.error || (isCanceled ? 'Rendering was canceled' : 'Rendering failed'),
                })
              }
            })

            window.electronAPI
              .startExport({
                projectState,
                exportSettings,
                outputPath: tempPath,
                ...(cloud ? { cloud: {} } : {}),
              })
              .catch((err) => {
                const isCanceled =
                  canceledRef.current || (err instanceof Error && err.message.toLowerCase().includes('cancel'))
                finish({
                  ok: false,
                  reason: isCanceled ? 'canceled' : 'failed',
                  error: err instanceof Error ? err.message : String(err),
                })
              })
          },
        )

        if (!renderResult.ok) {
          await cleanupTempRender()
          return {
            ok: false,
            reason: renderResult.reason || 'failed',
            error: renderResult.error || 'Rendering failed',
          }
        }

        if (canceledRef.current) {
          await cleanupTempRender()
          return { ok: false, reason: 'canceled', error: 'Publish canceled' }
        }

        // 4. Probes file size with probePublishFile(tempPath).
        const probeResult = await window.electronAPI.probePublishFile(tempPath)
        if (!probeResult.ok) {
          await cleanupTempRender()
          return {
            ok: false,
            reason: 'failed',
            error: probeResult.error || 'Failed to probe rendered file size',
          }
        }

        if (canceledRef.current) {
          await cleanupTempRender()
          return { ok: false, reason: 'canceled', error: 'Publish canceled' }
        }

        // 5 & 6. Initiates publish via startPublish and tracks upload progress.
        pipelinePhaseRef.current = 'publishing'
        setProgress({ stage: 'Preparing', stagePercent: 0 })

        const outcome = (await window.electronAPI.startPublish({
          filePath: tempPath,
          kind: publishOptions.kind || 'page',
          storageDays: publishOptions.storageDays,
          title: publishOptions.title,
          durationSec: projectState.duration,
          captions: publishOptions.cues,
        })) as PublishOutcome

        if (outcome.ok) {
          setPublications((current) => [...current, outcome.publication])
          void refreshStatus()
        }
        return outcome
      } catch (error) {
        return {
          ok: false,
          reason: 'failed',
          error: error instanceof Error ? error.message : String(error),
        }
      } finally {
        pipelinePhaseRef.current = 'idle'
        if (mounted.current) {
          setPublishing(false)
          setProgress(null)
        }
      }
    },
    [cleanupTempRender, refreshStatus],
  )

  const loadList = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    setLoadingList(true)
    try {
      const result = await window.electronAPI.listPublications()
      if (!mounted.current) return { ok: false }
      if (result.ok) {
        setPublications(result.publications)
        return { ok: true }
      }
      return { ok: false, error: result.error }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      if (mounted.current) setLoadingList(false)
    }
  }, [])

  const remove = useCallback(
    async (publicationId: string): Promise<{ ok: boolean; error?: string; creditsRefunded?: number }> => {
      try {
        const result = await window.electronAPI.deletePublication(publicationId)
        if (!result.ok) return { ok: false, error: result.error }
        setPublications((current) => current.filter((publication) => publication.publicationId !== publicationId))
        return { ok: true, creditsRefunded: result.creditsRefunded }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    [],
  )

  const analytics = useCallback(
    async (
      publicationId: string,
      range: PublicationAnalyticsRange,
    ): Promise<{ ok: true; analytics: PublicationAnalytics } | { ok: false; error: string }> => {
      try {
        return await window.electronAPI.publicationAnalytics(publicationId, range)
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    [],
  )

  return {
    status,
    statusError,
    isPublishing,
    progress,
    publications,
    isLoadingList,
    tempRenderPath,
    refreshStatus,
    start,
    cancel,
    loadList,
    remove,
    analytics,
    renderAndPublish,
    saveRenderedCopy,
    cleanupTempRender,
  }
}
