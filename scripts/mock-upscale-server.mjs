#!/usr/bin/env node
// Mock implementation of the cloud upscale API (docs/cloud-upscale-api.md).
//
// It exists so the client in this repo can be developed and tested without the
// real backend. The endpoints, credit reservation/settlement, presigned URL
// shape, retention sweep and error codes follow the contract; only the *upscale
// itself* is a stand-in — Video2X/Real-ESRGAN needs a Vulkan GPU, so this uses
// FFmpeg's Lanczos to the exact target plus an HEVC encode.
//
// No dependencies: node:http and the bundled ffmpeg only.
//
//   node scripts/mock-upscale-server.mjs
//
// env: MOCK_PORT (8787), MOCK_TOKEN (dev-token), MOCK_CREDITS (500),
//      MOCK_STARTUP_MS (1500), MOCK_FFMPEG (binaries/linux/ffmpeg),
//      MOCK_FAIL_UPSCALE (unset)

import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.MOCK_PORT ?? 8787)
const TOKEN = process.env.MOCK_TOKEN ?? 'dev-token'
const STARTUP_MS = Number(process.env.MOCK_STARTUP_MS ?? 1500)
const FAIL_UPSCALE = !!process.env.MOCK_FAIL_UPSCALE
const SIGNING_SECRET = process.env.MOCK_SECRET ?? crypto.randomBytes(16).toString('hex')
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FFMPEG = process.env.MOCK_FFMPEG ?? path.join(REPO_ROOT, 'binaries', 'linux', 'ffmpeg')

const UPLOAD_TTL_MS = 60 * 60 * 1000
const RETAIN_MS = 24 * 60 * 60 * 1000
const WORK_DIR = path.join(os.tmpdir(), 'demothat-mock-upscale')

const CAPABILITIES = {
  apiVersion: '1',
  models: [
    { id: 'realesr-animevideov3', label: 'Anime/Video 3x', scales: [2, 3, 4] },
    { id: 'realesrgan-plus', label: 'Real-ESRGAN+', scales: [4] },
  ],
  defaultModel: 'realesr-animevideov3',
  targets: [
    { key: '720p', width: 1280, height: 720 },
    { key: '1080p', width: 1920, height: 1080 },
    { key: '2k', width: 2560, height: 1440 },
    { key: '4k', width: 3840, height: 2160 },
    { key: '8k', width: 7680, height: 4320 },
  ],
  upscaleFps: { '720p': 30, '1080p': 18, '2k': 12, '4k': 7, '8k': 2.5 },
  startupSeconds: Math.round((STARTUP_MS / 1000) * 10) / 10,
  pricing: { creditsPerOutputMegapixelFrame: 0.0004, currency: 'credits' },
  limits: {
    maxFileSizeBytes: 2 * 1024 * 1024 * 1024,
    maxDurationSec: 3600,
    maxOutputMegapixels: 33.2,
    maxConcurrentJobs: 2,
  },
}

/** Account balance, in credits. Reserve on create, settle on success, refund otherwise. */
let balance = Number(process.env.MOCK_CREDITS ?? 500)

/** @type {Map<string, any>} */
const jobs = new Map()

const log = (...args) => console.log('[mock]', ...args)
const json = (res, status, body) => {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}
const fail = (res, status, code, message, extra = {}) => json(res, status, { error: { code, message, ...extra } })

// --- Signing -----------------------------------------------------------------

function sign(id, expires) {
  return crypto.createHmac('sha256', SIGNING_SECRET).update(`${id}:${expires}`).digest('hex').slice(0, 32)
}

function presignedUrl(req, kind, id) {
  const expires = Date.now() + UPLOAD_TTL_MS
  const host = req.headers.host ?? `127.0.0.1:${PORT}`
  return `http://${host}/v1/${kind}/${id}?expires=${expires}&sig=${sign(id, expires)}`
}

function checkSignature(query, id) {
  const expires = Number(query.get('expires') ?? 0)
  const sig = query.get('sig') ?? ''
  if (!expires || expires < Date.now()) return 'expired'
  if (sig !== sign(id, expires)) return 'bad_signature'
  return null
}

// --- Probing (server-side truth) ---------------------------------------------

