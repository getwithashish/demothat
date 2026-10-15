// Client for the cloud upscale API (docs/cloud-upscale-api.md).
//
// Lives in the main process: it streams the rendered intermediate from disk (the
// file is never loaded into memory), polls the job with backoff, downloads the
// result and can be cancelled at any point.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import Store from 'electron-store'
import log from 'electron-log/main'

// --- Settings -----------------------------------------------------------------

export const CLOUD_BASE_URL_KEY = 'cloud.baseUrl'
export const CLOUD_TOKEN_KEY = 'cloud.token'
export const CLOUD_CONSENT_KEY = 'cloud.consentAcceptedV1'

const DEFAULT_STORE_NAME = 'config'

let cachedStore: Store<Record<string, unknown>> | null = null

/**
 * Lazily created so importing this module has no side effects (the store needs
 * an Electron app name to resolve its directory, which plain-Node tests have not
 * got).
 */
function settingsStore(): Store<Record<string, unknown>> {
  if (!cachedStore) {
    cachedStore = new Store<Record<string, unknown>>(
      process.env.ELECTRON_STORE_NAME ? { name: process.env.ELECTRON_STORE_NAME } : { name: DEFAULT_STORE_NAME },
    )
  }
  return cachedStore
}

export interface CloudSettings {
  baseUrl: string
  token: string
}

/** Settings, or null when the backend has not been configured yet. */
export function getCloudSettings(): CloudSettings | null {
  const baseUrl = settingsStore().get(CLOUD_BASE_URL_KEY)
  const token = settingsStore().get(CLOUD_TOKEN_KEY)
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) return null
  if (typeof token !== 'string' || !token.trim()) return null
  return { baseUrl: baseUrl.trim().replace(/\/+$/, ''), token: token.trim() }
}

/** The stored consent decision, or null when the user has not been asked yet. */
export function getConsent(): { acceptedAt: number } | null {
  const value = settingsStore().get(CLOUD_CONSENT_KEY)
  if (!value || typeof value !== 'object') return null
  const acceptedAt = (value as { acceptedAt?: unknown }).acceptedAt
  return typeof acceptedAt === 'number' ? { acceptedAt } : null
}

export function recordConsent(accepted: boolean): void {
  if (accepted) settingsStore().set(CLOUD_CONSENT_KEY, { acceptedAt: Date.now() })
  else settingsStore().delete(CLOUD_CONSENT_KEY)
}

// --- Types --------------------------------------------------------------------

export interface CloudModel {
  id: string
  label?: string
  scales: number[]
}

export interface CloudCapabilities {
  apiVersion: string
  models: CloudModel[]
  defaultModel?: string
  targets: Array<{ key: string; width: number; height: number }>
  /** Measured frames per second per target key. */
  upscaleFps: Record<string, number>
  startupSeconds: number
  pricing: { creditsPerOutputMegapixelFrame: number; currency?: string }
  /** The account balance. */
  credits: number
  limits: {
    maxFileSizeBytes: number
    maxDurationSec: number
    maxOutputMegapixels: number
    maxConcurrentJobs: number
  }
}

export interface CloudJobRequest {
  sourceWidth: number
  sourceHeight: number
  fps: number
  durationSec: number
  fileSizeBytes: number
  targetWidth: number
  targetHeight: number
  model: string
}

export interface CloudJobCreated {
  jobId: string
  status: string
  uploadUrl: string
  uploadExpiresAt?: string
  creditsReserved: number
  plan?: { model: string; modelScales?: number[]; modelScale?: number; finalScale?: string | null }
}

export type CloudJobStatus = 'awaiting_upload' | 'queued' | 'upscaling' | 'ready' | 'failed' | 'cancelled' | 'expired'

export interface CloudJobView {
  jobId: string
  status: CloudJobStatus
  progress: number
  etaSeconds: number | null
  downloadUrl: string | null
  creditsReserved: number
  creditsCharged: number | null
  source: { width: number; height: number; fps: number; durationSec: number } | null
  result: { width: number; height: number; fileSizeBytes: number; codec: string; creditsCharged: number } | null
  error?: { code: string; message: string }
}

/** A caller-owned flag; flip `cancelled` to abort whatever request is in flight. */
export interface CloudCancellation {
  cancelled: boolean
}

export class CloudError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'CloudError'
  }
}

// --- Pure helpers -------------------------------------------------------------

/** Poll backoff: start quick (the job may already be done), then ease off. */
export function nextPollDelay(currentMs: number, maxMs = 5000): number {
  return Math.min(Math.round(currentMs * 1.5), maxMs)
}

/**
 * The credit estimate shown before uploading. The server recomputes the real
 * price from its own probe of the upload; this is the number the user consents
 * to, and it is deliberately computed the same way.
 */
