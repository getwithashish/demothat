// The cloud half of an AI (cloud) export: preflight, then the stages after the
// local render.
//
// Order matters. Credits are reserved in the preflight, *before* anything is
// rendered: a refusal must cost the user no render time at all (§9.4's
// acceptance). The render then produces the intermediate, which is uploaded,
// upscaled in the cloud and downloaded to the chosen output path.

import log from 'electron-log/main'
import { BrowserWindow, dialog } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  CloudError,
  type CloudCancellation,
  type CloudCapabilities,
  type CloudJobCreated,
  type CloudSettings,
  cancelJob,
  createJob,
  downloadResult,
  estimateCredits,
  fetchCapabilities,
  getCloudSettings,
  getConsent,
  pollJob,
  recordConsent,
  uploadIntermediate,
} from './cloud-upscale-client'

export type CloudStage = 'Rendering locally' | 'Uploading' | 'Upscaling in the cloud' | 'Downloading'

/**
 * Share of the overall bar each stage owns. The render is the longest local
 * stage, the cloud's own progress is what the user is waiting on, and the
 * download is almost always short.
 */
export const CLOUD_STAGE_WEIGHTS: Record<CloudStage, { from: number; to: number }> = {
  'Rendering locally': { from: 0, to: 40 },
  Uploading: { from: 40, to: 50 },
  'Upscaling in the cloud': { from: 50, to: 92 },
  Downloading: { from: 92, to: 100 },
}

/** Maps a stage's own 0-100 progress into the overall 0-100 bar. */
export function cloudStagePercent(stage: CloudStage, stagePercent: number): number {
  const { from, to } = CLOUD_STAGE_WEIGHTS[stage]
  const clamped = Math.max(0, Math.min(100, Number.isFinite(stagePercent) ? stagePercent : 0))
  return Math.round(from + ((to - from) * clamped) / 100)
}

/** A rough upload size, only ever used for the credits hint and the job body. */
export function estimateIntermediateBytes(durationSec: number, fps: number): number {
  // ~12 Mbps for a CRF 14 H.264 intermediate at the render cap.
  void fps
  return Math.max(1, Math.round((Math.max(0, durationSec) * 12_000_000) / 8))
}

export interface CloudPreflightRequest {
  editorWindow: BrowserWindow
  targetWidth: number
  targetHeight: number
  renderWidth: number
  renderHeight: number
  fps: number
  durationSec: number
  model?: string
}

export type CloudPreflightResult =
  | { ok: true; settings: CloudSettings; capabilities: CloudCapabilities; job: CloudJobCreated; credits: number }
  | { ok: false; error: string; code: string }

