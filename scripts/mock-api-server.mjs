#!/usr/bin/env node
// Mock demothat-api for developing and testing the app without a backend.
//
// It implements the endpoints the desktop app uses, with the same shapes and
// error codes as `contract/openapi.yaml` (2.0.0):
//
//   GET    /v1/capabilities              pricing table, targets, limits
//   POST   /v1/checkout                  first purchase or top-up
//   GET    /v1/purchases/:id             poll (X-Poll-Token), key returned once
//   POST   /v1/license/activate          mint an EdDSA license token
//   GET    /v1/license                   plan, balance, devices
//   DELETE /v1/devices/:id               deactivate a device
//   POST   /v1/jobs                      credit preflight + upload plan (402)
//   PUT    /upload/:jobId/:part          presigned part upload
//   POST   /v1/jobs/:id/upload/complete
//   POST   /v1/jobs/:id/start
//   GET    /v1/jobs/:id                  status, progress, charge/refund
//   DELETE /v1/jobs/:id                  cancel, applying the settlement rules
//   GET    /download/:jobId              the "upscaled" result
//   GET    /dev/public-key               the EdDSA public key it signs with
//
// The upscale itself is a stand-in (a short simulated GPU stage); everything
// around it — reservation, settlement, cancel, exactly-once charging — follows
// Section 0.3 of docs/SHARED_SPEC.md.
//
//   node scripts/mock-api-server.mjs
//
// env: MOCK_PORT (8788), MOCK_SCENARIO (first-purchase | topup | payment-failure),
//      MOCK_CREDITS (1800), MOCK_CREDITS_PER_FRAME, MOCK_MIN_CHARGE (10),
//      MOCK_FAIL (none | infra | input), MOCK_UPSCALE_MS (4000),
//      MOCK_MULTIPART_THRESHOLD (5242880), MOCK_PART_SIZE (5242880),
//      MOCK_CANCEL_AFTER_MS (1200)

import http from 'node:http'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const DEFAULTS = {
  port: Number(process.env.MOCK_PORT ?? 8788),
  scenario: process.env.MOCK_SCENARIO ?? 'topup',
  credits: Number(process.env.MOCK_CREDITS ?? 1800),
  creditsPerFrame: process.env.MOCK_CREDITS_PER_FRAME
    ? JSON.parse(process.env.MOCK_CREDITS_PER_FRAME)
    : { '1080p': 0.01, '4k': 0.05, '8k': 0.11 },
  minChargeCredits: Number(process.env.MOCK_MIN_CHARGE ?? 10),
  fail: process.env.MOCK_FAIL ?? 'none',
  upscaleMs: Number(process.env.MOCK_UPSCALE_MS ?? 4000),
  /** Transcription: credits per minute of audio, and how long a job takes. */
  transcribeCreditsPerMinute: Number(process.env.MOCK_TRANSCRIBE_CREDITS_PER_MINUTE ?? 1800),
  maxAudioSeconds: Number(process.env.MOCK_MAX_AUDIO_SECONDS ?? 900),
  transcribeMs: Number(process.env.MOCK_TRANSCRIBE_MS ?? 2000),
  multipartThresholdBytes: Number(process.env.MOCK_MULTIPART_THRESHOLD ?? 5 * 1024 * 1024),
  partSize: Number(process.env.MOCK_PART_SIZE ?? 5 * 1024 * 1024),
  /** When set, a purchase stays pending for this long instead of N polls. */
  pendingMs: Number(process.env.MOCK_PENDING_MS ?? 0),
}

const PRODUCTS = {
  pdt_pro_1800: { credits: 1800, firstPurchase: true },
  pdt_topup_5400: { credits: 5400 },
  pdt_topup_9000: { credits: 9000 },
}

const DEVICE_LIMIT = 10
const json = (res, status, body) => {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}
const fail = (res, status, code, message, details) =>
  json(res, status, { error: { code, message, ...(details ? { details } : {}) } })

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString()
      try {
        resolve(text ? JSON.parse(text) : {})
      } catch {
        resolve({})
      }
    })
  })
}

const base64url = (input) => Buffer.from(input).toString('base64url')

