// IPC for instant publishing.
//
// One long-running invoke (`publish:start`) that reports through its own progress
// channel and a terminal `publish:complete` — the same shape as the cloud export and
// the transcription, because from the user's seat it is the same kind of wait.
//
// The Pro gate here is a *convenience*, not the boundary. This app is GPL-3.0 and
// anyone can rebuild it without this file: what actually stops a rebuilt client is
// that the API prices from a size it reads itself and refuses to activate a
// publication the balance cannot cover.

import fs from 'node:fs'
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
import {
  deletePublication,
  fetchPublicationAnalytics,
  listPublications,
  MAX_CAPTIONS_BYTES,
  publish,
  type PublicationAnalytics,
  type PublicationAnalyticsRange,
  type PublicationKind,
  type PublicationView,
  type PublishProgress,
} from '../../features/publishing'
import { getEntitlement } from '../../features/entitlement'
import { cancelActiveCloudWork, clearCloudCancellation, registerCloudCancellation } from '../../features/cloud-cancel'
import { getStoredToken } from '../../features/license-client'
import { appState } from '../../state'
import type { SubtitleCue } from '../../../../shared/subtitles'

function editorWindow(): BrowserWindow | null {
  const win = appState.editorWin
  return win && !win.isDestroyed() ? win : null
}

function emit(target: BrowserWindow | null, channel: string, payload: unknown): void {
  const win = target && !target.isDestroyed() ? target : editorWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(channel, payload)
}

export interface PublishStatus {
  /** True when this device is activated, which publishing requires. */
  configured: boolean
  /** The local Pro gate, for hiding the feature before it is tried. */
  pro: boolean
  publishing: CloudCapabilities['publishing'] | null
  error: string | null
}

/**
 * What the Publish dialog needs before it offers anything: whether this device can
 * publish, and the prices and terms the server publishes — which the dialog renders
 * rather than hard-coding, so a rate change on the server is a rate change here.
 */
export async function handlePublishStatus(): Promise<PublishStatus> {
  const entitlement = await getEntitlement()
  if (!getStoredToken()) {
    return { configured: false, pro: entitlement.pro, publishing: null, error: null }
  }
  try {
    const capabilities = await fetchCapabilities()
    return {
      configured: true,
      pro: entitlement.pro,
      publishing: capabilities.publishing ?? null,
      error: null,
    }
  } catch (error) {
    const message = error instanceof CloudError ? error.message : String(error)
    log.warn(`[Publishing] Capabilities unavailable: ${message}`)
    return { configured: true, pro: entitlement.pro, publishing: null, error: message }
  }
}

export interface PublishStartRequest {
  /** The rendered video to publish. */
  filePath: string
  kind: PublicationKind
  storageDays: number
  title?: string
  durationSec?: number
  /** The project's cues, in export time. Converted to WebVTT in the orchestrator. */
  captions?: SubtitleCue[]
}

export type PublishOutcome =
  | { ok: true; publication: PublicationView; captionsIncluded: boolean }
  | {
      ok: false
      reason: 'canceled' | 'failed' | 'rejected'
      error: string
      cost?: number
      balance?: number
    }

function progressRelay(window: BrowserWindow | null) {
  return (progress: PublishProgress) => {
    emit(window, 'publish:progress', {
      stage: progress.stage,
      stagePercent: progress.stagePercent,
      estimatedCost: progress.estimatedCost,
      bytesSent: progress.bytesSent,
      totalBytes: progress.totalBytes,
      throughputBps: progress.throughputBps,
      etaSeconds: progress.etaSeconds,
    })
  }
}

/**
 * Refuse obviously-wrong requests before a publication is created, so the user gets a
 * sentence rather than an HTTP status.
 */
async function validateRequest(request: PublishStartRequest): Promise<string | null> {
  if (typeof request.filePath !== 'string' || request.filePath.trim().length === 0) {
    return 'There is no video to publish.'
  }
  if (!['page', 'links', 'embed'].includes(request.kind)) {
    return 'That publishing option is not one this app knows about.'
  }
  try {
    const stat = await fsp.stat(request.filePath)
    if (!stat.isFile()) return 'That video is not a file this app can read.'
    if (stat.size === 0) return 'That video is empty, so there is nothing to publish.'
  } catch {
    return 'That video could not be found on disk. Export it again and retry.'
  }
  if (!(request.storageDays > 0)) return 'Choose how long the link should last.'
  return null
}

