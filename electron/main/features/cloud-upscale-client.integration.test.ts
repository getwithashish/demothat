// Integration test: the real cloud client against the real mock server.
//
// The server is spawned as a child process on a per-run port and driven over
// HTTP exactly as the app drives it, so the upload/poll/download paths are
// exercised for real rather than mocked.
//
// The test's working files and the server's are removed at the end.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  cancelJob,
  createJob,
  downloadResult,
  estimateCredits,
  fetchCapabilities,
  nextPollDelay,
  pollJob,
  uploadIntermediate,
} from './cloud-upscale-client'

const REPO_ROOT = path.resolve(__dirname, '../../..')
const FFMPEG = path.join(REPO_ROOT, 'binaries', 'linux', 'ffmpeg')
const SERVER = path.join(REPO_ROOT, 'scripts', 'mock-upscale-server.mjs')
const TOKEN = 'test-token'
const SETTINGS = { baseUrl: '', token: TOKEN }
let BASE_URL = ''

/** Asks the OS for a free port, so a lingering test server cannot collide. */
async function freePort(): Promise<number> {
  const net = await import('node:net')
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.unref()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

let server: ChildProcess
let serverStderr = ''
let workDir: string
let sourcePath: string

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForServer(timeoutMs = 20000): Promise<void> {
  const startedAt = Date.now()
  for (;;) {
    try {
      // The endpoint needs the bearer token, so send it; any answer at all means
      // the process is listening.
      const response = await fetch(`${BASE_URL}/v1/capabilities`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
      if (response.ok) return
    } catch {
      // Not listening yet.
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`mock server did not start on ${BASE_URL}\n${serverStderr}`)
    }
    await sleep(200)
  }
}

/** ffmpeg -i stderr parsing: this repo has no ffprobe binary. */
function probe(file: string): { width: number; height: number; codec: string; hasAudio: boolean } {
  const output = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr ?? ''
  const video = /Stream #\d+:\d+.*?: Video:.*?(\d{2,5})x(\d{2,5})[ ,]/.exec(output)
  const codec = /Video:\s*([a-z0-9_]+)/.exec(output)
  return {
    width: video ? Number(video[1]) : 0,
    height: video ? Number(video[2]) : 0,
    codec: codec ? codec[1] : '?',
    hasAudio: /Stream #\d+:\d+.*?: Audio:/.test(output),
  }
}

describe('cloud upscale client against the mock server', () => {
  beforeAll(async () => {
    const port = await freePort()
    BASE_URL = `http://127.0.0.1:${port}`
    SETTINGS.baseUrl = BASE_URL

    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cloud-client-test-'))
    sourcePath = path.join(workDir, 'intermediate.mp4')
    spawnSync(
      FFMPEG,
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=320x180:rate=30:duration=1',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        sourcePath,
      ],
      { stdio: 'ignore' },
    )

    // stdout is dropped and stderr drained: an unread pipe would block a server
    // that logs every request.
    server = spawn('node', [SERVER], {
      env: {
        ...process.env,
        MOCK_PORT: String(port),
        MOCK_TOKEN: TOKEN,
        MOCK_CREDITS: '200',
        MOCK_STARTUP_MS: '200',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    server.stderr?.on('data', (chunk) => {
      serverStderr += chunk.toString()
    })
    await waitForServer()
  }, 60_000)

  afterAll(async () => {
    server?.kill()
    await sleep(200)
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  })

  it('reads capabilities and the credit balance', async () => {
    const capabilities = await fetchCapabilities(SETTINGS)
    expect(capabilities.apiVersion).toBe('1')
    expect(capabilities.models.map((model) => model.id)).toContain('realesr-animevideov3')
    expect(capabilities.models.find((model) => model.id === 'realesr-animevideov3')?.scales).toEqual([2, 3, 4])
    expect(capabilities.credits).toBe(200)
    expect(capabilities.startupSeconds).toBeGreaterThan(0)
  })

  it('prices a job from the target size and frame count', () => {
    const capabilities = { pricing: { creditsPerOutputMegapixelFrame: 0.0004 } }
    // 3840x2160 = 8.29MP, 30 frames: 8.29 * 30 * 0.0004 = 0.0995 -> 1 credit.
    expect(estimateCredits(capabilities, 3840, 2160, 30)).toBe(1)
    // 7680x4320 = 33.18MP, 30 frames: 0.398 -> 1 credit (rounded up from below 1).
    expect(estimateCredits(capabilities, 7680, 4320, 30)).toBe(1)
    // Ten seconds of 8K at 30fps is 300 frames: 3.98 -> 4 credits.
    expect(estimateCredits(capabilities, 7680, 4320, 300)).toBe(4)
    expect(estimateCredits(capabilities, 0, 0, 30)).toBe(0)
    expect(estimateCredits({ pricing: { creditsPerOutputMegapixelFrame: 0 } }, 7680, 4320, 300)).toBe(0)
  })

  it('eases the poll interval off and caps it', () => {
    expect(nextPollDelay(700)).toBe(1050)
    expect(nextPollDelay(4000)).toBe(5000)
    expect(nextPollDelay(5000)).toBe(5000)
  })

  it('uploads, polls, downloads and lands on the exact target size', async () => {
    const stat = await fsp.stat(sourcePath)
    const job = await createJob(SETTINGS, {
      sourceWidth: 320,
      sourceHeight: 180,
      fps: 30,
      durationSec: 1,
      fileSizeBytes: stat.size,
      targetWidth: 1280,
      targetHeight: 720,
      model: 'realesr-animevideov3',
    })
    expect(job.jobId).toBeTruthy()
    expect(job.uploadUrl).toContain('/v1/uploads/')
    expect(job.creditsReserved).toBeGreaterThan(0)

    const uploadProgress: number[] = []
    await uploadIntermediate(job, sourcePath, (percent) => uploadProgress.push(percent))
    expect(uploadProgress.length).toBeGreaterThan(0)
    expect(uploadProgress[uploadProgress.length - 1]).toBeCloseTo(100, 5)

    const statuses: string[] = []
    const view = await pollJob(SETTINGS, job.jobId, {
      initialDelayMs: 100,
      onProgress: (polled) => statuses.push(polled.status),
    })
    expect(view.status).toBe('ready')
    expect(view.downloadUrl).toBeTruthy()
    expect(statuses.length).toBeGreaterThan(0)

    const outputPath = path.join(workDir, 'result.mp4')
    const downloaded: number[] = []
    const bytes = await downloadResult(view.downloadUrl!, outputPath, (percent) => downloaded.push(percent))
    expect(bytes).toBeGreaterThan(0)
    expect(downloaded[downloaded.length - 1]).toBeCloseTo(100, 5)
    expect(fs.existsSync(`${outputPath}.part`)).toBe(false)

    const probed = probe(outputPath)
    expect([probed.width, probed.height]).toEqual([1280, 720])
    expect(probed.codec).toBe('hevc')
    expect(probed.hasAudio).toBe(true)
  }, 120_000)

  it('cancels a job, and a pre-cancelled token stops before any request', async () => {
    const stat = await fsp.stat(sourcePath)
    const job = await createJob(SETTINGS, {
      sourceWidth: 320,
      sourceHeight: 180,
      fps: 30,
      durationSec: 1,
      fileSizeBytes: stat.size,
      targetWidth: 2560,
      targetHeight: 1440,
      model: 'realesr-animevideov3',
    })

    await cancelJob(SETTINGS, job.jobId)
    const view = await pollJob(SETTINGS, job.jobId, { initialDelayMs: 100 })
    expect(view.status).toBe('cancelled')

    // A caller that is already cancelled never reaches the network.
    await expect(pollJob(SETTINGS, job.jobId, { cancel: { cancelled: true } })).rejects.toMatchObject({
      code: 'cancelled',
    })
  }, 60_000)

  it('surfaces an insufficient-credits refusal as a CloudError', async () => {
    const stat = await fsp.stat(sourcePath)
    // An hour of 8K stays inside the advertised limits but costs far more than
    // the 200-credit balance, so the server refuses before anything is rendered.
    await expect(
      createJob(SETTINGS, {
        sourceWidth: 320,
        sourceHeight: 180,
        fps: 30,
        durationSec: 3600,
        fileSizeBytes: stat.size,
        targetWidth: 7680,
        targetHeight: 4320,
        model: 'realesr-animevideov3',
      }),
    ).rejects.toMatchObject({ code: 'insufficient_credits', status: 402 })
  }, 60_000)

  it('refuses a target beyond the advertised output limit', async () => {
    const stat = await fsp.stat(sourcePath)
    await expect(
      createJob(SETTINGS, {
        sourceWidth: 320,
        sourceHeight: 180,
        fps: 30,
        durationSec: 1,
        fileSizeBytes: stat.size,
        targetWidth: 20000,
        targetHeight: 20000,
        model: 'realesr-animevideov3',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request', status: 422 })
  }, 60_000)

  it('rejects a bad bearer token', async () => {
    await expect(fetchCapabilities({ baseUrl: BASE_URL, token: 'wrong' })).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    })
    await expect(
      createJob(
        { baseUrl: BASE_URL, token: 'wrong' },
        {
          sourceWidth: 320,
          sourceHeight: 180,
          fps: 30,
          durationSec: 1,
          fileSizeBytes: 1,
          targetWidth: 640,
          targetHeight: 360,
          model: 'realesr-animevideov3',
        },
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  }, 60_000)
})
