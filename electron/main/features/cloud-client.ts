// Client for demothat-api's cloud upscaling jobs (contract 2.0.0).
//
// Provider-free: plain node:http / node:https, no storage credentials, no
// provider SDK. The intermediate is streamed from disk (never loaded into
// memory), multipart uploads run three parts at a time and can resume from the
// parts that already landed, and the result download resumes from a partial
// file before being renamed into place.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import log from 'electron-log/main'
import type { components } from '../../../shared/api-types'
import { ApiError, apiRequest } from '../lib/api-client'
import { getApiBaseUrl } from '../lib/api-config'
import { getStoredToken } from './license-client'

export type CloudCapabilities = components['schemas']['Capabilities']
export type CloudJobView = components['schemas']['JobView']
export type CloudJobCreated = components['schemas']['CreateJobResponse']
export type CloudUploadPlan = components['schemas']['CreateJobResponse']['upload']

/** An error carrying the API's own code, so callers can branch on it. */
export class CloudError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'CloudError'
  }
}

/** A caller-owned flag; flip `cancelled` to abort whatever request is in flight. */
export interface CloudCancellation {
  cancelled: boolean
}

function asCloudError(error: unknown): CloudError {
  if (error instanceof CloudError) return error
  if (error instanceof ApiError) return new CloudError(error.message, error.code, error.status, error.details)
  return new CloudError((error as Error)?.message ?? String(error), 'unknown')
}

