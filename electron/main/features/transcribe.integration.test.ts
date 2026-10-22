// Cloud transcription against the mock API server (scripts/mock-api-server.mjs).
//
// What matters here is the whole path a user pays for: the audio is really extracted
// from a real recording, uploaded, polled to a transcript, and the server's own
// settled numbers come back — priced per minute of the audio it probed, not from
// anything the app declared.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const secrets = vi.hoisted(() => ({ data: new Map<string, string>() }))

vi.mock('../lib/secure-store', () => ({
  readSecret: (_name: string, key: string) => secrets.data.get(key) ?? null,
  writeSecret: (_name: string, key: string, value: string) => {
    secrets.data.set(key, value)
  },
  deleteSecret: (_name: string, key: string) => {
    secrets.data.delete(key)
  },
  clearSecrets: () => {
    secrets.data.clear()
  },
}))

// The orchestrator's upload bookkeeping, in memory for the test.
const persisted = vi.hoisted(() => ({ uploadResume: new Map<string, unknown>() }))

vi.mock('../lib/cloud-store', () => ({
  saveUploadResume: (jobId: string, resume: unknown) => {
    persisted.uploadResume.set(jobId, resume)
  },
  getUploadResume: (jobId: string) => persisted.uploadResume.get(jobId) ?? null,
  clearUploadResume: (jobId: string) => {
    persisted.uploadResume.delete(jobId)
  },
  saveActiveJob: () => undefined,
  getActiveJob: () => null,
  clearActiveJob: () => undefined,
  hasCloudConsent: () => true,
  recordCloudConsent: () => undefined,
}))

import { runTranscription, TRANSCRIBE_WORK_STAGES, type TranscribeStage } from './transcribe'
import { getFFmpegPath } from '../lib/utils'

type MockServer = {
  url: string
  close: () => Promise<void>
  publicKeyPem: string
  state: { credits: number }
}

async function startMock(options: Record<string, unknown> = {}): Promise<MockServer> {
  const module = (await import(new URL('../../../scripts/mock-api-server.mjs', import.meta.url).href)) as unknown as {
    createMockApiServer: (options?: Record<string, unknown>) => Promise<MockServer>
  }
  return module.createMockApiServer({ port: 0, transcribeMs: 400, ...options })
}

// The bundled FFmpeg is gitignored; the suite that needs it skips where it is absent.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
process.env.APP_ROOT = repoRoot
const ffmpegPath = (() => {
  try {
    const candidate = getFFmpegPath()
    return fs.existsSync(candidate) ? candidate : null
  } catch {
    return null
  }
})()

let server: MockServer
let workDir = ''

/** A real three-second recording: video with a tone, like a screen capture. */
async function writeRecording(seconds = 3): Promise<string> {
  workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'transcribe-test-'))
  const source = path.join(workDir, 'recording.mp4')
  execFileSync(ffmpegPath as string, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', String(seconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source,
  ])
  return source
}

/** A recording with no audio at all. */
async function writeSilentRecording(): Promise<string> {
  workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'transcribe-silent-'))
  const source = path.join(workDir, 'video-only.mp4')
  execFileSync(ffmpegPath as string, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=15',
    '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', source,
  ])
  return source
}

async function setupServer(options: Record<string, unknown> = {}): Promise<void> {
  server = await startMock(options)
  process.env.DEMOTHAT_API_BASE_URL = server.url
  process.env.DEMOTHAT_LICENSE_PUBLIC_KEY = server.publicKeyPem
  secrets.data.set('token', 'mock-token')
}

beforeEach(() => {
  persisted.uploadResume.clear()
})

afterEach(async () => {
  delete process.env.DEMOTHAT_API_BASE_URL
  delete process.env.DEMOTHAT_LICENSE_PUBLIC_KEY
  await server?.close()
  if (workDir) await fsp.rm(workDir, { recursive: true, force: true })
  workDir = ''
})