export function estimateCredits(
  capabilities: Pick<CloudCapabilities, 'pricing'>,
  targetWidth: number,
  targetHeight: number,
  frames: number,
): number {
  const megapixels = (targetWidth * targetHeight) / 1_000_000
  const rate = capabilities.pricing?.creditsPerOutputMegapixelFrame ?? 0
  if (!(megapixels > 0) || !(frames > 0) || !(rate > 0)) return 0
  return Math.max(1, Math.ceil(megapixels * frames * rate))
}

/** The target key the server advertises for a size, for its `upscaleFps` table. */
export function targetKeyFor(capabilities: Pick<CloudCapabilities, 'targets'>, width: number, height: number): string | null {
  const match = capabilities.targets.find((target) => target.width === width && target.height === height)
  return match?.key ?? null
}

// --- HTTP ---------------------------------------------------------------------

const RETRY_DELAYS_MS = [400, 1200, 3000]
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function transportFor(url: URL) {
  return url.protocol === 'https:' ? https : http
}

function retryable(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code
  return (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND' ||
    (error as CloudError)?.code === 'server_error'
  )
}

function parseErrorBody(body: string, status: number): { code: string; message: string } {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: string; message?: string } }
    return {
      code: parsed.error?.code ?? `http_${status}`,
      message: parsed.error?.message ?? `The server returned HTTP ${status}`,
    }
  } catch {
    return { code: `http_${status}`, message: `The server returned HTTP ${status}` }
  }
}

/** JSON request with bearer auth, and retries for network/5xx failures. */
export async function requestJson<T>(
  settings: CloudSettings,
  method: 'GET' | 'POST' | 'DELETE',
  urlPath: string,
  body?: unknown,
  options: { cancel?: CloudCancellation; retries?: number } = {},
): Promise<T> {
  const url = new URL(urlPath, `${settings.baseUrl}/`)
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
  const attempts = (options.retries ?? RETRY_DELAYS_MS.length) + 1

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (options.cancel?.cancelled) throw new CloudError('Cancelled', 'cancelled')
    try {
      return await new Promise<T>((resolve, reject) => {
        const request = transportFor(url).request(
          {
            method,
            hostname: url.hostname,
            port: url.port,
            path: `${url.pathname}${url.search}`,
            headers: {
              Authorization: `Bearer ${settings.token}`,
              Accept: 'application/json',
              ...(payload
                ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) }
                : {}),
            },
          },
          (response) => {
            const chunks: Buffer[] = []
            response.on('data', (chunk) => chunks.push(chunk as Buffer))
            response.on('end', () => {
              const text = Buffer.concat(chunks).toString()
              const status = response.statusCode ?? 0
              if (status >= 200 && status < 300) {
                try {
                  resolve((text ? JSON.parse(text) : {}) as T)
                } catch (error) {
                  reject(new CloudError(`Malformed response: ${String(error)}`, 'bad_response', status))
                }
                return
              }
              const { code, message } = parseErrorBody(text, status)
              reject(new CloudError(message, status >= 500 ? 'server_error' : code, status))
            })
            response.on('error', reject)
          },
        )
        request.on('error', reject)
        if (payload) request.write(payload)
        request.end()
      })
    } catch (error) {
      const isLast = attempt === attempts - 1
      if (isLast || !retryable(error)) throw error
      const delay = RETRY_DELAYS_MS[attempt] ?? 3000
      log.warn(`[CloudClient] ${method} ${urlPath} failed (${(error as Error).message}); retrying in ${delay}ms`)
      await sleep(delay)
    }
  }
  throw new CloudError('Unreachable', 'unreachable')
}

export async function fetchCapabilities(settings: CloudSettings, cancel?: CloudCancellation): Promise<CloudCapabilities> {
  return requestJson<CloudCapabilities>(settings, 'GET', '/v1/capabilities', undefined, { cancel })
}

export async function createJob(
  settings: CloudSettings,
  request: CloudJobRequest,
  cancel?: CloudCancellation,
): Promise<CloudJobCreated> {
  return requestJson<CloudJobCreated>(settings, 'POST', '/v1/jobs', request, { cancel })
}

export async function cancelJob(settings: CloudSettings, jobId: string): Promise<void> {
  await requestJson(settings, 'DELETE', `/v1/jobs/${jobId}`, undefined, { retries: 0 }).catch((error) => {
    log.warn(`[CloudClient] Could not cancel job ${jobId}: ${(error as Error).message}`)
  })
}

// --- Streaming upload ---------------------------------------------------------

/**
 * Streams the intermediate to its presigned URL, reporting progress from the
 * bytes handed to the socket. A network failure restarts the upload (the file is
 * still on disk); anything else is surfaced as a CloudError.
 */
