// IPC for cloud transcription.
//
// One long-running invoke (`transcribe:start`) that reports through its own
// progress channel, plus a cancel channel — the same shape as the cloud export,
// because from the user's seat it is the same kind of wait.
//
// The extracted audio is a temporary upload artifact: it is written under the app's
// own data directory and deleted when the run ends, success or failure. The
// transcript is the deliverable, and it is written where the caller asks.

import fsp from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import log from 'electron-log/main'
import {
  CloudError,
  fetchCapabilities,
  type CloudCapabilities,
  type CloudCancellation,
} from '../../features/cloud-client'
import { runTranscription, type TranscribeProgress } from '../../features/transcribe'
import { cancelActiveCloudWork, clearCloudCancellation, registerCloudCancellation } from '../../features/cloud-cancel'
import { getStoredToken } from '../../features/license-client'
import { appState } from '../../state'
import type { TranscriptDocument } from '../../../../shared/transcript'

function editorWindow(): BrowserWindow | null {
  const win = appState.editorWin
  return win && !win.isDestroyed() ? win : null
}

function emit(target: BrowserWindow | null, channel: string, payload: unknown): void {
  const win = target && !target.isDestroyed() ? target : editorWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(channel, payload)
}

export interface TranscribeStatus {
  /** True when this device is activated, which a cloud job requires. */
  configured: boolean
  transcription: CloudCapabilities['transcription'] | null
  capabilities: CloudCapabilities | null
  error: string | null
}

/**
 * What the Subtitles panel needs before it offers anything: whether this device can
 * use the cloud at all, and the price and limits the server publishes.
 */
export async function handleTranscribeStatus(): Promise<TranscribeStatus> {
  if (!getStoredToken()) {
    return { configured: false, transcription: null, capabilities: null, error: null }
  }
  try {
    const capabilities = await fetchCapabilities()
    return {
      configured: true,
      transcription: capabilities.transcription ?? null,
      capabilities,
      error: null,
    }
  } catch (error) {
    const message = error instanceof CloudError ? error.message : String(error)
    log.warn(`[Transcribe] Capabilities unavailable: ${message}`)
    return { configured: true, transcription: null, capabilities: null, error: message }
  }
}

export interface TranscribeStartRequest {
  /** The recording (or rendered intermediate) to take the audio from. */
  sourcePath: string
  /**
   * Where the transcript JSON is written. Optional: the transcript belongs to the
   * project rather than to a file, so a caller that only wants the parsed document
   * can omit this and get a temporary file that is cleaned up here.
   */
  transcriptPath?: string
  language?: string
  model?: string
}

export type TranscribeOutcome =
  | {
      ok: true
      transcriptPath: string
      transcript: TranscriptDocument
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
      cost?: number
    }

function progressRelay(window: BrowserWindow | null) {
  return (progress: TranscribeProgress) => {
    emit(window, 'transcribe:progress', {
      stage: progress.stage,
      stagePercent: progress.stagePercent,
      reserved: progress.reserved,
      consumed: progress.consumed,
      audioSeconds: progress.audioSeconds,
      audioSecondsDone: progress.audioSecondsDone,
      etaSeconds: progress.etaSeconds ?? null,
    })
  }
}

/** Where the temporary extracted audio lives: ours, not the project's. */
function tempAudioPath(sourcePath: string): string {
  const base = path.basename(sourcePath).replace(/[^\w.-]+/g, '_')
  return path.join(app.getPath('userData'), 'transcribe', `${Date.now()}-${base}.m4a`)
}

/** The throwaway transcript file, when the caller did not ask for one. */
function tempTranscriptPath(sourcePath: string): string {
  const base = path.basename(sourcePath).replace(/[^\w.-]+/g, '_')
  return path.join(app.getPath('userData'), 'transcribe', `${Date.now()}-${base}.json`)
}

export async function handleTranscribeStart(
  event: IpcMainInvokeEvent,
  request: TranscribeStartRequest,
): Promise<TranscribeOutcome> {
  const window = BrowserWindow.fromWebContents(event.sender)
  const cancel: CloudCancellation = { cancelled: false }
  // The same registry the cloud export uses: only one cloud job can be in flight,
  // so one flag is enough for Cancel to reach whichever one it is.
  registerCloudCancellation(cancel)

  const audioPath = tempAudioPath(request.sourcePath)
  // A transcript the caller did not ask to keep is ours to delete.
  const transcriptPath = request.transcriptPath ?? tempTranscriptPath(request.sourcePath)
  const ownsTranscript = request.transcriptPath === undefined
  try {
    await fsp.mkdir(path.dirname(audioPath), { recursive: true })
    await fsp.mkdir(path.dirname(transcriptPath), { recursive: true })

    const result = await runTranscription({
      sourcePath: request.sourcePath,
      audioPath,
      transcriptPath,
      ...(request.language !== undefined ? { language: request.language } : {}),
      ...(request.model !== undefined ? { model: request.model } : {}),
      cancel,
      onProgress: progressRelay(window),
    })

    if (result.ok) {
      emit(window, 'transcribe:complete', {
        success: true,
        transcriptPath: result.transcriptPath,
        charge: result.charge,
        refund: result.refund,
        audioSeconds: result.audioSeconds,
      })
    } else {
      emit(window, 'transcribe:complete', {
        success: false,
        error: result.error,
        reason: result.reason,
        charge: result.charge,
        refund: result.refund,
        cost: result.cost,
      })
    }
    return result
  } catch (error) {
    // A bug in the orchestrator must not leave the UI waiting for a completion that
    // will never arrive.
    const message = error instanceof Error ? error.message : String(error)
    log.error('[Transcribe] Unhandled failure:', message)
    emit(window, 'transcribe:complete', { success: false, error: message, reason: 'failed' })
    return { ok: false, reason: 'failed', error: message }
  } finally {
    clearCloudCancellation(cancel)
    // The audio was only ever an upload artifact; the transcript is the deliverable —
    // unless the caller only wanted the parsed document, in which case this file was
    // ours and the project is where it lives.
    await fsp.rm(audioPath, { force: true }).catch(() => undefined)
    if (ownsTranscript) {
      await fsp.rm(transcriptPath, { force: true }).catch(() => undefined)
    }
  }
}

export function handleTranscribeCancel(): boolean {
  return cancelActiveCloudWork()
}

export function registerTranscribeHandlers(): void {
  ipcMain.handle('transcribe:status', handleTranscribeStatus)
  ipcMain.handle('transcribe:start', handleTranscribeStart)
  ipcMain.on('transcribe:cancel', handleTranscribeCancel)
}