export async function handlePublishStart(
  event: IpcMainInvokeEvent,
  request: PublishStartRequest,
): Promise<PublishOutcome> {
  log.info(
    `[PublishIPC] handlePublishStart invoked: file='${request?.filePath}', kind=${request?.kind}, storageDays=${request?.storageDays}`,
  )
  const window = BrowserWindow.fromWebContents(event.sender)

  const invalid = await validateRequest(request)
  if (invalid !== null) {
    log.warn(`[PublishIPC] Request validation failed: ${invalid}`)
    emit(window, 'publish:complete', { success: false, error: invalid, reason: 'rejected' })
    return { ok: false, reason: 'rejected', error: invalid }
  }

  if (!getStoredToken()) {
    const message = 'This computer is not activated. Enter your license key first.'
    emit(window, 'publish:complete', { success: false, error: message, reason: 'rejected' })
    return { ok: false, reason: 'rejected', error: message }
  }

  // The server's cap is the real one; this is so the user is told before an upload
  // rather than after it.
  let capabilities: CloudCapabilities | null = null
  try {
    capabilities = await fetchCapabilities()
  } catch (error) {
    log.warn('[Publishing] Could not read capabilities before publishing:', error)
  }
  if (capabilities?.publishing != null) {
    if (!capabilities.publishing.enabled) {
      const message = 'Publishing is switched off for this deployment right now.'
      emit(window, 'publish:complete', { success: false, error: message, reason: 'rejected' })
      return { ok: false, reason: 'rejected', error: message }
    }
    const stat = await fsp.stat(request.filePath)
    if (stat.size > capabilities.publishing.maxSizeBytes) {
      const message = `This video is larger than the ${Math.round(
        capabilities.publishing.maxSizeBytes / 1_000_000_000,
      )} GB publishing limit.`
      emit(window, 'publish:complete', { success: false, error: message, reason: 'rejected' })
      return { ok: false, reason: 'rejected', error: message }
    }
    if (!capabilities.publishing.durationsDays.includes(request.storageDays) && request.storageDays > 0) {
      // Not fatal — the server decides — but a term it does not offer is a bug in the
      // caller, and finding out here beats finding out after an upload.
      log.warn(`[Publishing] Storage term ${request.storageDays} is not one the server offers`)
    }
  }

  if (request.captions !== undefined) {
    // Bounded before it is serialised, so a pathological project cannot spend the
    // main process building a track the server would reject.
    if (request.captions.length > 100_000) {
      const message = 'These captions are too long to publish with the video.'
      emit(window, 'publish:complete', { success: false, error: message, reason: 'rejected' })
      return { ok: false, reason: 'rejected', error: message }
    }
  }

  const cancel: CloudCancellation = { cancelled: false }
  // The same registry the cloud export and the transcription use: only one cloud
  // transfer can be in flight, so one flag is enough for Cancel to reach it.
  registerCloudCancellation(cancel)

  try {
    const result = await publish({
      filePath: request.filePath,
      kind: request.kind,
      storageDays: request.storageDays,
      ...(request.title !== undefined ? { title: request.title } : {}),
      ...(request.durationSec !== undefined ? { durationSec: request.durationSec } : {}),
      ...(request.captions !== undefined ? { captions: request.captions } : {}),
      cancel,
      onProgress: progressRelay(window),
    })

    if (result.ok) {
      emit(window, 'publish:complete', {
        success: true,
        publication: result.publication,
        captionsIncluded: result.captionsIncluded,
      })
    } else {
      emit(window, 'publish:complete', {
        success: false,
        error: result.error,
        reason: result.reason,
        cost: result.cost,
        balance: result.balance,
      })
    }
    return result
  } catch (error) {
    // A bug in the orchestrator must not leave the dialog waiting forever.
    const message = error instanceof Error ? error.message : String(error)
    log.error('[Publishing] Unhandled failure:', message)
    emit(window, 'publish:complete', { success: false, error: message, reason: 'failed' })
    return { ok: false, reason: 'failed', error: message }
  } finally {
    clearCloudCancellation(cancel)
  }
}

export async function handlePublishList(): Promise<
  { ok: true; publications: PublicationView[] } | { ok: false; error: string }
