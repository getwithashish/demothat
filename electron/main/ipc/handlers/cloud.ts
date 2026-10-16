// IPC for the cloud (AI) upscaling flow.
//
// The renderer asks for capabilities and consent, and receives progress and
// completion on the same `export:progress` / `export:complete` channels the
// local export uses. All network work stays in the main process.

import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import log from 'electron-log/main'
import { applyRenderCap } from '../../../../shared/export-render-cap'
import {
  CloudError,
  fetchCapabilities,
  type CloudCapabilities,
  type CloudCancellation,
} from '../../features/cloud-client'
import {
  preflightCloudExport,
  runCloudExport,
  watchActiveJob,
  type CloudExportProgress,
} from '../../features/cloud-export'
import { getStoredToken } from '../../features/license-client'
import { runStandardFallback } from '../../features/export-manager'
import { clearActiveJob, getActiveJob, hasCloudConsent, recordCloudConsent } from '../../lib/cloud-store'
import { appState } from '../../state'

/** The cancellation flag of whatever cloud work is currently running. */
let activeCancellation: CloudCancellation | null = null

function editorWindow(): BrowserWindow | null {
  const win = appState.editorWin
  return win && !win.isDestroyed() ? win : null
}

function emit(target: BrowserWindow | null, channel: string, payload: unknown): void {
  const win = target && !target.isDestroyed() ? target : editorWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(channel, payload)
}

// --- Status & consent ---------------------------------------------------------

export interface CloudStatus {
  /** True when this device is activated, which the cloud path requires. */
  configured: boolean
  consent: { acceptedAt: number } | null
  capabilities: CloudCapabilities | null
  error: string | null
}

/** What the export modal needs to gate the AI option and quote a credit cost. */
export async function handleCloudStatus(): Promise<CloudStatus> {
  const consent = hasCloudConsent() ? { acceptedAt: Date.now() } : null
  if (!getStoredToken()) {
    return { configured: false, consent, capabilities: null, error: null }
  }
  try {
    return { configured: true, consent, capabilities: await fetchCapabilities(), error: null }
  } catch (error) {
    const message = error instanceof CloudError ? error.message : String(error)
    log.warn(`[Cloud] Capabilities unavailable: ${message}`)
    return { configured: true, consent, capabilities: null, error: message }
  }
}

/** The pricing table on its own, for the Buy credits dialog's pack notes. */
export async function handleCloudCapabilities(): Promise<{
  capabilities: CloudCapabilities | null
  error: string | null
}> {
  try {
    return { capabilities: await fetchCapabilities(), error: null }
  } catch (error) {
    return { capabilities: null, error: error instanceof Error ? error.message : String(error) }
  }
}

export function handleCloudConsent(_event: IpcMainInvokeEvent, accepted: boolean): { accepted: boolean } {
  recordCloudConsent(accepted)
  return { accepted }
}

// --- Running a cloud export ---------------------------------------------------

function progressRelay(window: BrowserWindow | null) {
  return (progress: CloudExportProgress) => {
    emit(window, 'export:progress', {
      stage: progress.stage,
      stagePercent: progress.stagePercent,
      framesDone: progress.framesDone,
      totalFrames: progress.totalFrames,
      reserved: progress.reserved,
      consumed: progress.consumed,
      etaSeconds: progress.etaSeconds ?? null,
    })
  }
}

function reportOutcome(
  window: BrowserWindow | null,
  outcome: Awaited<ReturnType<typeof runCloudExport>>,
  outputPath: string,
): void {
  if (outcome.ok) {
    emit(window, 'export:complete', {
      success: true,
      outputPath,
      // The server's settled numbers, for the toast.
      charge: outcome.charge,
      refund: outcome.refund,
    })
    return
  }
  emit(window, 'export:complete', {
    success: false,
    error: outcome.error,
    cloudReason: outcome.reason,
    charge: outcome.charge,
    refund: outcome.refund,
    cost: outcome.cost,
    intermediatePath: outcome.intermediatePath,
    canRetryCloud: outcome.canRetryCloud,
  })
}

export function handleCloudCancel(): void {
  if (activeCancellation) activeCancellation.cancelled = true
}

export interface CloudRetryRequest {
  intermediatePath: string
  outputPath: string
  targetWidth: number
  targetHeight: number
  fps: number
  durationSec: number
}

/**
 * Retries the cloud step on the intermediate that is already on disk, so the
 * user's render time is not repeated. Creates a fresh job (and reserves again).
 */
