// The cloud half of an AI (cloud) export: reservation, upload, start, poll,
// download — plus the cancel and resume behaviour the spec pins down.
//
// Ordering matters: `POST /v1/jobs` reserves the credits *before* anything is
// rendered, so a refusal costs the user no render time at all. Settlement is
// always the server's number: the client never computes a charge.

import fsp from 'node:fs/promises'
import path from 'node:path'
import log from 'electron-log/main'
import {
  CloudError,
  type CloudCancellation,
  type CloudCapabilities,
  type CloudJobCreated,
  type CloudJobView,
  cancelJobRemote,
  completeUpload,
  createJob,
  downloadResult,
  fetchCapabilities,
  pollJob,
  startJob,
  uploadIntermediate,
} from './cloud-client'
import { clearActiveJob, clearUploadResume, getUploadResume, saveActiveJob, saveUploadResume } from '../lib/cloud-store'
import {
  CLOUD_WORK_STAGES,
  cloudStagePercent,
  isBeforeGpuWork,
  projectCancellation,
  stageFromJobStatus,
  stageStep,
  type CancelProjection,
  type CancelProjectionInput,
  type CloudStage,
} from '../../../shared/cloud-stages'

// The stage vocabulary, the overall-bar maths and the cancel copy live in
// shared/ so the renderer draws exactly what the main process reports.
export { CLOUD_WORK_STAGES, cloudStagePercent, isBeforeGpuWork, projectCancellation, stageFromJobStatus, stageStep }
export type { CancelProjection, CancelProjectionInput, CloudStage }

/** Advisory size for the job body; the server probes the upload and settles from that. */
export function estimateIntermediateBytes(durationSec: number, fps: number): number {
  // ~12 Mbps for a CRF 14 H.264 intermediate at the render cap.
  void fps
  return Math.max(1, Math.round((Math.max(0, durationSec) * 12_000_000) / 8))
}

// --- Preflight ----------------------------------------------------------------

export interface CloudPreflightRequest {
  targetWidth: number
  targetHeight: number
  renderWidth: number
  renderHeight: number
  fps: number
  durationSec: number
  fileSizeBytes?: number
}

export type CloudPreflightResult =
  | { ok: true; job: CloudJobCreated; capabilities: CloudCapabilities; cost: number }
  | {
      ok: false
      code: string
      error: string
      /** Present on a credit refusal: the server's own numbers. */
      cost?: number
      balance?: number
    }

/** capabilities → credit preflight → job (which reserves the credits). */
export async function preflightCloudExport(request: CloudPreflightRequest): Promise<CloudPreflightResult> {
  let capabilities: CloudCapabilities
  try {
    capabilities = await fetchCapabilities()
  } catch (error) {
    const cloudError = error instanceof CloudError ? error : new CloudError(String(error), 'unreachable')
    return {
      ok: false,
      code: cloudError.code,
      error: `Could not reach the upscaling service: ${cloudError.message}`,
    }
  }

  if (capabilities.cloudEnabled === false) {
    return { ok: false, code: 'cloud_disabled', error: 'Cloud upscaling is temporarily unavailable.' }
  }

  try {
    const job = await createJob({
      sourceWidth: request.renderWidth,
      sourceHeight: request.renderHeight,
      fps: request.fps,
      durationSec: request.durationSec,
      fileSizeBytes: request.fileSizeBytes ?? estimateIntermediateBytes(request.durationSec, request.fps),
      targetWidth: request.targetWidth,
      targetHeight: request.targetHeight,
    })
    return { ok: true, job, capabilities, cost: job.estimatedCost }
  } catch (error) {
    const cloudError = error as CloudError
    const details = (cloudError.details ?? {}) as { cost?: number; balance?: number; estimatedCost?: number }
    if (cloudError.code === 'insufficient_credits') {
      const cost = details.cost ?? details.estimatedCost ?? 0
      return {
        ok: false,
        code: 'insufficient_credits',
        error: `This export needs ${cost} credits and the account has ${details.balance ?? 0}.`,
        cost,
        balance: details.balance,
      }
    }
    return { ok: false, code: cloudError.code, error: `Could not start the cloud upscale: ${cloudError.message}` }
  }
}

// --- The stages after the render ----------------------------------------------

export interface CloudExportProgress {
  stage: CloudStage
  /** 0-100 within the stage. */
  stagePercent: number
  framesDone?: number
  totalFrames?: number
  reserved?: number
  consumed?: number
  etaSeconds?: number | null
}

export interface RunCloudExportRequest {
  job: CloudJobCreated
  intermediatePath: string
  outputPath: string
  cancel: CloudCancellation
  onProgress: (progress: CloudExportProgress) => void
  /** Used for the cancel projection; comes from capabilities. */
  minChargeCredits?: number
}