function requireToken(): string {
  const token = getStoredToken()
  if (!token) throw new CloudError('This computer is not activated. Enter your license key first.', 'not_activated')
  return token
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function transportFor(url: URL) {
  return url.protocol === 'https:' ? https : http
}

function retryable(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code
  if (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND'
  ) {
    return true
  }
  const status = (error as CloudError)?.status
  return typeof status === 'number' && status >= 500
}

// --- Capabilities --------------------------------------------------------------

const CAPABILITIES_TTL_MS = 60_000
let capabilitiesCache: { value: CloudCapabilities; at: number } | null = null

/** Pricing table, targets and limits. Unauthenticated, so it works before activation. */
export async function fetchCapabilities(force = false): Promise<CloudCapabilities> {
  if (!force && capabilitiesCache && Date.now() - capabilitiesCache.at < CAPABILITIES_TTL_MS) {
    return capabilitiesCache.value
  }
  const value = await apiRequest<CloudCapabilities>(getApiBaseUrl(), {
    method: 'GET',
    path: '/v1/capabilities',
    retries: 1,
  })
  capabilitiesCache = { value, at: Date.now() }
  return value
}

export function clearCapabilitiesCache(): void {
  capabilitiesCache = null
}

// --- Cost (from the server's table, never from client numbers) -----------------

import { creditsPerFrameFor, estimateCloudCredits, resolutionKeyForHeight } from '../../../shared/cloud-cost'

export { creditsPerFrameFor, estimateCloudCredits, resolutionKeyForHeight }

export interface CostEstimate {
  credits: number
  frames: number
  /** The capabilities key the estimate came from. */
  target: string
}

/**
 * Client-side estimate of a job's cost, using the same formula as the server.
 * The server recomputes it from its own probe of the upload; its number is final.
 */
export function estimateJobCredits(
  capabilities: CloudCapabilities,
  height: number,
  durationSec: number,
  fps: number,
): CostEstimate | null {
  const estimate = estimateCloudCredits(capabilities.creditsPerFrame, height, durationSec, fps)
  if (!estimate) return null
  return { credits: estimate.credits, frames: estimate.frames, target: estimate.target }
}

// --- Jobs ---------------------------------------------------------------------

export interface CreateJobInput {
  sourceWidth: number
  sourceHeight: number
  fps: number
  durationSec: number
  fileSizeBytes: number
  targetWidth: number
  targetHeight: number
}

/**
 * `POST /v1/jobs`: the credit preflight and the upload plan. A 402 comes back as
 * a CloudError with code `insufficient_credits` and `{ cost, balance }` details;
 * nothing has been reserved or rendered in that case.
 */
export async function createJob(input: CreateJobInput): Promise<CloudJobCreated> {
  try {
    return await apiRequest<CloudJobCreated>(getApiBaseUrl(), {
      method: 'POST',
      path: '/v1/jobs',
      body: input,
      token: requireToken(),
      retries: 1,
    })
  } catch (error) {
    throw asCloudError(error)
  }
}

/**
 * `POST /v1/jobs/transcribe` (contract 2.2.0): the same preflight shape as a job,
 * priced per minute of the declared audio. The server re-prices from its own probe
 * of the upload; a 402 arrives as a CloudError with code `insufficient_credits`.
 */
export interface CreateTranscribeJobInput {
  /** Declared length of the audio about to be uploaded: the preflight only. */
  audioSeconds: number
  fileSizeBytes: number
  language?: string
  model?: string
}

export async function createTranscribeJob(input: CreateTranscribeJobInput): Promise<CloudJobCreated> {
  try {
    return await apiRequest<CloudJobCreated>(getApiBaseUrl(), {
      method: 'POST',
      path: '/v1/jobs/transcribe',
      body: input,
      token: requireToken(),
      retries: 1,
    })
  } catch (error) {
    throw asCloudError(error)
  }
}

/**
 * The transcript behind a succeeded transcription job.
 *
 * `downloadResult` is reused rather than reimplemented: the object is fetched from a
 * presigned URL like any other result, and it is the *view* that knows it is JSON.
 */
export async function downloadTranscript(
  downloadUrl: string,
  destPath: string,
  options: { onProgress?: (percent: number) => void; cancel?: CloudCancellation } = {},
): Promise<number> {
  return await downloadResult(downloadUrl, destPath, options)
}

/** `POST /v1/jobs/:id/upload/complete`. Required for a multipart upload. */
export async function completeUpload(jobId: string, parts: Array<{ partNumber: number; etag: string }>): Promise<void> {
  try {
    await apiRequest(getApiBaseUrl(), {
      method: 'POST',
      path: `/v1/jobs/${encodeURIComponent(jobId)}/upload/complete`,
      body: { parts },
      token: requireToken(),
      retries: 1,
    })
  } catch (error) {
    throw asCloudError(error)
  }
}

/** `POST /v1/jobs/:id/start`: moves the job to validating and returns at once. */
export async function startJob(jobId: string): Promise<void> {
  try {
    await apiRequest(getApiBaseUrl(), {
      method: 'POST',
      path: `/v1/jobs/${encodeURIComponent(jobId)}/start`,
      token: requireToken(),
      retries: 1,
    })
  } catch (error) {
    throw asCloudError(error)
  }
}

/** `GET /v1/jobs/:id`. */
export async function fetchJob(jobId: string): Promise<CloudJobView> {
  try {
    return await apiRequest<CloudJobView>(getApiBaseUrl(), {
      method: 'GET',
      path: `/v1/jobs/${encodeURIComponent(jobId)}`,
      token: requireToken(),
      retries: 0,
    })
  } catch (error) {
    throw asCloudError(error)
  }
}

/** Poll interval for a running job (spec: every 2 seconds). */
export const JOB_POLL_INTERVAL_MS = 2000

/** Statuses after which polling stops. */
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'canceled', 'rejected', 'expired'])

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status)
}

/** Polls a job until it settles, easing off only when the API is unreachable. */
export async function pollJob(
  jobId: string,
  options: { cancel?: CloudCancellation; onUpdate?: (view: CloudJobView) => void; maxWaitMs?: number } = {},
): Promise<CloudJobView> {
  const startedAt = Date.now()
  const maxWaitMs = options.maxWaitMs ?? 60 * 60 * 1000
  let delay = JOB_POLL_INTERVAL_MS

  for (;;) {
    if (options.cancel?.cancelled) throw new CloudError('Cancelled', 'cancelled')

    let view: CloudJobView | null = null
    let hadNetworkError = false
    try {
      view = await fetchJob(jobId)
    } catch (error) {
      const cloudError = asCloudError(error)
      // A job whose license was revoked or that vanished is a real failure.
      if (!retryable(cloudError)) throw cloudError
      hadNetworkError = true
      log.warn(`[CloudClient] Poll failed for ${jobId}: ${cloudError.message}`)
    }

    if (view) {
      options.onUpdate?.(view)
      if (isTerminalStatus(view.status)) return view
    }

    if (Date.now() - startedAt > maxWaitMs) throw new CloudError('The cloud upscale did not finish in time.', 'timeout')

    await sleep(delay)
    delay = hadNetworkError ? Math.min(Math.round(delay * 1.5), 10_000) : JOB_POLL_INTERVAL_MS
  }
}