describe.skipIf(ffmpegPath === null)('runTranscription (real ffmpeg + mock API)', () => {
  it('extracts, uploads, transcribes and reports the server-charged credits', async () => {
    await setupServer()
    const source = await writeRecording(3)
    const audioPath = path.join(workDir, 'audio.m4a')
    const transcriptPath = path.join(workDir, 'transcript.json')

    const stages: TranscribeStage[] = []
    const result = await runTranscription({
      sourcePath: source,
      audioPath,
      transcriptPath,
      cancel: { cancelled: false },
      onProgress: (progress) => {
        if (stages[stages.length - 1] !== progress.stage) stages.push(progress.stage)
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // A real transcript with real timings, inside the clip's own length.
    expect(result.transcript.segments.length).toBeGreaterThan(0)
    expect(result.transcript.language).toBe('en')
    expect(result.audioSeconds).toBeGreaterThan(2)
    expect(result.audioSeconds).toBeLessThan(4)
    for (const segment of result.transcript.segments) {
      expect(segment.start).toBeGreaterThanOrEqual(0)
      expect(segment.end).toBeGreaterThan(segment.start)
      expect(segment.end).toBeLessThanOrEqual(result.audioSeconds + 0.5)
    }

    // The transcript is on disk where the caller asked for it.
    const written = JSON.parse(await fsp.readFile(transcriptPath, 'utf8')) as { segments: unknown[] }
    expect(written.segments.length).toBe(result.transcript.segments.length)

    // The charge is the server's: ceil(audioSeconds / 60 * 1800) at the mock's rate.
    expect(result.charge).toBe(Math.ceil((result.audioSeconds / 60) * 1800))
    expect(result.refund).toBe(0)
    expect(server.state.credits).toBe(1800 - result.charge)

    // Every stage the user waits through was reported, in order.
    for (const stage of TRANSCRIBE_WORK_STAGES) {
      expect(stages).toContain(stage)
    }
    expect(stages[stages.length - 1]).toBe('Done')
  }, 60_000)

  it('refuses a recording with no audio before uploading anything', async () => {
    await setupServer()
    const source = await writeSilentRecording()

    const result = await runTranscription({
      sourcePath: source,
      audioPath: path.join(workDir, 'audio.m4a'),
      transcriptPath: path.join(workDir, 'transcript.json'),
      cancel: { cancelled: false },
      onProgress: () => undefined,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('rejected')
    expect(result.error).toMatch(/no audio track/i)
    // Nothing was created, so nothing was reserved.
    expect(server.state.credits).toBe(1800)
  }, 60_000)

  it('refuses before uploading when the balance cannot cover it', async () => {
    await setupServer({ credits: 10 })
    const source = await writeRecording(3)

    const result = await runTranscription({
      sourcePath: source,
      audioPath: path.join(workDir, 'audio.m4a'),
      transcriptPath: path.join(workDir, 'transcript.json'),
      cancel: { cancelled: false },
      onProgress: () => undefined,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('rejected')
    expect(result.error).toMatch(/not enough credits/i)
  }, 60_000)

  it('cancels mid-job and reports the server’s settled numbers', async () => {
    await setupServer({ transcribeMs: 1500 })
    const source = await writeRecording(3)
    const cancel = { cancelled: false }

    const run = runTranscription({
      sourcePath: source,
      audioPath: path.join(workDir, 'audio.m4a'),
      transcriptPath: path.join(workDir, 'transcript.json'),
      cancel,
      onProgress: (progress) => {
        // The job is running: this is the moment a user would press Cancel.
        if (progress.stage === 'Transcribing') cancel.cancelled = true
      },
    })

    const result = await run
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('canceled')
    // The server settled it: the numbers come back rather than being guessed at.
    expect(result.charge).toBeDefined()
    expect(result.refund).toBeDefined()
    // No transcript is written from a job that did not succeed.
    await expect(fsp.readFile(path.join(workDir, 'transcript.json'), 'utf8')).rejects.toThrow()
  }, 60_000)
})