export type CloudExportResult =
  | { ok: true; outputPath: string; charge: number; refund: number }
  | {
      ok: false
      reason: 'canceled' | 'failed' | 'rejected'
      error: string
      /** The server's settled numbers, when it settled the job. */
      charge?: number
      refund?: number
      /** Present when the probe refused the file. */
      cost?: number
      /** Kept so the user's render time is not thrown away. */
      intermediatePath?: string
      /** True when a cloud retry is still possible. */
      canRetryCloud: boolean
    }

function progressFromView(
  view: CloudJobView,
): Pick<CloudExportProgress, 'framesDone' | 'totalFrames' | 'reserved' | 'consumed' | 'etaSeconds'> {
  return {
    framesDone: view.framesDone,
    totalFrames: view.totalFrames,
    reserved: view.reserved,
    consumed: view.consumed,
    etaSeconds: view.etaSeconds ?? null,
  }
}

/**
 * Upload → complete → start → poll → download.
 *
 * Cancelling calls `DELETE /v1/jobs/:id`, waits for the job to settle and
 * reports the server's `charge`/`refund`; the intermediate is deleted only on
 * success, so a failed cloud step leaves the local render available.
 */
export async function runCloudExport(request: RunCloudExportRequest): Promise<CloudExportResult> {
  const { job, intermediatePath, outputPath, cancel, onProgress } = request
  let lastView: CloudJobView | null = null

  try {
    // --- Upload ---------------------------------------------------------------
    onProgress({ stage: 'Uploading', stagePercent: 0 })
    const resume = getUploadResume(job.jobId)
    const uploaded = await uploadIntermediate(job.upload, intermediatePath, {
      cancel,
      resume: resume ?? undefined,
      onProgress: (percent, _sent, _total, current) => {
        onProgress({ stage: 'Uploading', stagePercent: percent })
        // Persist as we go, so an interrupted upload resumes instead of restarting.
        if (job.upload.type === 'multipart') saveUploadResume(job.jobId, current)
      },
    })
    if (job.upload.type === 'multipart') {
      saveUploadResume(job.jobId, uploaded)
      await completeUpload(job.jobId, uploaded.parts)
    }
    onProgress({ stage: 'Uploading', stagePercent: 100 })
    clearUploadResume(job.jobId)

    // --- Start + validate -----------------------------------------------------
    await startJob(job.jobId)
    onProgress({ stage: 'Validating', stagePercent: 0 })

    const view = await pollJob(job.jobId, {
      cancel,
      onUpdate: (polled) => {
        lastView = polled
        const stage = stageFromJobStatus(polled.status)
        if (!stage) return
        onProgress({ stage, stagePercent: polled.progress ?? 0, ...progressFromView(polled) })
      },
    })
    lastView = view

    if (view.status === 'rejected') {
      clearActiveJob()
      return {
        ok: false,
        reason: 'rejected',
        error: 'The upscaling service refused this file.',
        cost: typeof view.cost === 'number' ? view.cost : undefined,
        intermediatePath,
        canRetryCloud: false,
      }
    }

    if (view.status === 'canceled') {
      clearActiveJob()
      return {
        ok: false,
        reason: 'canceled',
        error: 'Export cancelled.',
        charge: view.charge ?? 0,
        refund: view.refund ?? 0,
        intermediatePath,
        canRetryCloud: false,
      }
    }

    if (view.status !== 'succeeded' || !view.downloadUrl) {
      clearActiveJob()
      return {
        ok: false,
        reason: 'failed',
        error: view.error?.code
          ? `The cloud upscale failed (${view.error.code}).`
          : `The cloud upscale ended as "${view.status}".`,
        charge: view.charge ?? 0,
        refund: view.refund ?? 0,
        intermediatePath,
        canRetryCloud: view.error?.class !== 'input',
      }
    }

    // --- Download -------------------------------------------------------------
    onProgress({ stage: 'Downloading', stagePercent: 0 })
    await downloadResult(view.downloadUrl, outputPath, {
      cancel,
      onProgress: (percent) => onProgress({ stage: 'Downloading', stagePercent: percent }),
    })
    onProgress({ stage: 'Downloading', stagePercent: 100, ...progressFromView(view) })

    clearActiveJob()
    await fsp.rm(intermediatePath, { force: true }).catch((error) => {
      log.warn(`[CloudExport] Could not remove the intermediate: ${error}`)
    })
    onProgress({ stage: 'Done', stagePercent: 100, ...progressFromView(view) })
    log.info(`[CloudExport] Job ${job.jobId} downloaded to ${outputPath}.`)
    return { ok: true, outputPath, charge: view.charge ?? view.cost, refund: view.refund ?? 0 }
  } catch (error) {
    const cloudError = error as CloudError

    if (cloudError.code === 'cancelled' || cancel.cancelled) {
      const settled = await cancelAndSettle(job.jobId, lastView)
      return {
        ok: false,
        reason: 'canceled',
        error: 'Export cancelled.',
        charge: settled.charge,
        refund: settled.refund,
        intermediatePath,
        canRetryCloud: false,
      }
    }

    log.error(`[CloudExport] Job ${job.jobId} failed: ${cloudError.message}`)
    // Ask the server to settle, so the user gets the refund it owes them.
    const settled = await cancelAndSettle(job.jobId, lastView)
    return {
      ok: false,
      reason: 'failed',
      error: cloudError.message,
      charge: settled.charge,
      refund: settled.refund,
      intermediatePath,
      canRetryCloud: true,
    }
  }
}