/** A minimal EdDSA JWS, so the app can verify a token it is handed. */
function signLicenseToken(privateKey, claims) {
  const header = base64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }))
  const payload = base64url(JSON.stringify(claims))
  const signingInput = `${header}.${payload}`
  const signature = crypto.sign(null, Buffer.from(signingInput), privateKey)
  return `${signingInput}.${signature.toString('base64url')}`
}

/**
 * Starts the mock API. Returns its base URL, the state it keeps (useful in
 * tests) and a close function.
 */
export async function createMockApiServer(options = {}) {
  const config = { ...DEFAULTS, ...options }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

  const state = {
    credits: config.credits,
    devices: [],
    purchases: new Map(),
    jobs: new Map(),
    checkoutCalls: 0,
  }

  const deviceView = (device, currentHash) => ({
    id: device.id,
    label: device.label,
    platform: device.platform,
    active: device.active,
    activatedAt: new Date(device.activatedAt).toISOString(),
    lastSeenAt: new Date(device.lastSeenAt).toISOString(),
    current: device.deviceIdHash === currentHash,
  })

  const licenseView = (currentHash) => ({
    plan: 'pro',
    balance: Math.max(0, Math.round(state.credits)),
    devices: state.devices.map((device) => deviceView(device, currentHash)),
  })

  const tokenFor = (device) =>
    signLicenseToken(privateKey, {
      sub: 'lic_mock',
      plan: 'pro',
      balance: Math.max(0, Math.round(state.credits)),
      exp: Math.floor(Date.now() / 1000) + 3600,
      deviceIdHash: device.deviceIdHash,
    })

  const creditsPerFrameFor = (targetHeight) => {
    const key = { 720: '720p', 1080: '1080p', 1440: '2k', 2160: '4k', 4320: '8k' }[targetHeight]
    return config.creditsPerFrame[key] ?? null
  }

  /** Settles a job exactly once, applying Section 0.3. */
  const settle = (job, outcome) => {
    if (job.finalizedAt) return job
    let charge = 0
    if (outcome === 'succeeded') charge = job.cost
    else if (outcome === 'canceled')
      charge = job.reachedRunning ? Math.min(job.cost, Math.max(config.minChargeCredits, job.consumed)) : 0
    else if (outcome === 'input') charge = Math.min(job.cost, Math.max(config.minChargeCredits, job.consumed))
    // 'infra' is fully refunded.
    job.charge = charge
    job.refund = Math.max(0, job.reserved - charge)
    job.finalizedAt = Date.now()
    state.credits += job.refund
    job.status = outcome === 'succeeded' ? 'succeeded' : outcome === 'canceled' ? 'canceled' : 'failed'
    job.errorClass = outcome === 'succeeded' || outcome === 'canceled' ? undefined : outcome
    return job
  }

  const jobView = (job) => ({
    status: job.status,
    stage: job.stage,
    kind: job.kind ?? 'upscale',
    progress:
      job.kind === 'transcribe'
        ? job.audioSeconds > 0
          ? Math.min(100, Math.round((job.audioSecondsDone / job.audioSeconds) * 100))
          : 0
        : job.totalFrames > 0
          ? Math.min(100, Math.round((job.framesDone / job.totalFrames) * 100))
          : 0,
    framesDone: job.framesDone,
    totalFrames: job.totalFrames,
    ...(job.kind === 'transcribe'
      ? { audioSeconds: job.audioSeconds, audioSecondsDone: job.audioSecondsDone }
      : {}),
    reserved: job.reserved,
    consumed: job.consumed,
    etaSeconds: job.etaSeconds ?? null,
    cost: job.cost,
    ...(job.charge !== undefined ? { charge: job.charge, refund: job.refund } : {}),
    ...(job.status === 'succeeded' ? { downloadUrl: `${baseUrl()}/download/${job.id}` } : {}),
    ...(job.errorClass
      ? { error: { code: job.errorClass === 'infra' ? 'worker_crashed' : 'unsupported_input', class: job.errorClass } }
      : {}),
  })

  /** Advances a job's simulated GPU stage; called from the poll handler. */
  const advance = (job) => {
    const now = Date.now()
    if (job.status === 'validating' && now - job.startedAt > 300) {
      job.status = 'queued'
      job.stage = 'queued'
    }
    if (job.status === 'queued' && now - job.startedAt > 600) {
      job.status = 'running'
      job.reachedRunning = true
      job.stage = job.kind === 'transcribe' ? 'transcribing' : 'upscaling'
      job.runningAt = now
    }
    if (job.status === 'running' || job.status === 'canceling') {
      const elapsed = now - job.runningAt
      if (job.kind === 'transcribe') {
        // A transcription advances seconds of audio, not frames, and is billed per
        // minute: the mock keeps the same two counters the real API does.
        const done = Math.min(job.audioSeconds, (elapsed / config.transcribeMs) * job.audioSeconds)
        if (done > job.audioSecondsDone) {
          job.audioSecondsDone = done
          job.consumed = Math.ceil((done / 60) * job.rate)
        }
        job.etaSeconds = Math.max(
          0,
          Math.round(((job.audioSeconds - job.audioSecondsDone) / job.audioSeconds) * (config.transcribeMs / 1000)),
        )
      } else {
        const done = Math.min(job.totalFrames, Math.round((elapsed / config.upscaleMs) * job.totalFrames))
        if (done > job.framesDone) {
          job.framesDone = done
          job.consumed = Math.ceil(done * job.rate)
        }
        job.etaSeconds = Math.max(
          0,
          Math.round(((job.totalFrames - job.framesDone) / job.totalFrames) * (config.upscaleMs / 1000)),
        )
      }
    }
    if (job.status === 'canceling' && now - job.cancelAt > 300) {
      settle(job, job.framesDone > 0 ? 'canceled' : 'canceled')
      return
    }
    if (
      job.status === 'running' &&
      now - job.runningAt >= (job.kind === 'transcribe' ? config.transcribeMs : config.upscaleMs)
    ) {
      if (config.fail === 'infra') settle(job, 'infra')
      else if (config.fail === 'input') settle(job, 'input')
      else settle(job, 'succeeded')
      job.stage = job.status === 'succeeded' ? 'done' : 'failed'
    }
  }

  let baseUrl = () => `http://127.0.0.1:${server.address()?.port ?? config.port}`

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const parts = url.pathname.split('/').filter(Boolean)
    const auth = req.headers.authorization ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
    const currentHash = token ? decodeHashFromToken(token) : null

    try {
      // --- meta ---
      if (req.method === 'GET' && url.pathname === '/v1/capabilities') {
        return json(res, 200, {
          creditsPerFrame: config.creditsPerFrame,
          targets: Object.keys(config.creditsPerFrame),
          limits: {
            maxDurationSeconds: 3600,
            maxTargetWidth: 7680,
            maxTargetHeight: 4320,
            maxFileSizeBytes: 2_000_000_000,
            maxConcurrentJobs: 1,
            dailyJobCap: 50,
          },
          models: ['realesr-animevideov3', 'realesrgan-plus'],
          minChargeCredits: config.minChargeCredits,
          cloudEnabled: true,
          multipartThresholdBytes: config.multipartThresholdBytes,
          transcription: {
            enabled: true,
            creditsPerMinute: config.transcribeCreditsPerMinute,
            models: ['large-v3'],
            maxAudioSeconds: config.maxAudioSeconds,
          },
        })
      }
      if (req.method === 'GET' && url.pathname === '/dev/public-key') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        return res.end(publicPem)
      }

      if (req.method === 'GET' && url.pathname === '/v1/products') {
        // The catalogue the app renders its Buy credits dialog from; the product
        // ids are the same ones POST /v1/checkout accepts.
        const price = (amountMinor) => ({ amountMinor, currency: 'USD', minorUnitExponent: 2, isMinimum: false })
        return json(res, 200, {
          products: [
            {
              productId: 'pdt_pro_1800',
              kind: 'first_purchase',
              credits: PRODUCTS.pdt_pro_1800.credits,
              name: 'Pro',
              description: 'Pro plus 1,800 credits',
              price: price(300),
            },
            {
              productId: 'pdt_topup_5400',
              kind: 'topup',
              credits: PRODUCTS.pdt_topup_5400.credits,
              name: 'Top-up',
              price: price(900),
            },
            {
              productId: 'pdt_topup_9000',
              kind: 'topup',
              credits: PRODUCTS.pdt_topup_9000.credits,
              name: 'Top-up',
              price: price(1500),
            },
          ],
        })
      }

      // --- billing ---
      if (req.method === 'POST' && url.pathname === '/v1/checkout') {
        const body = await readBody(req)
        const product = PRODUCTS[body.productId]
        if (!product) return fail(res, 400, 'validation_error', 'Unknown product id')
        state.checkoutCalls += 1
        const id = `pur_${state.checkoutCalls}`
        const pollToken = `poll_${state.checkoutCalls}`
        state.purchases.set(id, {
          id,
          pollToken,
          productId: body.productId,
          credit: product.credits,
          firstPurchase: Boolean(product.firstPurchase) && !token,
          // A first purchase needs a couple of polls before the payment clears,
          // or (when `pendingMs` is set) a fixed delay, which is deterministic
          // under load.
          pollsUntilSettled: config.scenario === 'first-purchase' ? 2 : 1,
          polls: 0,
          pendingMs: config.pendingMs,
          createdAt: Date.now(),
          keyDelivered: false,
        })
        return json(res, 200, {
          purchaseId: id,
          pollToken,
          checkoutUrl: `https://checkout.dodopayments.com/session/${id}`,
        })
      }

      if (req.method === 'GET' && parts[0] === 'v1' && parts[1] === 'purchases' && parts[2]) {
        const purchase = state.purchases.get(parts[2])
        if (!purchase) return fail(res, 404, 'not_found', 'No such purchase')
        if (req.headers['x-poll-token'] !== purchase.pollToken) return fail(res, 401, 'unauthorized', 'Bad poll token')
        purchase.polls += 1
        if (config.scenario === 'payment-failure') return json(res, 200, { status: 'failed' })
        const settled =
          purchase.pendingMs > 0
            ? Date.now() - purchase.createdAt >= purchase.pendingMs
            : purchase.polls >= purchase.pollsUntilSettled
        if (!settled) return json(res, 200, { status: 'pending' })

        state.credits += purchase.credit
        if (purchase.firstPurchase && !purchase.keyDelivered) {
          purchase.keyDelivered = true
          return json(res, 200, {
            status: 'succeeded',
            balance: Math.round(state.credits),
            // Returned exactly once, then it is gone (contract).
            licenseKey: 'DODO-TEST-0001-0002',
          })
        }
        return json(res, 200, { status: 'succeeded', balance: Math.round(state.credits) })
      }

      // --- license ---
      if (req.method === 'POST' && url.pathname === '/v1/license/activate') {
        const body = await readBody(req)
        if (typeof body.licenseKey !== 'string' || !body.licenseKey.startsWith('DODO-')) {
          return fail(res, 404, 'not_found', 'This key was not recognised')
        }
        const existing = state.devices.find((device) => device.deviceIdHash === body.deviceIdHash)
        if (!existing && state.devices.filter((device) => device.active).length >= DEVICE_LIMIT) {
          return fail(res, 409, 'device_limit_reached', 'No free device slots', {
            devices: state.devices.map((device) => deviceView(device, body.deviceIdHash)),
          })
        }
        const device =
          existing ??
          state.devices[
            state.devices.push({
              id: `dev_${state.devices.length + 1}`,
              deviceIdHash: body.deviceIdHash,
              label: body.label ?? 'This computer',
              platform: body.platform ?? 'Unknown',
              active: true,
              activatedAt: Date.now(),
              lastSeenAt: Date.now(),
            }) - 1
          ]
        device.lastSeenAt = Date.now()
        device.active = true
        return json(res, 200, {
          token: tokenFor(device),
          balance: Math.round(state.credits),
          devices: state.devices.map((item) => deviceView(item, device.deviceIdHash)),
        })
      }

      if (req.method === 'GET' && url.pathname === '/v1/license') {
        if (!token) return fail(res, 401, 'unauthorized', 'A license token is required')
        return json(res, 200, licenseView(currentHash))
      }

      if (req.method === 'DELETE' && parts[0] === 'v1' && parts[1] === 'devices' && parts[2]) {
        const device = state.devices.find((item) => item.id === parts[2])
        if (!device) return fail(res, 404, 'not_found', 'No such device')
        device.active = false
        return json(res, 200, licenseView(currentHash))
      }

      // --- jobs ---
      if (req.method === 'POST' && url.pathname === '/v1/jobs') {
        if (!token) return fail(res, 401, 'unauthorized', 'A license token is required')
        const body = await readBody(req)
        const rate = creditsPerFrameFor(body.targetHeight)
        if (rate == null) return fail(res, 400, 'validation_error', 'Unsupported target height')
        const totalFrames = Math.max(1, Math.ceil(body.durationSec * body.fps))
        const cost = Math.max(1, Math.ceil(totalFrames * rate))
        if (state.credits < cost) {
          return fail(res, 402, 'insufficient_credits', 'Not enough credits for this job', {
            cost,
            balance: Math.round(state.credits),
          })
        }
        const id = `job_${state.jobs.size + 1}`
        state.credits -= cost
        const multipart = body.fileSizeBytes >= config.multipartThresholdBytes
        const partCount = multipart ? Math.max(1, Math.ceil(body.fileSizeBytes / config.partSize)) : 0
        const job = {
          id,
          status: 'uploading',
          stage: 'uploading',
          totalFrames,
          framesDone: 0,
          rate,
          cost,
          reserved: cost,
          consumed: 0,
          reachedRunning: false,
          upload: multipart ? { parts: new Map(), partCount } : { parts: null, partCount: 0 },
          createdAt: Date.now(),
        }
        state.jobs.set(id, job)
        return json(res, 200, {
          jobId: id,
          estimatedCost: cost,
          upload: multipart
            ? {
                type: 'multipart',
                uploadId: `upload_${id}`,
                partSize: config.partSize,
                partUrls: Array.from({ length: partCount }, (_, index) => `${baseUrl()}/upload/${id}/${index + 1}`),
              }
            : { type: 'single', url: `${baseUrl()}/upload/${id}/1` },
        })
      }

      if (req.method === 'POST' && url.pathname === '/v1/jobs/transcribe') {
        if (!token) return fail(res, 401, 'unauthorized', 'A license token is required')
        const body = await readBody(req)
        if (!(body.audioSeconds > 0)) {
          return fail(res, 400, 'validation_error', 'audioSeconds is required')
        }
        if (body.audioSeconds > config.maxAudioSeconds) {
          return fail(res, 400, 'validation_error', `audioSeconds exceeds ${config.maxAudioSeconds}`)
        }
        const rate = config.transcribeCreditsPerMinute
        const cost = Math.max(1, Math.ceil((body.audioSeconds / 60) * rate))
        if (state.credits < cost) {
          return fail(res, 402, 'insufficient_credits', 'Not enough credits for this job', {
            estimatedCost: cost,
            balance: Math.round(state.credits),
          })
        }
        const id = `job_${state.jobs.size + 1}`
        state.credits -= cost
        const job = {
          id,
          kind: 'transcribe',
          status: 'uploading',
          stage: 'uploading',
          audioSeconds: body.audioSeconds,
          audioSecondsDone: 0,
          totalFrames: 0,
          framesDone: 0,
          rate,
          cost,
          reserved: cost,
          consumed: 0,
          reachedRunning: false,
          upload: { parts: null, partCount: 0 },
          createdAt: Date.now(),
        }
        state.jobs.set(id, job)
        return json(res, 200, {
          jobId: id,
          estimatedCost: cost,
          upload: { type: 'single', url: `${baseUrl()}/upload/${id}/1` },
        })
      }

      if (req.method === 'PUT' && parts[0] === 'upload' && parts[1]) {
        const job = state.jobs.get(parts[1])
        if (!job) return fail(res, 404, 'not_found', 'No such job')
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const body = Buffer.concat(chunks)
        const etag = crypto.createHash('md5').update(body).digest('hex')
        if (job.upload.parts) job.upload.parts.set(Number(parts[2]), etag)
        res.writeHead(200, { ETag: `"${etag}"`, 'Content-Length': '0' })
        return res.end()
      }

      if (
        req.method === 'POST' &&
        parts[0] === 'v1' &&
        parts[1] === 'jobs' &&
        parts[3] === 'upload' &&
        parts[4] === 'complete'
      ) {
        const job = state.jobs.get(parts[2])
        if (!job) return fail(res, 404, 'not_found', 'No such job')
        const body = await readBody(req)
        for (const part of body.parts ?? []) job.upload.parts?.set(part.partNumber, part.etag)
        job.status = 'uploaded'
        job.stage = 'uploaded'
        return json(res, 200, { status: 'uploaded' })
      }

      if (req.method === 'POST' && parts[0] === 'v1' && parts[1] === 'jobs' && parts[3] === 'start') {
        const job = state.jobs.get(parts[2])
        if (!job) return fail(res, 404, 'not_found', 'No such job')
        job.status = 'validating'
        job.stage = 'validating'
        job.startedAt = Date.now()
        return json(res, 200, { status: 'validating' })
      }

      if (parts[0] === 'v1' && parts[1] === 'jobs' && parts[2]) {
        const job = state.jobs.get(parts[2])
        if (!job) return fail(res, 404, 'not_found', 'No such job')
        if (req.method === 'GET') {
          advance(job)
          return json(res, 200, jobView(job))
        }
        if (req.method === 'DELETE') {
          advance(job)
          if (['succeeded', 'failed', 'canceled', 'rejected'].includes(job.status)) {
            // Already terminal: report its real status rather than pretending.
            return json(res, 200, { status: job.status })
          }
          job.status = 'canceling'
          job.stage = 'canceling'
          job.cancelAt = Date.now()
          return json(res, 200, { status: 'canceling' })
        }
      }

      if (req.method === 'GET' && parts[0] === 'download' && parts[1]) {
        const job = state.jobs.get(parts[1])
        if (!job) return fail(res, 404, 'not_found', 'No such job')
        if (job.status !== 'succeeded') return fail(res, 409, 'not_ready', 'Job has not succeeded')
        if (job.kind === 'transcribe') {
          // The transcript document the worker would have uploaded: deterministic
          // segments covering the audio, with word timings.
          const segments = []
          for (let start = 0; start < job.audioSeconds; start += 5) {
            const end = Math.min(job.audioSeconds, start + 5)
            segments.push({
              start,
              end,
              text: `mock segment ${segments.length + 1}`,
              words: [{ start, end, text: 'mock' }],
            })
          }
          const payload = JSON.stringify({
            version: 1,
            language: 'en',
            model: 'large-v3',
            durationSec: job.audioSeconds,
            segments,
          })
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(payload)),
          })
          return res.end(payload)
        }
        // A stand-in for the upscaled file: deterministic bytes per job.
        const body = Buffer.alloc(2048, job.id)
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(body.length) })
        return res.end(body)
      }

      return fail(res, 404, 'not_found', `No route for ${req.method} ${url.pathname}`)
    } catch (error) {
      return fail(res, 500, 'internal_error', String(error?.message ?? error))
    }
  })

  /** The device hash inside a token, without verifying it (mock only). */
  function decodeHashFromToken(jwt) {
    try {
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())
      return payload.deviceIdHash ?? null
    } catch {
      return null
    }
  }

  await new Promise((resolve) => server.listen(config.port, '127.0.0.1', resolve))
  baseUrl = () => `http://127.0.0.1:${server.address().port}`

  return {
    url: baseUrl(),
    state,
    config,
    publicKeyPem: publicPem,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

// Started directly: run until interrupted.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = await createMockApiServer()
  console.log(`mock demothat-api listening on ${server.url}`)
  console.log(`scenario: ${server.config.scenario} · credits: ${server.config.credits} · fail: ${server.config.fail}`)
  console.log('point the app at it with DEMOTHAT_API_BASE_URL and DEMOTHAT_LICENSE_PUBLIC_KEY')
}
