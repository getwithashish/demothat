import { useState, useEffect, useCallback, useRef } from 'react'
import { useEditorStore } from '../store/editorStore'
import { ExportSettings } from '../components/editor/ExportModal'
import { formatCredits } from '../../shared/license'
import type { CloudStage } from '../../shared/cloud-stages'

/** Progress payload for a cloud export: the credits meter and the ETA. */
export interface CloudProgressInfo {
  stage: CloudStage
  /** Percent within the stage. */
  stagePercent: number
  framesDone?: number
  totalFrames?: number
  reserved?: number
  consumed?: number
  etaSeconds?: number | null
  /** The server's minimum charge once GPU work began. */
  minChargeCredits?: number
  throughput?: string | number
  fps?: number
}

export interface ExportResult {
  success: boolean
  outputPath?: string
  error?: string
  /** The server's settled numbers after a cloud export. */
  charge?: number
  refund?: number
  /** Why a cloud step ended without success. */
  cloudReason?: string
  /** The price the server quoted on a refusal. */
  cost?: number
  balance?: number
  /** The local render, kept so a retry needs no second render. */
  intermediatePath?: string
  canRetryCloud?: boolean
  /** Everything a cloud retry needs (target size, fps, clip length). */
  cloudRetry?: { targetWidth: number; targetHeight: number; fps: number; durationSec: number }
}

/** What a cloud retry (or the Standard fallback) needs, so the render is not repeated. */
export interface CloudRetryRequest {
  intermediatePath: string
  outputPath: string
  targetWidth: number
  targetHeight: number
  fps: number
  durationSec: number
}

/**
 * Custom hook to manage the entire video export process.
 * It encapsulates state management, IPC listeners, and handler functions
 * related to exporting, cleaning up the EditorPage component.
 */
