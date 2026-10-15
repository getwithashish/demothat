// IPC for cloud (AI) upscaling: gating status, the one-time consent, and the two
// ways out of a cloud failure — retry the cloud step, or upscale the exact same
// render locally with Lanczos.

import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import log from 'electron-log/main'
import { applyRenderCap } from '../../../../shared/export-render-cap'
import type { BuildExportArgsOptions } from '../../features/build-export-args'
import {
  CloudError,
  type CloudCancellation,
  fetchCapabilities,
  getCloudSettings,
  getConsent,
  recordConsent,
} from '../../features/cloud-upscale-client'
import { cloudStagePercent, preflightCloudUpscale, runCloudStages } from '../../features/cloud-upscale-job'
import { runStandardFallback } from '../../features/export-manager'

export interface CloudStatus {
  configured: boolean
  consent: { acceptedAt: number } | null
  capabilities: Awaited<ReturnType<typeof fetchCapabilities>> | null
  error: string | null
}

/** What the export modal needs to gate the AI option and quote a credit cost. */
export async function handleCloudStatus(): Promise<CloudStatus> {
  const settings = getCloudSettings()
  const consent = getConsent()
  if (!settings) {
    return { configured: false, consent, capabilities: null, error: null }
  }
  try {
    return { configured: true, consent, capabilities: await fetchCapabilities(settings), error: null }
  } catch (error) {
    const message = error instanceof CloudError ? error.message : String(error)
    log.warn(`[Cloud] Capabilities unavailable: ${message}`)
    return { configured: true, consent, capabilities: null, error: message }
  }
}

export function handleCloudConsent(_event: IpcMainInvokeEvent, accepted: boolean): { accepted: boolean } {
  recordConsent(accepted)
  return { accepted }
}

/** While a retry is streaming, so the modal's Cancel can reach it. */
let activeRetry: CloudCancellation | null = null

export function handleCloudCancel(): void {
  if (activeRetry) activeRetry.cancelled = true
}

export interface CloudFallbackRequest {
  intermediatePath: string
  outputPath: string
  targetWidth: number
  targetHeight: number
  durationSec: number
  quality?: BuildExportArgsOptions['exportSettings']['quality']
}

/** Standard (Lanczos) upscale of the render the cloud step already produced. */
export async function handleCloudFallback(
  event: IpcMainInvokeEvent,
  request: CloudFallbackRequest,
): Promise<{ ok: boolean; error?: string }> {
  const window = BrowserWindow.fromWebContents(event.sender)
  const result = await runStandardFallback({
    ...request,
    onProgress: (percent) => {
      if (!window || window.isDestroyed()) return
      window.webContents.send('export:progress', { progress: percent, stage: 'Upscaling locally' })
    },
  })
  if (window && !window.isDestroyed()) {
    window.webContents.send(
      'export:complete',
      result.ok ? { success: true, outputPath: request.outputPath } : { success: false, error: result.error },
    )
  }
  return result
}

export interface CloudRetryRequest {
  intermediatePath: string
  outputPath: string
  targetWidth: number
  targetHeight: number
  fps: number
  durationSec: number
  model?: string
}

/** Re-runs the cloud stages on the intermediate that is already on disk. */
export async function handleCloudRetry(
  event: IpcMainInvokeEvent,
  request: CloudRetryRequest,
): Promise<{ ok: boolean; error?: string }> {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window.isDestroyed()) return { ok: false, error: 'The editor window is gone.' }

  const render = applyRenderCap(request.targetWidth, request.targetHeight)
  const cancel: CloudCancellation = { cancelled: false }
  activeRetry = cancel

  try {
    const preflight = await preflightCloudUpscale({
      editorWindow: window,
      targetWidth: request.targetWidth,
      targetHeight: request.targetHeight,
      renderWidth: render.width,
      renderHeight: render.height,
      fps: request.fps,
      durationSec: request.durationSec,
      model: request.model,
    })
    if (!preflight.ok) {
      window.webContents.send('export:complete', { success: false, error: preflight.error })
      return { ok: false, error: preflight.error }
    }

    const result = await runCloudStages({
      editorWindow: window,
      settings: preflight.settings,
      job: preflight.job,
      intermediatePath: request.intermediatePath,
      outputPath: request.outputPath,
      cancel,
      onProgress: (stage, percent) => {
        if (window.isDestroyed()) return
        window.webContents.send('export:progress', { progress: cloudStagePercent(stage, percent), stage })
      },
    })
    if (!window.isDestroyed()) {
      window.webContents.send(
        'export:complete',
        result.ok
          ? { success: true, outputPath: request.outputPath }
          : {
              success: false,
              error: result.error,
              intermediatePath: result.intermediatePath,
              canRetryCloud: !cancel.cancelled,
            },
      )
    }
    return { ok: result.ok, error: result.error }
  } finally {
    activeRetry = null
  }
}

export function registerCloudHandlers(): void {
  ipcMain.handle('cloud:status', handleCloudStatus)
  ipcMain.handle('cloud:consent', handleCloudConsent)
  ipcMain.handle('cloud:fallback', handleCloudFallback)
  ipcMain.handle('cloud:retry', handleCloudRetry)
  ipcMain.on('cloud:cancel', handleCloudCancel)
}