export async function uploadIntermediate(
  job: CloudJobCreated,
  filePath: string,
  onProgress: (percent: number, sentBytes: number, totalBytes: number) => void,
  cancel?: CloudCancellation,
  attempts = 3,
): Promise<void> {
  const stat = await fsp.stat(filePath)

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const url = new URL(job.uploadUrl)
        const request = transportFor(url).request(
          {
            method: 'PUT',
            hostname: url.hostname,
            port: url.port,
            path: `${url.pathname}${url.search}`,
            headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(stat.size) },
          },
          (response) => {
            const chunks: Buffer[] = []
            response.on('data', (chunk) => chunks.push(chunk as Buffer))
            response.on('end', () => {
              const status = response.statusCode ?? 0
              if (status >= 200 && status < 300) {
                resolve()
                return
              }
              const { code, message } = parseErrorBody(Buffer.concat(chunks).toString(), status)
              reject(new CloudError(message, code, status))
            })
            response.on('error', reject)
          },
        )

        const stream = fs.createReadStream(filePath)
        let sent = 0
        const watcher = setInterval(() => {
          if (!cancel?.cancelled) return
          clearInterval(watcher)
          stream.destroy()
          request.destroy()
          reject(new CloudError('Cancelled', 'cancelled'))
        }, 150)

        const done = (error?: Error) => {
          clearInterval(watcher)
          if (error) reject(error)
        }
        stream.on('data', (chunk: Buffer | string) => {
          sent += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
          onProgress(Math.min(100, (sent / stat.size) * 100), sent, stat.size)
        })
        stream.on('error', (error) => done(error))
        request.on('error', (error) => done(error))
        request.on('close', () => clearInterval(watcher))
        stream.pipe(request)
      })
      return
    } catch (error) {
      const isLast = attempt === attempts
      if (isLast || !retryable(error) || cancel?.cancelled) throw error
      log.warn(`[CloudClient] Upload failed (${(error as Error).message}); restarting (attempt ${attempt + 1}/${attempts})`)
      onProgress(0, 0, stat.size)
      await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 3000)
    }
  }
}

// --- Polling ------------------------------------------------------------------

export interface PollOptions {
  cancel?: CloudCancellation
  /** Give up after this long (default 30 minutes). */
  maxWaitMs?: number
  /** Initial interval (default 700ms). */
  initialDelayMs?: number
  onProgress?: (view: CloudJobView) => void
}

/** Polls until the job settles, easing the interval off between calls. */
export async function pollJob(settings: CloudSettings, jobId: string, options: PollOptions = {}): Promise<CloudJobView> {
  const startedAt = Date.now()
  const maxWaitMs = options.maxWaitMs ?? 30 * 60 * 1000
  let delay = options.initialDelayMs ?? 700

  for (;;) {
    if (options.cancel?.cancelled) throw new CloudError('Cancelled', 'cancelled')
    const view = await requestJson<CloudJobView>(settings, 'GET', `/v1/jobs/${jobId}`, undefined, {
      cancel: options.cancel,
    })
    options.onProgress?.(view)
    if (['ready', 'failed', 'cancelled', 'expired'].includes(view.status)) return view
    if (Date.now() - startedAt > maxWaitMs) {
      throw new CloudError('The cloud upscale did not finish in time.', 'timeout')
    }
    await sleep(delay)
    delay = nextPollDelay(delay)
  }
}

// --- Download -----------------------------------------------------------------

/**
 * Streams the result to destPath.
 *
 * Writes to a `.part` file and renames, so a cancelled or failed download never
 * leaves a half-written file at the user's chosen output path.
 */
export async function downloadResult(
  downloadUrl: string,
  destPath: string,
  onProgress: (percent: number, receivedBytes: number, totalBytes: number) => void,
  cancel?: CloudCancellation,
): Promise<number> {
  const partialPath = `${destPath}.part`
  await fsp.mkdir(path.dirname(destPath), { recursive: true })

  let received = 0
  await new Promise<void>((resolve, reject) => {
    const url = new URL(downloadUrl)
    const request = transportFor(url).request(
      { method: 'GET', hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}` },
      (response) => {
        const status = response.statusCode ?? 0
        if (status < 200 || status >= 300) {
          const chunks: Buffer[] = []
          response.on('data', (chunk) => chunks.push(chunk as Buffer))
          response.on('end', () => {
            const { code, message } = parseErrorBody(Buffer.concat(chunks).toString(), status)
            reject(new CloudError(message, code, status))
          })
          return
        }
        const total = Number(response.headers['content-length'] ?? 0)
        const writer = fs.createWriteStream(partialPath)
        const watcher = setInterval(() => {
          if (!cancel?.cancelled) return
          clearInterval(watcher)
          response.destroy()
          writer.destroy()
          reject(new CloudError('Cancelled', 'cancelled'))
        }, 150)
        response.on('data', (chunk: Buffer) => {
          received += chunk.length
          if (total > 0) onProgress(Math.min(100, (received / total) * 100), received, total)
        })
        response.pipe(writer)
        writer.on('close', () => {
          clearInterval(watcher)
          resolve()
        })
        writer.on('error', reject)
      },
    )
    request.on('error', reject)
    request.end()
  })

  await fsp.rename(partialPath, destPath)
  return received
}
