// Cloud transcription: extract the audio, hand it to the API, collect the transcript.
//
// The orchestrator is deliberately the same shape as `cloud-export.ts` — upload,
// start, poll, download, with the same cancel semantics — because it is the same job
// lifecycle on the server. What it does not have is a local render: a transcription
// has nothing to render, so the only local work is pulling the audio track out of
// the recording.
//
// What is uploaded is the audio, not the video: a few MB instead of a few hundred,
// and the only part of the recording the model can use.

import fsp from 'node:fs/promises'
import log from 'electron-log/main'
import {
  CloudError,
  cancelJobRemote,
  completeUpload,
  createTranscribeJob,
  downloadTranscript,
  pollJob,
  startJob,
  uploadIntermediate,
  type CloudCancellation,
  type CloudJobView,
} from './cloud-client'
import { extractAudioForTranscription } from './audio-extract'
import { probeAudio } from '../lib/audio-info'
import { clearUploadResume, getUploadResume, saveUploadResume } from '../lib/cloud-store'
import { parseTranscriptJson, type TranscriptDocument } from '../../../shared/transcript'

/** The stages the user waits through; `Done` is terminal. */
export type TranscribeStage = 'Extracting audio' | 'Uploading' | 'Transcribing' | 'Downloading' | 'Done'

export const TRANSCRIBE_WORK_STAGES: TranscribeStage[] = [
  'Extracting audio',
  'Uploading',
  'Transcribing',
  'Downloading',
]

export interface TranscribeProgress {
  stage: TranscribeStage
  /** 0-100 within the stage. */
  stagePercent: number
  /** The server's reserved cost, once the job is priced from the probe. */
  reserved?: number
  consumed?: number
  audioSeconds?: number
  audioSecondsDone?: number
  etaSeconds?: number | null
  minChargeCredits?: number
}

export interface RunTranscriptionRequest {
  /** The recording (or its intermediate) to take the audio from. */
  sourcePath: string
  /** Where the extracted audio is written before upload. */
  audioPath: string
  /** Where the downloaded transcript is written. */
  transcriptPath: string
  language?: string
  model?: string
  cancel: CloudCancellation
  onProgress: (progress: TranscribeProgress) => void
}

export type TranscriptionResult =
  | {
      ok: true
      transcript: TranscriptDocument
      transcriptPath: string
      /** What the server settled, and the length it priced from. */
      charge: number
      refund: number
      audioSeconds: number
    }
  | {
      ok: false
      reason: 'canceled' | 'failed' | 'rejected'
      error: string
      charge?: number
      refund?: number
      /** The server's quote, when it refused for credits. */
      cost?: number
    }

function progressFromView(
  view: CloudJobView,
): Pick<TranscribeProgress, 'reserved' | 'consumed' | 'audioSeconds' | 'audioSecondsDone' | 'etaSeconds'> {
  return {
    reserved: view.reserved,
    consumed: view.consumed,
    audioSeconds: view.audioSeconds,
    audioSecondsDone: view.audioSecondsDone,
    etaSeconds: view.etaSeconds ?? null,
  }
}

/** What the user should read when a job ends without a transcript. */
function failureMessage(view: CloudJobView): string {
  switch (view.status) {
    case 'rejected':
      return view.error?.code === 'insufficient_credits'
        ? 'There were not enough credits to transcribe this recording.'
        : 'The transcription service could not accept this recording.'
    case 'canceled':
      return 'The transcription was cancelled.'
    case 'expired':
      return 'The transcript expired before it was downloaded.'
    default:
      return view.error?.class === 'infra'
        ? 'The transcription service failed. You were not charged.'
        : 'This recording could not be transcribed.'
  }
}

/**
 * Extract → create → upload → start → poll → download.
 *
 * Cancelling calls `DELETE /v1/jobs/:id` and waits for the job to settle, so the
 * numbers reported back are the server's own. Nothing is downloaded from a job that
 * did not succeed: a transcript that stops mid-sentence is not a deliverable, and the
 * server has already refunded the difference.
 */