/**
 * `DELETE /v1/jobs/:id`. Returns the server's status: `canceling` while a
 * running job winds down, `canceled` once it is settled, or the job's actual
 * terminal status when the cancel arrived too late.
 */
export async function cancelJobRemote(jobId: string): Promise<string> {
  try {
    const result = await apiRequest<{ status: string }>(getApiBaseUrl(), {
      method: 'DELETE',
      path: `/v1/jobs/${encodeURIComponent(jobId)}`,
      token: requireToken(),
      retries: 1,
    })
    return result?.status ?? 'canceling'
  } catch (error) {
    throw asCloudError(error)
  }
}

// --- Upload -------------------------------------------------------------------

export interface UploadPart {
  partNumber: number
  etag: string
}

export interface UploadResume {
  uploadId: string | null
  parts: UploadPart[]
}

function putObject(
  url: string,
  headers: Record<string, string>,
  body: fs.ReadStream | Buffer,
  size: number,
): Promise<{ status: number; etag: string | null; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const request = transportFor(parsed).request(
      {
        method: 'PUT',
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        headers: { ...headers, 'Content-Length': String(size) },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => chunks.push(chunk as Buffer))
        response.on('end', () => {
          const status = response.statusCode ?? 0
          const etag = (response.headers.etag as string | undefined)?.replace(/"/g, '') ?? null
          resolve({ status, etag, body: Buffer.concat(chunks).toString() })
        })
        response.on('error', reject)
      },
    )
    request.on('error', reject)
    if (Buffer.isBuffer(body)) request.end(body)
    else body.pipe(request)
  })
}

function putPartWithRetry(url: string, filePath: string, start: number, end: number, attempts = 3): Promise<string> {
  const size = end - start + 1
  return (async () => {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const stream = fs.createReadStream(filePath, { start, end })
        const result = await putObject(url, {}, stream, size)
        if (result.status >= 200 && result.status < 300 && result.etag) return result.etag
        throw new CloudError(`Part upload failed with HTTP ${result.status}`, `http_${result.status}`, result.status)
      } catch (error) {
        if (attempt === attempts || !retryable(error)) throw asCloudError(error)
        log.warn(`[CloudClient] Part retry ${attempt}/${attempts} at offset ${start}`)
        await sleep(400 * attempt)
      }
    }
    throw new CloudError('Part upload failed', 'part_failed')
  })()
}

/** How many parts are in flight at once (spec: three). */
export const UPLOAD_PARALLELISM = 3

export interface UploadOptions {
  onProgress?: (percent: number, sentBytes: number, totalBytes: number, resume: UploadResume) => void
  cancel?: CloudCancellation
  /** Parts that already landed, so an interrupted upload does not restart. */
  resume?: UploadResume
}

/**
 * Uploads the intermediate using the plan from `POST /v1/jobs`.
 *
 * Multipart plan: three parts at a time, each retried on its own, and the
 * finished parts are returned so a later attempt (or the next app launch) skips
 * them. Single plan: one streaming PUT, restarted from scratch if it fails.
 */