/**
 * `DELETE /v1/jobs/:id` and wait for settlement. The charge and refund come from
 * the job view the API returns; when the job never settled within the wait, the
 * last known numbers are reported and the job keeps running server-side.
 */
async function cancelAndSettle(
  jobId: string,
  lastView: CloudJobView | null,
): Promise<{ charge: number; refund: number }> {
  try {
    const status = await cancelJobRemote(jobId)
    if (status === 'canceled' || status === 'canceling') {
      const settled = await pollJob(jobId, { maxWaitMs: 60_000 }).catch(() => null)
      if (settled) {
        clearActiveJob()
        return { charge: settled.charge ?? 0, refund: settled.refund ?? 0 }
      }
    } else {
      // The job was already terminal when the cancel arrived.
      const view = await pollJob(jobId).catch(() => null)
      if (view) {
        clearActiveJob()
        return { charge: view.charge ?? 0, refund: view.refund ?? 0 }
      }
    }
  } catch (error) {
    log.warn(`[CloudExport] Could not settle ${jobId}: ${(error as Error).message}`)
  }
  return { charge: lastView?.charge ?? lastView?.consumed ?? 0, refund: lastView?.refund ?? 0 }
}

// --- Resuming after a restart -------------------------------------------------

export interface ResumeWatchRequest {
  jobId: string
  outputPath: string
  intermediatePath?: string
  cancel: CloudCancellation
  onProgress: (progress: CloudExportProgress) => void
}

/**
 * Picks up a job that was still running when the app closed: it keeps running on
 * the server, so the app only has to watch it and download the result.
 */
export async function watchActiveJob(request: ResumeWatchRequest): Promise<CloudExportResult> {
  const { jobId, outputPath, intermediatePath, cancel, onProgress } = request
  try {
    onProgress({ stage: 'Waiting for GPU', stagePercent: 0 })
    const view = await pollJob(jobId, {
      cancel,
      onUpdate: (polled) => {
        const stage = stageFromJobStatus(polled.status)
        if (stage) onProgress({ stage, stagePercent: polled.progress ?? 0, ...progressFromView(polled) })
      },
    })

    if (view.status === 'succeeded' && view.downloadUrl) {
      onProgress({ stage: 'Downloading', stagePercent: 0, ...progressFromView(view) })
      await downloadResult(view.downloadUrl, outputPath, {
        cancel,
        onProgress: (percent) => onProgress({ stage: 'Downloading', stagePercent: percent }),
      })
      clearActiveJob()
      if (intermediatePath) await fsp.rm(intermediatePath, { force: true }).catch(() => undefined)
      onProgress({ stage: 'Done', stagePercent: 100, ...progressFromView(view) })
      return { ok: true, outputPath, charge: view.charge ?? view.cost, refund: view.refund ?? 0 }
    }

    clearActiveJob()
    return {
      ok: false,
      reason: view.status === 'canceled' ? 'canceled' : 'failed',
      error: view.error?.code
        ? `The cloud upscale failed (${view.error.code}).`
        : `The cloud upscale ended as "${view.status}".`,
      charge: view.charge ?? 0,
      refund: view.refund ?? 0,
      intermediatePath,
      canRetryCloud: false,
    }
  } catch (error) {
    const cloudError = error as CloudError
    if (cloudError.code === 'cancelled' || cancel.cancelled) {
      const settled = await cancelAndSettle(jobId, null)
      return {
        ok: false,
        reason: 'canceled',
        error: 'Export cancelled.',
        charge: settled.charge,
        refund: settled.refund,
        intermediatePath,
        canRetryCloud: false,
      }
    }
    return {
      ok: false,
      reason: 'failed',
      error: cloudError.message,
      intermediatePath,
      canRetryCloud: true,
    }
  }
}

/** Records the job so the next launch can offer to resume watching it. */
export function rememberActiveJob(
  jobId: string,
  outputPath: string,
  intermediatePath: string,
  targetWidth: number,
  targetHeight: number,
): void {
  saveActiveJob({ jobId, outputPath, intermediatePath, targetWidth, targetHeight, startedAt: Date.now() })
}

/** Where an intermediate is kept between the render and the cloud stages. */
export function intermediatePathFor(basePath: string, stamp: number): string {
  return path.join(basePath, 'cloud-upscale', `intermediate-${stamp}.mp4`)
}