/**
 * Reads the real dimensions/duration from the uploaded file with the bundled
 * ffmpeg (`-i` stderr). The real server uses ffprobe; this repo ships no ffprobe
 * binary, and the point stands either way: the client's numbers are ignored.
 */
function probe(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ['-hide_banner', '-i', filePath])
    let stderr = ''
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    child.on('error', reject)
    child.on('close', () => {
      const duration = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(stderr)
      const video = /Stream #\d+:\d+.*?: Video:.*?,\s*(\d{2,5})x(\d{2,5})/.exec(stderr)
      const fps = /,\s*(\d+(?:\.\d+)?)\s*fps/.exec(stderr)
      if (!video) {
        reject(new Error('ffprobe (ffmpeg -i) could not find a video stream'))
        return
      }
      const seconds = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : 0
      resolve({
        width: Number(video[1]),
        height: Number(video[2]),
        fps: fps ? Number(fps[1]) : 30,
        durationSec: seconds,
      })
    })
  })
}

// --- Scale planning (mirrors shared/upscale-plan.ts) -------------------------

function planUpscale(sourceWidth, sourceHeight, targetWidth, targetHeight, modelScales) {
  const scales = [...modelScales].sort((a, b) => a - b)
  const need = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const picked = scales.find((scale) => scale >= need * 0.99 - 1e-6) ?? scales[scales.length - 1]
  const modelScale = need <= 1 ? null : picked
  const modelWidth = modelScale ? Math.round(sourceWidth * modelScale) : Math.round(sourceWidth)
  const modelHeight = modelScale ? Math.round(sourceHeight * modelScale) : Math.round(sourceHeight)
  return {
    need,
    modelScale,
    modelWidth,
    modelHeight,
    finalScale:
      modelWidth === targetWidth && modelHeight === targetHeight
        ? null
        : `scale=${targetWidth}:${targetHeight}:flags=lanczos`,
  }
}

function priceFor(source, targetWidth, targetHeight, model) {
  const outputMegapixels = (targetWidth * targetHeight) / 1_000_000
  const frames = Math.max(1, Math.round(source.durationSec * source.fps))
  void model
  return Math.max(1, Math.ceil(outputMegapixels * frames * CAPABILITIES.pricing.creditsPerOutputMegapixelFrame))
}

// --- Upscale (ffmpeg stand-in for Video2X) -----------------------------------

function runUpscale(job) {
  return new Promise((resolve, reject) => {
    // Two stages, exactly like the real worker: the model's factor (here a plain
    // resize stands in for Real-ESRGAN, which needs a Vulkan GPU), then the
    // Lanczos scale to the exact target. Chaining both keeps the mock's geometry
    // identical to the contract's, so an exact-target assertion means something.
    const filters = []
    if (job.plan.modelScale !== null) {
      filters.push(`scale=${job.plan.modelWidth}:${job.plan.modelHeight}:flags=bicubic`)
    }
    if (job.plan.finalScale) filters.push(job.plan.finalScale)

    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', job.uploadPath]
    if (filters.length) args.push('-vf', filters.join(','))
    args.push('-progress', 'pipe:1', '-nostats')
    args.push(
      '-c:v',
      'libx265',
      '-tag:v',
      'hvc1',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      job.resultPath,
    )

    const child = spawn(FFMPEG, args)
    let buffer = ''
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const [key, value] = line.split('=')
        if (key === 'out_time_us' && job.source.durationSec > 0) {
          const seconds = Number(value) / 1_000_000
          job.progress = Math.max(job.progress, Math.min(99, (seconds / job.source.durationSec) * 100))
        }
      }
    })
    child.stderr.on('data', (chunk) => log(`ffmpeg: ${chunk.toString().trim()}`))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))))
  })
}