/** Settings → capabilities → consent → job (which reserves the credits). */
export async function preflightCloudUpscale(request: CloudPreflightRequest): Promise<CloudPreflightResult> {
  const settings = getCloudSettings()
  if (!settings) {
    return {
      ok: false,
      code: 'not_configured',
      error: 'Cloud upscaling is not set up yet. Add the backend URL and token in Settings.',
    }
  }

  let capabilities: CloudCapabilities
  try {
    capabilities = await fetchCapabilities(settings)
  } catch (error) {
    const cloudError = error as CloudError
    return {
      ok: false,
      code: cloudError.code ?? 'unreachable',
      error: `Could not reach the upscaling service: ${cloudError.message ?? String(error)}`,
    }
  }

  const frameCount = Math.max(1, Math.round(request.durationSec * request.fps))
  const credits = estimateCredits(capabilities, request.targetWidth, request.targetHeight, frameCount)

  // Consent, once: say what leaves the machine, for how long it is kept, and what
  // it costs. The choice is remembered.
  if (!getConsent()) {
    const { response } = await dialog.showMessageBox(request.editorWindow, {
      type: 'info',
      buttons: ['Upload and continue', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Upscale in the cloud',
      message: 'This export uploads your rendered video to the upscaling service.',
      detail:
        `The service receives only the rendered video - never your project file or its media - upscales it, ` +
        `and keeps it for at most 24 hours (it is deleted as soon as this export downloads it).\n\n` +
        `This export is estimated at ${credits} credit${credits === 1 ? '' : 's'} (balance ${capabilities.credits}).`,
    })
    if (response !== 0) {
      return { ok: false, code: 'consent_declined', error: 'Cloud upscaling was cancelled.' }
    }
    recordConsent(true)
  }

  try {
    const job = await createJob(settings, {
      sourceWidth: request.renderWidth,
      sourceHeight: request.renderHeight,
      fps: request.fps,
      durationSec: request.durationSec,
      // Advisory only: the server probes the upload and settles from that.
      fileSizeBytes: estimateIntermediateBytes(request.durationSec, request.fps),
      targetWidth: request.targetWidth,
      targetHeight: request.targetHeight,
      model: request.model ?? capabilities.defaultModel ?? 'realesr-animevideov3',
    })
    log.info(`[CloudUpscale] Job ${job.jobId} created, ${job.creditsReserved} credits reserved.`)
    return { ok: true, settings, capabilities, job, credits: job.creditsReserved }
  } catch (error) {
    const cloudError = error as CloudError
    if (cloudError.code === 'insufficient_credits') {
      return {
        ok: false,
        code: 'insufficient_credits',
        error: `Not enough credits for this upscale: it needs about ${credits} and the account has ${capabilities.credits}.`,
      }
    }
    return { ok: false, code: cloudError.code ?? 'job_failed', error: `Could not start the cloud upscale: ${cloudError.message}` }
  }
}

export interface CloudStagesRequest {
  editorWindow: BrowserWindow
  settings: CloudSettings
  job: CloudJobCreated
  intermediatePath: string
  outputPath: string
  cancel: CloudCancellation
  onProgress: (stage: CloudStage, stagePercent: number) => void
}

export interface CloudStagesResult {
  ok: boolean
  error?: string
  /** Kept when the cloud failed: the user's render time is not thrown away. */
  intermediatePath?: string
}

/** Upload → poll → download. Deletes the intermediate only on success. */
export async function runCloudStages(request: CloudStagesRequest): Promise<CloudStagesResult> {
  const { settings, job, intermediatePath, outputPath, cancel, onProgress } = request

  try {
    await uploadIntermediate(job, intermediatePath, (percent) => onProgress('Uploading', percent), cancel)
    onProgress('Uploading', 100)
    log.info(`[CloudUpscale] Uploaded ${intermediatePath} for job ${job.jobId}.`)

    const view = await pollJob(settings, job.jobId, {
      cancel,
      onProgress: (polled) => onProgress('Upscaling in the cloud', polled.progress ?? 0),
    })

    if (view.status === 'cancelled') return { ok: false, error: 'Export cancelled.', intermediatePath }
    if (view.status !== 'ready' || !view.downloadUrl) {
      await cancelJob(settings, job.jobId)
      return {
        ok: false,
        error: view.error?.message ?? `The cloud upscale ended as "${view.status}".`,
        intermediatePath,
      }
    }
    onProgress('Upscaling in the cloud', 100)

    await downloadResult(view.downloadUrl, outputPath, (percent) => onProgress('Downloading', percent), cancel)
    onProgress('Downloading', 100)

    // Success: the intermediate has served its purpose.
    await fsp.rm(intermediatePath, { force: true }).catch((error) => {
      log.warn(`[CloudUpscale] Could not remove the intermediate: ${error}`)
    })
    log.info(`[CloudUpscale] Job ${job.jobId} downloaded to ${outputPath}.`)
    return { ok: true }
  } catch (error) {
    const cloudError = error as CloudError
    if (cloudError.code === 'cancelled' || cancel.cancelled) {
      await cancelJob(settings, job.jobId)
      return { ok: false, error: 'Export cancelled.', intermediatePath }
    }
    log.error(`[CloudUpscale] ${cloudError.message ?? error}`)
    await cancelJob(settings, job.jobId)
    return {
      ok: false,
      error: `The cloud upscale failed: ${cloudError.message ?? String(error)}`,
      intermediatePath,
    }
  }
}

/** Where an intermediate is kept between the render and the cloud stages. */
export function intermediatePathFor(userDataPath: string, stamp: number): string {
  return path.join(userDataPath, 'cloud-upscale', `intermediate-${stamp}.mp4`)
}