export async function runTranscription(request: RunTranscriptionRequest): Promise<TranscriptionResult> {
  const { sourcePath, audioPath, transcriptPath, cancel, onProgress } = request
  let jobId: string | null = null
  let lastView: CloudJobView | null = null

  const settleAndReport = async (error: string, reason: 'canceled' | 'failed'): Promise<TranscriptionResult> => {
    if (jobId === null) return { ok: false, reason, error }
    try {
      const status = await cancelJobRemote(jobId)
      if (status === 'canceling') {
        lastView = await pollJob(jobId, { maxWaitMs: 60_000 })
      }
    } catch (cancelError) {
      log.warn('[Transcribe] Could not cancel the remote job:', cancelError)
    }
    return {
      ok: false,
      reason,
      error,
      ...(lastView?.charge !== undefined ? { charge: lastView.charge } : {}),
      ...(lastView?.refund !== undefined ? { refund: lastView.refund } : {}),
    }
  }

  try {
    // --- Extract ---------------------------------------------------------------
    onProgress({ stage: 'Extracting audio', stagePercent: 0 })
    const info = await probeAudio(sourcePath)
    if (!info.hasAudio) {
      return {
        ok: false,
        reason: 'rejected',
        error: 'This recording has no audio track, so there is nothing to transcribe.',
      }
    }
    await extractAudioForTranscription({
      sourcePath,
      outputPath: audioPath,
      durationSec: info.durationSec,
      onProgress: (percent) => onProgress({ stage: 'Extracting audio', stagePercent: percent }),
      signal: undefined,
    })
    onProgress({ stage: 'Extracting audio', stagePercent: 100 })

    const { size } = await fsp.stat(audioPath)

    // --- Create ---------------------------------------------------------------
    const job = await createTranscribeJob({
      // The declared length is a preflight only; the server re-prices from its own
      // probe of the upload and that number is final.
      audioSeconds: info.durationSec ?? 0,
      fileSizeBytes: size,
      ...(request.language !== undefined ? { language: request.language } : {}),
      ...(request.model !== undefined ? { model: request.model } : {}),
    })
    jobId = job.jobId

    // --- Upload ---------------------------------------------------------------
    onProgress({ stage: 'Uploading', stagePercent: 0, reserved: job.estimatedCost })
    const resume = getUploadResume(job.jobId)
    const uploaded = await uploadIntermediate(job.upload, audioPath, {
      cancel,
      ...(resume ? { resume } : {}),
      onProgress: (percent, _sent, _total, current) => {
        onProgress({ stage: 'Uploading', stagePercent: percent })
        if (job.upload.type === 'multipart') saveUploadResume(job.jobId, current)
      },
    })
    if (job.upload.type === 'multipart') {
      saveUploadResume(job.jobId, uploaded)
    }
    // Completion is required for every plan type (see cloud-export.ts): it is the
    // server's only transition out of `uploading`, and `start` refuses anything
    // still uploading. A single plan just sends an empty parts list.
    await completeUpload(job.jobId, uploaded.parts)
    onProgress({ stage: 'Uploading', stagePercent: 100 })
    clearUploadResume(job.jobId)

    // --- Start and poll -------------------------------------------------------
    onProgress({ stage: 'Transcribing', stagePercent: 0, reserved: job.estimatedCost })
    await startJob(job.jobId)

    const view = await pollJob(job.jobId, {
      cancel,
      onUpdate: (current) => {
        lastView = current
        onProgress({ stage: 'Transcribing', stagePercent: current.progress ?? 0, ...progressFromView(current) })
      },
    })
    lastView = view

    if (view.status !== 'succeeded') {
      return {
        ok: false,
        reason: view.status === 'canceled' ? 'canceled' : view.status === 'rejected' ? 'rejected' : 'failed',
        error: failureMessage(view),
        ...(view.charge !== undefined ? { charge: view.charge } : {}),
        ...(view.refund !== undefined ? { refund: view.refund } : {}),
      }
    }

    // --- Download -------------------------------------------------------------
    if (view.downloadUrl === undefined) {
      return {
        ok: false,
        reason: 'failed',
        error: 'The transcription succeeded but the transcript could not be found.',
        ...(view.charge !== undefined ? { charge: view.charge } : {}),
      }
    }
    onProgress({ stage: 'Downloading', stagePercent: 0, ...progressFromView(view) })
    await downloadTranscript(view.downloadUrl, transcriptPath, {
      cancel,
      onProgress: (percent) => onProgress({ stage: 'Downloading', stagePercent: percent, ...progressFromView(view) }),
    })
    onProgress({ stage: 'Downloading', stagePercent: 100, ...progressFromView(view) })

    const raw = await fsp.readFile(transcriptPath, 'utf8')
    const transcript = parseTranscriptJson(raw)
    if (transcript === null) {
      // The charge stands: the server did the work. Reporting it as a failure with
      // the settled numbers lets the dialog be honest about both.
      return {
        ok: false,
        reason: 'failed',
        error: 'The transcript came back unreadable.',
        ...(view.charge !== undefined ? { charge: view.charge } : {}),
        ...(view.refund !== undefined ? { refund: view.refund } : {}),
      }
    }

    onProgress({ stage: 'Done', stagePercent: 100, ...progressFromView(view) })
    return {
      ok: true,
      transcript,
      transcriptPath,
      charge: view.charge ?? view.cost,
      refund: view.refund ?? 0,
      audioSeconds: view.audioSeconds ?? info.durationSec ?? 0,
    }
  } catch (error) {
    const cloudError = error instanceof CloudError ? error : new CloudError(String(error), 'unknown')
    if (cloudError.code === 'cancelled') {
      return await settleAndReport('The transcription was cancelled.', 'canceled')
    }
    if (cloudError.code === 'insufficient_credits') {
      return { ok: false, reason: 'rejected', error: 'There were not enough credits to transcribe this recording.' }
    }
    log.error('[Transcribe] Failed:', cloudError.message)
    return { ok: false, reason: 'failed', error: cloudError.message }
  }
}