export async function uploadIntermediate(
  plan: CloudUploadPlan,
  filePath: string,
  options: UploadOptions = {},
): Promise<UploadResume> {
  const stat = await fsp.stat(filePath)
  const total = stat.size

  if (plan.type === 'single') {
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (options.cancel?.cancelled) throw new CloudError('Cancelled', 'cancelled')
      try {
        const result = await putObject(plan.url, { 'Content-Type': 'video/mp4' }, fs.createReadStream(filePath), total)
        if (result.status >= 200 && result.status < 300) {
          options.onProgress?.(100, total, total, { uploadId: null, parts: [] })
          return { uploadId: null, parts: [] }
        }
        throw new CloudError(`Upload failed with HTTP ${result.status}`, `http_${result.status}`, result.status)
      } catch (error) {
        if (attempt === 3 || !retryable(error) || options.cancel?.cancelled) throw asCloudError(error)
        log.warn(`[CloudClient] Upload retry ${attempt}/3`)
        await sleep(600 * attempt)
      }
    }
    throw new CloudError('Upload failed', 'upload_failed')
  }

  const uploadId = options.resume?.uploadId ?? plan.uploadId
  const done = new Map<number, string>((options.resume?.parts ?? []).map((part) => [part.partNumber, part.etag]))
  const partSize = plan.partSize
  const partCount = plan.partUrls.length

  // Already-uploaded bytes count towards the progress bar from the start.
  let sent = Math.min(total, done.size * partSize)
  const snapshot = (): UploadResume => ({
    uploadId,
    parts: [...done.entries()]
      .map(([partNumber, etag]) => ({ partNumber, etag }))
      .sort((a, b) => a.partNumber - b.partNumber),
  })
  options.onProgress?.(Math.min(100, (sent / total) * 100), sent, total, snapshot())

  const offsetsFor = (partNumber: number) => {
    const start = (partNumber - 1) * partSize
    return { start, end: Math.min(start + partSize, total) - 1 }
  }

  const queue: number[] = []
  for (let partNumber = 1; partNumber <= partCount; partNumber++) {
    if (!done.has(partNumber)) queue.push(partNumber)
  }

  const worker = async () => {
    for (;;) {
      if (options.cancel?.cancelled) throw new CloudError('Cancelled', 'cancelled')
      const partNumber = queue.shift()
      if (partNumber === undefined) return
      const { start, end } = offsetsFor(partNumber)
      const url = plan.partUrls[partNumber - 1]
      const etag = await putPartWithRetry(url, filePath, start, end)
      done.set(partNumber, etag)
      sent += end - start + 1
      options.onProgress?.(Math.min(100, (sent / total) * 100), sent, total, snapshot())
    }
  }

  const workers = Array.from({ length: Math.min(UPLOAD_PARALLELISM, queue.length) }, worker)
  await Promise.all(workers)

  const parts = [...done.entries()]
    .map(([partNumber, etag]) => ({ partNumber, etag }))
    .sort((a, b) => a.partNumber - b.partNumber)

  return { uploadId, parts }
}

// --- Download -----------------------------------------------------------------

/**
 * Streams the result to `destPath`, resuming a partial file when one is left
 * over, and renames it into place only once it is complete.
 */
export async function downloadResult(
  downloadUrl: string,
  destPath: string,
  options: {
    onProgress?: (percent: number, receivedBytes: number, totalBytes: number) => void
    cancel?: CloudCancellation
  } = {},
): Promise<number> {
  const partialPath = `${destPath}.part`
  await fsp.mkdir(path.dirname(destPath), { recursive: true })

  let already = 0
  try {
    already = (await fsp.stat(partialPath)).size
  } catch {
    already = 0
  }

  const received = await new Promise<number>((resolve, reject) => {
    const parsed = new URL(downloadUrl)
    const request = transportFor(parsed).request(
      {
        method: 'GET',
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        headers: already > 0 ? { Range: `bytes=${already}-` } : {},
      },
      (response) => {
        const status = response.statusCode ?? 0
        if (status < 200 || status >= 300) {
          const chunks: Buffer[] = []
          response.on('data', (chunk) => chunks.push(chunk as Buffer))
          response.on('end', () =>
            reject(new CloudError(`Download failed with HTTP ${status}`, `http_${status}`, status)),
          )
          return
        }
        // 206 means the server honoured the range; 200 means start over.
        const resuming = status === 206
        let written = resuming ? already : 0
        const total = Number(response.headers['content-length'] ?? 0) + written
        const writer = fs.createWriteStream(partialPath, resuming ? { flags: 'a' } : { flags: 'w' })
        const watcher = setInterval(() => {
          if (!options.cancel?.cancelled) return
          clearInterval(watcher)
          response.destroy()
          writer.destroy()
          reject(new CloudError('Cancelled', 'cancelled'))
        }, 150)
        response.on('data', (chunk: Buffer) => {
          written += chunk.length
          if (total > 0) options.onProgress?.(Math.min(100, (written / total) * 100), written, total)
        })
        response.pipe(writer)
        writer.on('close', () => {
          clearInterval(watcher)
          resolve(written)
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