export const useExportProcess = () => {
  const [isModalOpen, setModalOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState<string | null>(null)
  const [cloudProgress, setCloudProgress] = useState<CloudProgressInfo | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  /** A cloud job that outlived the last session, offered for watching again. */
  const [cloudResumeOffer, setCloudResumeOffer] = useState<{ jobId: string; outputPath: string } | null>(null)
  const [isAutoResumed, setIsAutoResumed] = useState(false)
  const [recoveredJobError, setRecoveredJobError] = useState<ExportResult | null>(null)
  const isRecoveredJobRef = useRef(false)
  const isExportActiveRef = useRef(false)

  // Effect to set up and tear down IPC listeners for export progress and completion
  useEffect(() => {
    const cleanProgressListener = window.electronAPI.onExportProgress((payload) => {
      if (!isExportActiveRef.current) return
      setProgress(payload.progress)
      setStage(payload.stage ?? null)
      // Cloud stages carry the credits meter; local stages do not.
      if (payload.stage && payload.reserved !== undefined) {
        setCloudProgress({
          stage: payload.stage as CloudStage,
          stagePercent: payload.stagePercent ?? payload.progress,
          framesDone: payload.framesDone,
          totalFrames: payload.totalFrames,
          reserved: payload.reserved,
          consumed: payload.consumed,
          etaSeconds: payload.etaSeconds ?? null,
          minChargeCredits: payload.minChargeCredits,
          throughput: payload.throughput,
          fps: payload.fps,
        })
      }
    })

    const cleanCompleteListener = window.electronAPI.onExportComplete((payload) => {
      if (!isExportActiveRef.current) return
      isExportActiveRef.current = false
      setIsExporting(false)
      setProgress(100)
      setResult(payload)
      setCloudProgress(null)

      if (isRecoveredJobRef.current && !payload.success) {
        setRecoveredJobError(payload)
      }

      const store = useEditorStore.getState()
      // The balance moved (or a job was refused), so re-read it for the capsule.
      if (payload.charge !== undefined || payload.cost !== undefined) void store.refreshBalance()
      if (payload.success && payload.charge !== undefined) {
        store.pushToast({
          message: `Cloud upscale finished. ${formatCredits(payload.charge)} credits used.`,
          actionLabel: 'Open',
          revealPath: payload.outputPath,
        })
      } else if (payload.success) {
        store.pushToast({
          message: 'Export completed successfully.',
          actionLabel: 'Open',
          revealPath: payload.outputPath,
        })
      }
      if (!payload.success && payload.refund !== undefined && payload.refund > 0) {
        store.pushToast({ message: `${formatCredits(payload.refund)} credits returned.` })
      } else if (!payload.success && !payload.error?.toLowerCase().includes('cancel')) {
        store.pushToast({ message: payload.error || 'Export failed.' })
      }
    })

    return () => {
      cleanProgressListener()
      cleanCompleteListener()
    }
  }, [])

  // Handler to initiate the export process
  const handleStartExport = useCallback(
    async (settings: ExportSettings, outputPath: string, options?: { cloud?: boolean }) => {
      const fullState = useEditorStore.getState()
      const plainState = {
        platform: fullState.platform,
        videoPath: fullState.videoPath,
        metadata: fullState.metadata,
        videoDimensions: fullState.videoDimensions,
        duration: fullState.duration,
        frameStyles: fullState.frameStyles,
        aspectRatio: fullState.aspectRatio,
        // Preserve cinematic 3D camera tracks in the state sent to the export renderer.
        cameraMotions: fullState.cameraMotions,
        visualEffects: fullState.visualEffects,
        compositionLayouts: fullState.compositionLayouts,
        audioClips: fullState.audioClips,
        mouseClickSoundsEnabled: fullState.mouseClickSoundsEnabled,
        mouseClickSoundPath: fullState.mouseClickSoundPath,
        mouseClickSoundName: fullState.mouseClickSoundName,
        mouseClickSoundVolume: fullState.mouseClickSoundVolume,
        hasAudioTrack: fullState.hasAudioTrack,
        // One entry per audio source, so the export can mix them with their own
        // gains instead of mapping the recording's first stream and losing the rest.
        audioTracks: fullState.audioTracks,
        // The captions, already on the export's timeline: the export writes them
        // beside the video rather than burning them into it.
        subtitleCues: fullState.subtitleCues,
        subtitlesEnabled: fullState.subtitlesEnabled,
        subtitleFormat: fullState.subtitleFormat,
        volume: fullState.volume,
        isMuted: fullState.isMuted,
        zoomRegions: fullState.zoomRegions,
        cutRegions: fullState.cutRegions,
        speedRegions: fullState.speedRegions,
        videoClips: fullState.videoClips,
        webcamVideoPath: fullState.webcamVideoPath,
        webcamPosition: fullState.webcamPosition,
        webcamStyles: fullState.webcamStyles,
        isWebcamVisible: fullState.isWebcamVisible,
        recordingGeometry: fullState.recordingGeometry,
        cursorImages: fullState.cursorImages,
        cursorTheme: fullState.cursorTheme,
        cursorStyles: fullState.cursorStyles,
        syncOffset: fullState.syncOffset,
        avSyncOffsetMs: fullState.avSyncOffsetMs ?? fullState.syncOffset ?? 0,
      }

      setResult(null)
      setCloudProgress(null)
      setIsExporting(true)
      isExportActiveRef.current = true
      setProgress(0)
      setStage(null)

      try {
        await window.electronAPI.startExport({
          projectState: plainState,
          exportSettings: settings,
          outputPath: outputPath,
          // The AI (cloud) method: render the intermediate here, upscale there.
          ...(options?.cloud ? { cloud: {} } : {}),
        })
      } catch (e) {
        console.error('Export invocation failed', e)
        isExportActiveRef.current = false
        setResult({ success: false, error: `An error occurred while starting the export: ${e}` })
        setIsExporting(false)
      }
    },
    [],
  )

  // Handler to cancel an ongoing export
  const handleCancelExport = () => {
    window.electronAPI.cancelExport()
    // The local render may already be finished: this reaches the cloud stages,
    // whose own `export:cancel` listener is gone by then.
    window.electronAPI.cancelCloudRetry?.()
  }

  /** Re-runs the cloud step on the render that already exists on disk. */
  const retryCloud = useCallback(async (request: CloudRetryRequest) => {
    setResult(null)
    setCloudProgress(null)
    setIsExporting(true)
    isExportActiveRef.current = true
    setProgress(0)
    try {
      await window.electronAPI.cloudRetry(request)
    } catch (e) {
      isExportActiveRef.current = false
      setIsExporting(false)
      setResult({ success: false, error: `Cloud retry failed: ${e}` })
    }
  }, [])

  /** Upscales that same render locally instead, at no cost in credits. */
  const fallbackToStandard = useCallback(
    async (request: Omit<CloudRetryRequest, 'fps'> & { quality?: ExportSettings['quality'] }) => {
      setResult(null)
      setCloudProgress(null)
      setIsExporting(true)
      isExportActiveRef.current = true
      setProgress(0)
      try {
        await window.electronAPI.cloudFallback(request)
      } catch (e) {
        isExportActiveRef.current = false
        setIsExporting(false)
        setResult({ success: false, error: `Local fallback failed: ${e}` })
      }
    },
    [],
  )

  /** Keeps watching the job that outlived the app. */
  const resumeCloudWatch = useCallback(async () => {
    setCloudResumeOffer(null)
    setResult(null)
    setRecoveredJobError(null)
    setIsExporting(true)
    isExportActiveRef.current = true
    setProgress(0)
    try {
      await window.electronAPI.resumeCloudWatch()
    } catch (e) {
      isExportActiveRef.current = false
      setIsExporting(false)
      const errResult: ExportResult = { success: false, error: `Resume cloud watch failed: ${e}` }
      setResult(errResult)
      if (isRecoveredJobRef.current) {
        setRecoveredJobError(errResult)
      }
    }
  }, [])

  // A job that was still running when the app closed continues on the server:
  // auto-trigger resumeCloudWatch() silently.
  useEffect(() => {
    window.electronAPI
      .getActiveCloudJob?.()
      .then((job) => {
        if (job) {
          isRecoveredJobRef.current = true
          setIsAutoResumed(true)
          setCloudResumeOffer(job)
          void resumeCloudWatch()
        }
      })
      .catch(() => undefined)
  }, [resumeCloudWatch])

  /** Drops the remembered job instead of watching it. */
  const dismissCloudResume = useCallback(async () => {
    setCloudResumeOffer(null)
    await window.electronAPI.forgetCloudJob?.()
  }, [])

  // Clear completed export result explicitly
  const clearResult = useCallback(() => {
    setResult(null)
    setRecoveredJobError(null)
    isRecoveredJobRef.current = false
    setIsAutoResumed(false)
  }, [])

  // Handler to close the modal and reset its state
  const handleCloseModal = () => {
    if (result) {
      setResult(null)
    }
    setModalOpen(false)
  }

  return {
    isModalOpen,
    isExporting,
    progress,
    stage,
    cloudProgress,
    result,
    cloudResumeOffer,
    isAutoResumed,
    recoveredJobError,
    isRecoveredJob: isRecoveredJobRef.current,
    openExportModal: () => setModalOpen(true),
    closeExportModal: handleCloseModal,
    startExport: handleStartExport,
    cancelExport: handleCancelExport,
    retryCloud,
    fallbackToStandard,
    resumeCloudWatch,
    dismissCloudResume,
    clearResult,
  }
}