export async function handleCloudRetry(
  event: IpcMainInvokeEvent,
  request: CloudRetryRequest,
): Promise<{ ok: boolean; error?: string }> {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window.isDestroyed()) return { ok: false, error: 'The editor window is gone.' }

  const render = applyRenderCap(request.targetWidth, request.targetHeight)
  const cancel: CloudCancellation = { cancelled: false }
  activeCancellation = cancel

  try {
    const preflight = await preflightCloudExport({
      targetWidth: request.targetWidth,
      targetHeight: request.targetHeight,
      renderWidth: render.width,
      renderHeight: render.height,
      fps: request.fps,
      durationSec: request.durationSec,
    })
    if (!preflight.ok) {
      emit(window, 'export:complete', {
        success: false,
        error: preflight.error,
        cloudReason: preflight.code,
        cost: preflight.cost,
        balance: preflight.balance,
      })
      return { ok: false, error: preflight.error }
    }

    const outcome = await runCloudExport({
      job: preflight.job,
      intermediatePath: request.intermediatePath,
      outputPath: request.outputPath,
      cancel,
      minChargeCredits: preflight.capabilities.minChargeCredits ?? 0,
      onProgress: progressRelay(window),
    })
    reportOutcome(window, outcome, request.outputPath)
    return { ok: outcome.ok, error: outcome.ok ? undefined : outcome.error }
  } finally {
    activeCancellation = null
  }
}

// --- Resuming a job that outlived the app -------------------------------------

/** The job that was still running when the app last closed, if there was one. */
export function handleCloudActiveJob(): { jobId: string; outputPath: string } | null {
  const record = getActiveJob()
  return record ? { jobId: record.jobId, outputPath: record.outputPath } : null
}

/** Keeps watching that job (it continued on the server) and downloads it. */
export async function handleCloudResumeWatch(event: IpcMainInvokeEvent): Promise<{ ok: boolean; error?: string }> {
  const record = getActiveJob()
  if (!record) return { ok: false, error: 'There is no cloud export to resume.' }

  const window = BrowserWindow.fromWebContents(event.sender)
  const cancel: CloudCancellation = { cancelled: false }
  activeCancellation = cancel

  try {
    const outcome = await watchActiveJob({
      jobId: record.jobId,
      outputPath: record.outputPath,
      intermediatePath: record.intermediatePath,
      cancel,
      onProgress: progressRelay(window),
    })
    reportOutcome(window, outcome, record.outputPath)
    return { ok: outcome.ok, error: outcome.ok ? undefined : outcome.error }
  } finally {
    activeCancellation = null
  }
}

/** Forgets the remembered job (used when the user dismisses the offer). */
export function handleCloudForgetJob(): { forgotten: boolean } {
  const had = getActiveJob() !== null
  clearActiveJob()
  return { forgotten: had }
}

// --- Standard (Lanczos) fallback ----------------------------------------------

export interface CloudFallbackRequest {
  intermediatePath: string
  outputPath: string
  targetWidth: number
  targetHeight: number
  durationSec: number
  quality?: 'low' | 'medium' | 'high'
}

/** Upscales the render the cloud step already produced, locally. */
export async function handleCloudFallback(
  event: IpcMainInvokeEvent,
  request: CloudFallbackRequest,
): Promise<{ ok: boolean; error?: string }> {
  const window = BrowserWindow.fromWebContents(event.sender)
  const result = await runStandardFallback({
    ...request,
    onProgress: (percent) => emit(window, 'export:progress', { progress: percent, stage: 'Upscaling locally' }),
  })
  emit(
    window,
    'export:complete',
    result.ok ? { success: true, outputPath: request.outputPath } : { success: false, error: result.error },
  )
  return result
}

export function registerCloudHandlers(): void {
  ipcMain.handle('cloud:status', handleCloudStatus)
  ipcMain.handle('cloud:capabilities', handleCloudCapabilities)
  ipcMain.handle('cloud:consent', handleCloudConsent)
  ipcMain.handle('cloud:fallback', handleCloudFallback)
  ipcMain.handle('cloud:retry', handleCloudRetry)
  ipcMain.on('cloud:cancel', handleCloudCancel)
  ipcMain.handle('cloud:active-job', handleCloudActiveJob)
  ipcMain.handle('cloud:resume-watch', handleCloudResumeWatch)
  ipcMain.handle('cloud:forget-job', handleCloudForgetJob)
}