> {
  try {
    return { ok: true, publications: await listPublications() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function handlePublishDelete(
  _event: IpcMainInvokeEvent,
  request: { publicationId: string },
): Promise<{ ok: true; publication: PublicationView; creditsRefunded: number } | { ok: false; error: string }> {
  try {
    const result = await deletePublication(request.publicationId)
    return { ok: true, publication: result.view, creditsRefunded: result.creditsRefunded }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function handlePublishAnalytics(
  _event: IpcMainInvokeEvent,
  request: { publicationId: string; range?: PublicationAnalyticsRange },
): Promise<{ ok: true; analytics: PublicationAnalytics } | { ok: false; error: string }> {
  try {
    return { ok: true, analytics: await fetchPublicationAnalytics(request.publicationId, request.range ?? '30d') }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function handlePublishCancel(): boolean {
  log.info('[PublishIPC] handlePublishCancel invoked. Canceling active cloud work...')
  return cancelActiveCloudWork()
}

/**
 * The size of the file a publication would carry.
 *
 * The dialog has to quote a price before anything is uploaded, and the renderer has no
 * way to stat a file on its own — so the size comes from the main process, which is
 * also the side that will be told the real size by the server at completion.
 */
export async function handlePublishProbe(
  _event: IpcMainInvokeEvent,
  request: { filePath: string },
): Promise<{ ok: true; sizeBytes: number } | { ok: false; error: string }> {
  log.info(`[PublishIPC] Probing video file size: ${request?.filePath}`)
  try {
    const stat = await fsp.stat(request.filePath)
    if (!stat.isFile()) return { ok: false, error: 'That video is not a file this app can read.' }
    log.info(`[PublishIPC] Probed video file size: ${stat.size} bytes`)
    return { ok: true, sizeBytes: stat.size }
  } catch {
    log.warn(`[PublishIPC] Video file could not be found: ${request?.filePath}`)
    return { ok: false, error: 'That video could not be found on disk.' }
  }
}

export function handlePublishGetTempPath(
  _event?: IpcMainInvokeEvent,
  optionsOrPrefix?: string | { prefix?: string },
): string {
  let prefix: string | undefined
  if (typeof optionsOrPrefix === 'string') {
    prefix = optionsOrPrefix
  } else if (typeof optionsOrPrefix === 'object' && optionsOrPrefix !== null) {
    prefix = optionsOrPrefix.prefix
  }
  const cleanPrefix = typeof prefix === 'string' && prefix.trim().length > 0 ? prefix.trim() : 'demothat-publish'
  const tempDir = app.getPath('temp')
  const filename = `${cleanPrefix}-${Date.now()}.mp4`
  let candidate = path.join(tempDir, filename)
  if (fs.existsSync(candidate)) {
    let index = 1
    while (fs.existsSync(path.join(tempDir, `${cleanPrefix}-${Date.now()}-${index}.mp4`))) {
      index++
    }
    candidate = path.join(tempDir, `${cleanPrefix}-${Date.now()}-${index}.mp4`)
  }
  return candidate
}

export async function handlePublishSaveTempFile(
  _event: IpcMainInvokeEvent,
  requestOrTempPath: { tempPath: string; destinationPath: string } | string,
  maybeDestPath?: string,
): Promise<{ ok: boolean; error?: string }> {
  let tempPath: string
  let destinationPath: string

  if (typeof requestOrTempPath === 'object' && requestOrTempPath !== null) {
    tempPath = requestOrTempPath.tempPath
    destinationPath = requestOrTempPath.destinationPath
  } else {
    tempPath = requestOrTempPath
    destinationPath = maybeDestPath ?? ''
  }

  if (!tempPath || !destinationPath) {
    return { ok: false, error: 'Source or destination path is missing.' }
  }

  try {
    await fsp.mkdir(path.dirname(destinationPath), { recursive: true })
    await fsp.copyFile(tempPath, destinationPath)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error(`[PublishIPC] Failed to copy temp file from '${tempPath}' to '${destinationPath}':`, message)
    return { ok: false, error: message }
  }
}

export async function handlePublishCleanupTempFile(
  _event: IpcMainInvokeEvent,
  requestOrTempPath: { tempPath: string } | string,
): Promise<void> {
  const tempPath =
    typeof requestOrTempPath === 'object' && requestOrTempPath !== null ? requestOrTempPath.tempPath : requestOrTempPath

  if (!tempPath || typeof tempPath !== 'string') return

  try {
    await fsp.unlink(tempPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      const message = error instanceof Error ? error.message : String(error)
      log.warn(`[PublishIPC] Failed to clean up temp file '${tempPath}':`, message)
    }
  }
}

export function registerPublishHandlers(): void {
  log.info('[PublishIPC] Registering instant publishing IPC handlers...')
  ipcMain.handle('publish:status', handlePublishStatus)
  ipcMain.handle('publish:start', handlePublishStart)
  ipcMain.handle('publish:probe', handlePublishProbe)
  ipcMain.handle('publish:list', handlePublishList)
  ipcMain.handle('publish:delete', handlePublishDelete)
  ipcMain.handle('publish:analytics', handlePublishAnalytics)
  ipcMain.on('publish:cancel', handlePublishCancel)
  ipcMain.handle('publish:getTempPath', handlePublishGetTempPath)
  ipcMain.handle('publish:saveTempFile', handlePublishSaveTempFile)
  ipcMain.handle('publish:cleanupTempFile', handlePublishCleanupTempFile)
}

/** Exported for the renderer's own cap display, so the two cannot disagree. */
export { MAX_CAPTIONS_BYTES }