async function startJob(job) {
  job.status = 'queued'
  job.startedAt = Date.now()
  await new Promise((resolve) => setTimeout(resolve, STARTUP_MS))
  if (job.status === 'cancelled') return

  job.status = 'upscaling'
  try {
    if (FAIL_UPSCALE) throw new Error('mock: upscale failed')
    await runUpscale(job)
    if (job.status === 'cancelled') return

    const stats = await fsp.stat(job.resultPath)
    // Settle: the reservation becomes the charge, recomputed from the probe.
    job.creditsCharged = priceFor(job.source, job.targetWidth, job.targetHeight, job.model)
    job.status = 'ready'
    job.progress = 100
    job.result = {
      width: job.targetWidth,
      height: job.targetHeight,
      fileSizeBytes: stats.size,
      codec: 'hevc',
      creditsCharged: job.creditsCharged,
    }
    job.downloadUrl = presignedUrl(job.request, 'downloads', job.jobId)
    log(
      `job ${job.jobId} ready (${job.result.width}x${job.result.height}, ${stats.size} bytes, ${job.creditsCharged} credits)`,
    )
  } catch (error) {
    job.status = 'failed'
    job.error = { code: 'upscale_failed', message: String(error.message ?? error) }
    releaseReservation(job)
    log(`job ${job.jobId} failed: ${job.error.message}`)
  }
  job.finishedAt = Date.now()
}

function releaseReservation(job) {
  if (!job.released && job.creditsReserved) {
    balance += job.creditsReserved
    job.released = true
    log(`released ${job.creditsReserved} credits (balance ${balance})`)
  }
}

async function removeJobFiles(job) {
  await fsp.rm(path.dirname(job.uploadPath), { recursive: true, force: true }).catch(() => undefined)
}

// --- Request handling --------------------------------------------------------

async function readJson(req, limit = 64 * 1024) {
  let body = ''
  for await (const chunk of req) {
    body += chunk.toString()
    if (body.length > limit) throw new Error('request too large')
  }
  return body ? JSON.parse(body) : {}
}

function authorized(req) {
  return (req.headers.authorization ?? '') === `Bearer ${TOKEN}`
}

function jobView(job) {
  const elapsed = Date.now() - (job.startedAt ?? Date.now())
  const etaSeconds =
    job.status === 'upscaling' && job.progress > 0
      ? Math.max(0, Math.round(((elapsed / job.progress) * (100 - job.progress)) / 1000))
      : null
  return {
    jobId: job.jobId,
    status: job.status,
    progress: Math.round((job.progress ?? 0) * 10) / 10,
    etaSeconds,
    downloadUrl: job.status === 'ready' ? job.downloadUrl : null,
    creditsReserved: job.creditsReserved,
    creditsCharged: job.creditsCharged,
    source: job.source
      ? {
          width: job.source.width,
          height: job.source.height,
          fps: job.source.fps,
          durationSec: job.source.durationSec,
        }
      : null,
    result: job.result ?? null,
    ...(job.error ? { error: job.error } : {}),
  }
}

async function handleUpload(req, res, jobId, query) {
  const job = jobs.get(jobId)
  if (!job) return fail(res, 404, 'not_found', 'No such job')
  const signatureError = checkSignature(query, jobId)
  if (signatureError) return fail(res, 403, signatureError, 'Upload URL is not valid any more')
  if (job.status !== 'awaiting_upload') return fail(res, 409, 'wrong_state', `Job is ${job.status}`)

  const limit = CAPABILITIES.limits.maxFileSizeBytes
  const declared = Number(req.headers['content-length'] ?? 0)
  if (declared > limit) return fail(res, 413, 'too_large', 'File exceeds the upload limit')

  await fsp.mkdir(path.dirname(job.uploadPath), { recursive: true })
  const out = fs.createWriteStream(job.uploadPath)
  let received = 0
  let aborted = false

  req.on('data', (chunk) => {
    received += chunk.length
    if (received > limit) {
      aborted = true
      out.destroy()
      req.destroy()
      fail(res, 413, 'too_large', 'File exceeds the upload limit')
    }
  })

  await new Promise((resolve) => {
    req.pipe(out)
    out.on('close', resolve)
    out.on('error', resolve)
    req.on('error', resolve)
  })
  if (aborted) return

  // Probe the upload: the price and the plan come from the file, never the client.
  try {
    job.source = await probe(job.uploadPath)
  } catch (error) {
    job.status = 'failed'
    job.error = { code: 'invalid_video', message: String(error.message ?? error) }
    releaseReservation(job)
    return fail(res, 422, 'invalid_video', job.error.message)
  }

  const model = CAPABILITIES.models.find((entry) => entry.id === job.model) ?? CAPABILITIES.models[0]
  job.plan = planUpscale(job.source.width, job.source.height, job.targetWidth, job.targetHeight, model.scales)
  job.creditsReserved = priceFor(job.source, job.targetWidth, job.targetHeight, job.model)
  if (job.creditsReserved > job.creditsReservedAtCreate) {
    const extra = job.creditsReserved - job.creditsReservedAtCreate
    if (balance < extra) {
      job.status = 'failed'
      job.error = { code: 'insufficient_credits', message: 'The uploaded file costs more than was reserved.' }
      releaseReservation(job)
      return fail(res, 402, 'insufficient_credits', job.error.message)
    }
    balance -= extra
  }
  log(
    `upload complete for ${jobId}: ${job.source.width}x${job.source.height} ${job.source.fps}fps ${job.source.durationSec.toFixed(2)}s -> ${job.targetWidth}x${job.targetHeight} (${job.plan.modelScale}x model, ${job.creditsReserved} credits)`,
  )

  res.writeHead(204)
  res.end()
  void startJob(job)
}

async function handleDownload(req, res, jobId, query) {
  const job = jobs.get(jobId)
  if (!job) return fail(res, 404, 'not_found', 'No such job')
  const signatureError = checkSignature(query, jobId)
  if (signatureError) return fail(res, 403, signatureError, 'Download URL is not valid any more')
  if (job.status !== 'ready' || !job.result) return fail(res, 409, 'not_ready', `Job is ${job.status}`)

  const exists = await fsp
    .stat(job.resultPath)
    .then(() => true)
    .catch(() => false)
  if (!exists) {
    // Retention: the result is gone once it has been downloaded (or after 24h).
    return fail(res, 410, 'gone', 'This result has already been downloaded or expired')
  }

  const stats = await fsp.stat(job.resultPath)
  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Content-Length': stats.size,
    'Content-Disposition': `attachment; filename="${jobId}.mp4"`,
  })
  const stream = fs.createReadStream(job.resultPath)
  stream.pipe(res)
  // Retention: the result goes away once it has been downloaded.
  stream.on('close', () => {
    job.downloadedAt = Date.now()
    log(`job ${jobId} downloaded; deleting its files`)
    void removeJobFiles(job)
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
  const query = url.searchParams
  const parts = url.pathname.split('/').filter(Boolean)
  log(`${req.method} ${url.pathname}`)

  try {
    // Everything except the presigned upload/download URLs needs the bearer
    // token; those two are authenticated by their signature instead.
    const presigned = parts[0] === 'v1' && (parts[1] === 'uploads' || parts[1] === 'downloads')
    if (!presigned && !authorized(req)) {
      return fail(res, 401, 'unauthorized', 'Missing or bad bearer token')
    }

    if (req.method === 'GET' && url.pathname === '/v1/capabilities') {
      return json(res, 200, { ...CAPABILITIES, credits: balance })
    }

    if (req.method === 'POST' && url.pathname === '/v1/jobs') {
      if (!authorized(req)) return fail(res, 401, 'unauthorized', 'Missing or bad bearer token')
      const body = await readJson(req)
      const { targetWidth, targetHeight, sourceWidth, sourceHeight, fps, durationSec, fileSizeBytes, model } = body
      if (!Number.isFinite(targetWidth) || !Number.isFinite(targetHeight) || targetWidth < 16 || targetHeight < 16) {
        return fail(res, 422, 'invalid_request', 'targetWidth and targetHeight are required')
      }
      if (targetWidth % 2 || targetHeight % 2) {
        return fail(res, 422, 'invalid_request', 'Target dimensions must be even')
      }
      if (Number(fileSizeBytes) > CAPABILITIES.limits.maxFileSizeBytes) {
        return fail(res, 413, 'too_large', 'File exceeds the upload limit')
      }
      const targetMegapixels = (targetWidth * targetHeight) / 1_000_000
      if (targetMegapixels > CAPABILITIES.limits.maxOutputMegapixels) {
        return fail(res, 422, 'invalid_request', 'Target exceeds the maximum output size', {
          maxOutputMegapixels: CAPABILITIES.limits.maxOutputMegapixels,
        })
      }
      if (Number(durationSec) > CAPABILITIES.limits.maxDurationSec) {
        return fail(res, 422, 'invalid_request', 'Source exceeds the maximum duration', {
          maxDurationSec: CAPABILITIES.limits.maxDurationSec,
        })
      }
      const chosen = CAPABILITIES.models.find((entry) => entry.id === model) ?? CAPABILITIES.models[0]
      // Advisory estimate only; settled from the probe after the upload.
      const estimate = Math.max(
        1,
        Math.ceil(
          ((targetWidth * targetHeight) / 1_000_000) *
            Math.max(1, Math.round((Number(durationSec) || 0) * (Number(fps) || 30))) *
            CAPABILITIES.pricing.creditsPerOutputMegapixelFrame,
        ),
      )
      if (balance < estimate) {
        log(`refusing job: needs ${estimate}, balance ${balance}`)
        return fail(res, 402, 'insufficient_credits', 'Not enough credits for this upscale.', {
          required: estimate,
          available: balance,
        })
      }

      const jobId = `job_${crypto.randomBytes(4).toString('hex')}`
      const dir = path.join(WORK_DIR, jobId)
      const job = {
        jobId,
        request: req,
        status: 'awaiting_upload',
        progress: 0,
        model: chosen.id,
        targetWidth,
        targetHeight,
        source: null,
        plan: null,
        creditsReserved: estimate,
        creditsReservedAtCreate: estimate,
        uploadPath: path.join(dir, 'source.mp4'),
        resultPath: path.join(dir, 'result.mp4'),
        createdAt: Date.now(),
        sourceHint: { sourceWidth, sourceHeight, fps, durationSec },
      }
      jobs.set(jobId, job)
      balance -= estimate
      log(`created ${jobId}: reserved ${estimate} credits (balance ${balance})`)
      return json(res, 201, {
        jobId,
        status: job.status,
        uploadUrl: presignedUrl(req, 'uploads', jobId),
        uploadExpiresAt: new Date(Date.now() + UPLOAD_TTL_MS).toISOString(),
        creditsReserved: estimate,
        plan: { model: chosen.id, modelScales: chosen.scales },
      })
    }

    if (parts[0] === 'v1' && parts[1] === 'uploads' && parts[2] && (req.method === 'PUT' || req.method === 'POST')) {
      return await handleUpload(req, res, parts[2], query)
    }

    if (parts[0] === 'v1' && parts[1] === 'downloads' && parts[2] && req.method === 'GET') {
      return await handleDownload(req, res, parts[2], query)
    }

    if (parts[0] === 'v1' && parts[1] === 'jobs' && parts[2]) {
      const job = jobs.get(parts[2])
      if (req.method === 'GET') {
        if (!job) return fail(res, 404, 'not_found', 'No such job')
        return json(res, 200, jobView(job))
      }
      if (req.method === 'DELETE') {
        if (!job) return fail(res, 404, 'not_found', 'No such job')
        job.status = 'cancelled'
        job.cancelledAt = Date.now()
        releaseReservation(job)
        await removeJobFiles(job)
        log(`cancelled ${job.jobId}`)
        return json(res, 200, { jobId: job.jobId, status: 'cancelled' })
      }
    }

    if (req.method === 'GET' && url.pathname === '/v1/credits') {
      return json(res, 200, { credits: balance })
    }

    return fail(res, 404, 'not_found', `${req.method} ${url.pathname} is not part of this API`)
  } catch (error) {
    log(`error: ${error?.stack ?? error}`)
    return fail(res, 500, 'internal', String(error?.message ?? error))
  }
})

// Retention sweep: nothing lives longer than RETAIN_MS.
setInterval(
  () => {
    const now = Date.now()
    for (const job of jobs.values()) {
      if (now - job.createdAt > RETAIN_MS && job.status !== 'upscaling') {
        releaseReservation(job)
        void removeJobFiles(job)
        jobs.delete(job.jobId)
        log(`expired ${job.jobId}`)
      }
    }
  },
  10 * 60 * 1000,
).unref()

await fsp.mkdir(WORK_DIR, { recursive: true })
server.listen(PORT, '127.0.0.1', () => {
  log(`listening on http://127.0.0.1:${PORT}`)
  log(`bearer token: ${TOKEN}   credits: ${balance}`)
  log(`ffmpeg (probe + stand-in upscale): ${FFMPEG}`)
  if (FAIL_UPSCALE) log('MOCK_FAIL_UPSCALE is set: every upscale will fail')
})

export { server, jobs }
