// Cloud upscaling against the mock API server (scripts/mock-api-server.mjs).
//
// These are the paths that matter for money: the credit preflight, a multipart
// upload that resumes, settlement on success, the settlement rules on cancel
// (nothing before the GPU starts, the work done afterwards) and a full refund on
// an infrastructure failure. Every number asserted here comes from the server.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

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

// The orchestrator's job/upload bookkeeping, in memory for the test.
const persisted = vi.hoisted(() => ({
  uploadResume: new Map<string, unknown>(),
  activeJob: null as unknown,
}))

vi.mock('../lib/cloud-store', () => ({
  saveUploadResume: (jobId: string, resume: unknown) => {
    persisted.uploadResume.set(jobId, resume)
  },
  getUploadResume: (jobId: string) => persisted.uploadResume.get(jobId) ?? null,
  clearUploadResume: (jobId: string) => {
    persisted.uploadResume.delete(jobId)
  },
  saveActiveJob: (record: unknown) => {
    persisted.activeJob = record
  },
  getActiveJob: () => persisted.activeJob,
  clearActiveJob: () => {
    persisted.activeJob = null
  },
  hasCloudConsent: () => true,
  recordCloudConsent: () => undefined,
}))

import {
  cancelJobRemote,
  completeUpload,
  createJob,
  fetchCapabilities,
  pollJob,
  startJob,
  uploadIntermediate,
} from './cloud-client'
import { runCloudExport } from './cloud-export'

type MockServer = {
  url: string
  close: () => Promise<void>
  publicKeyPem: string
  state: { credits: number; jobs: Map<string, { charge?: number; refund?: number; cost: number }> }
}

async function startMock(options: Record<string, unknown> = {}): Promise<MockServer> {
  const module = (await import(new URL('../../../scripts/mock-api-server.mjs', import.meta.url).href)) as unknown as {
    createMockApiServer: (options?: Record<string, unknown>) => Promise<MockServer>
  }
  return module.createMockApiServer({ port: 0, upscaleMs: 600, ...options })
}

let server: MockServer
let workDir = ''
let intermediatePath = ''

async function setupServer(options: Record<string, unknown> = {}): Promise<void> {
  server = await startMock(options)
  process.env.DEMOTHAT_API_BASE_URL = server.url
  process.env.DEMOTHAT_LICENSE_PUBLIC_KEY = server.publicKeyPem
  secrets.data.set('token', 'mock-token')
}

/** A 12 MB intermediate, i.e. three parts at the mock's 5 MB part size. */
async function writeIntermediate(bytes = 12 * 1024 * 1024): Promise<string> {
  workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cloud-test-'))
  intermediatePath = path.join(workDir, 'intermediate.mp4')
  await fsp.writeFile(intermediatePath, Buffer.alloc(bytes, 7))
  return intermediatePath
}

const OUTPUT = (): string => path.join(workDir, 'output.mp4')

beforeEach(() => {
  persisted.uploadResume.clear()
  persisted.activeJob = null
})

afterEach(async () => {
  delete process.env.DEMOTHAT_API_BASE_URL
  delete process.env.DEMOTHAT_LICENSE_PUBLIC_KEY
  await server?.close()
  if (workDir) await fsp.rm(workDir, { recursive: true, force: true })
  workDir = ''
})

/** Creates a job for an 8K clip from the mock's own pricing table. */
async function createJobFor(fileSizeBytes: number, durationSec = 2) {
  const { jobId, estimatedCost, upload } = await createJob({
    sourceWidth: 1920,
    sourceHeight: 1080,
    fps: 30,
    durationSec,
    fileSizeBytes,
    targetWidth: 7680,
    targetHeight: 4320,
  })
  return { jobId, estimatedCost, upload }
}

/** Narrows a multipart upload plan, failing loudly if the mock chose single. */
function partsOf(upload: Awaited<ReturnType<typeof createJobFor>>['upload']) {
  if (upload.type !== 'multipart') throw new Error('expected a multipart upload plan')
  return upload
}

describe('capabilities and cost', () => {
  beforeEach(async () => {
    await setupServer()
  })

  it('publishes the pricing table the cost estimate needs', async () => {
    const capabilities = await fetchCapabilities(true)
    expect(capabilities.creditsPerFrame['8k']).toBeGreaterThan(0)
    expect(capabilities.minChargeCredits).toBe(10)
    expect(capabilities.cloudEnabled).toBe(true)
  })
})

describe('a multipart job, end to end', () => {
  beforeEach(async () => {
    await setupServer({ credits: 2000 })
    await writeIntermediate()
  })

  it('uploads every part, starts the job and downloads the result', async () => {
    const { jobId, estimatedCost, upload } = await createJobFor(12 * 1024 * 1024)
    expect(upload.type).toBe('multipart')
    // 2s at 30fps = 60 frames; the mock prices 8K at 0.11 credits a frame.
    expect(estimatedCost).toBe(7)

    const uploaded = await uploadIntermediate(upload, intermediatePath)
    expect(uploaded.parts.map((part) => part.partNumber)).toEqual([1, 2, 3])
    await completeUpload(jobId, uploaded.parts)
    await startJob(jobId)

    const view = await pollJob(jobId, { onUpdate: () => undefined })
    expect(view.status).toBe('succeeded')
    expect(view.charge).toBe(estimatedCost)
    expect(view.refund).toBe(0)
    expect(view.downloadUrl).toBeTruthy()

    const { downloadResult } = await import('./cloud-client')
    const received = await downloadResult(view.downloadUrl!, OUTPUT())
    expect(received).toBe(2048)
    await expect(fsp.stat(OUTPUT())).resolves.toBeTruthy()
  })

  it('resumes an interrupted upload instead of re-sending finished parts', async () => {
    const { jobId, upload } = await createJobFor(12 * 1024 * 1024)
    const plan = partsOf(upload)

    // Pretend the first two parts already landed on a previous attempt.
    const first = await uploadIntermediate({ ...plan, partUrls: plan.partUrls.slice(0, 2) }, intermediatePath, {
      resume: { uploadId: plan.uploadId, parts: [] },
    })
    expect(first.parts).toHaveLength(2)

    const resumed = await uploadIntermediate(plan, intermediatePath, { resume: first })
    // Only the missing third part is sent, but all three are reported.
    expect(resumed.parts).toHaveLength(3)
    await completeUpload(jobId, resumed.parts)
    await startJob(jobId)
    const view = await pollJob(jobId)
    expect(view.status).toBe('succeeded')
  })
})

describe('settlement', () => {
  beforeEach(async () => {
    await setupServer({ credits: 2000 })
    await writeIntermediate(2048) // one part: keeps the cancel timing tight
  })

  it('charges nothing when cancelled before the GPU starts', async () => {
    // A long clip, so the cost is well above the minimum charge: if anything
    // were charged here, this would see it.
    const { jobId, estimatedCost, upload } = await createJobFor(2048, 20)
    expect(estimatedCost).toBeGreaterThan(10)
    const uploaded = await uploadIntermediate(upload, intermediatePath)
    if (upload.type === 'multipart') await completeUpload(jobId, uploaded.parts)

    // No start: the job is still uploading/uploaded, so no GPU work has begun.
    expect(['canceling', 'canceled']).toContain(await cancelJobRemote(jobId))
    const view = await pollJob(jobId)
    expect(view.status).toBe('canceled')
    expect(view.charge).toBe(0)
    expect(view.refund).toBe(estimatedCost)
  })

  it('charges the work done and returns the rest when cancelled while upscaling', async () => {
    const { jobId, estimatedCost, upload } = await createJobFor(2048, 20)
    const uploaded = await uploadIntermediate(upload, intermediatePath)
    if (upload.type === 'multipart') await completeUpload(jobId, uploaded.parts)
    await startJob(jobId)

    // Wait until the simulated GPU is actually running and has done some frames.
    const { fetchJob } = await import('./cloud-client')
    let running = false
    for (let attempt = 0; attempt < 40 && !running; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      const current = await fetchJob(jobId)
      // framesDone is optional on the wire now (a transcription job reports audio
      // seconds instead), so an upscale job's progress is a null-safe read.
      if (current.status === 'running' && (current.framesDone ?? 0) > 0) running = true
    }
    expect(running).toBe(true)

    expect(['canceling', 'canceled']).toContain(await cancelJobRemote(jobId))
    const settled = await pollJob(jobId)
    expect(settled.status).toBe('canceled')
    // The server applies min(cost, max(minimum, consumed)): the minimum bites
    // here because only a fraction of the frames were done.
    expect(settled.charge).toBeGreaterThanOrEqual(10)
    expect(settled.charge).toBeLessThanOrEqual(estimatedCost)
    expect((settled.charge ?? 0) + (settled.refund ?? 0)).toBe(estimatedCost)
  })

  it('refunds everything when the failure was infrastructure', async () => {
    await server.close()
    await setupServer({ credits: 2000, fail: 'infra' })
    await writeIntermediate(2048)

    const { jobId, estimatedCost, upload } = await createJobFor(2048)
    const uploaded = await uploadIntermediate(upload, intermediatePath)
    if (upload.type === 'multipart') await completeUpload(jobId, uploaded.parts)
    await startJob(jobId)

    const view = await pollJob(jobId)
    expect(view.status).toBe('failed')
    expect(view.charge).toBe(0)
    expect(view.refund).toBe(estimatedCost)
  })
})

describe('credit preflight', () => {
  it('refuses a job the balance cannot cover, with the server numbers', async () => {
    await setupServer({ credits: 3 })
    await writeIntermediate(2048)

    await expect(
      createJob({
        sourceWidth: 1920,
        sourceHeight: 1080,
        fps: 30,
        durationSec: 2,
        fileSizeBytes: 2048,
        targetWidth: 7680,
        targetHeight: 4320,
      }),
    ).rejects.toMatchObject({ code: 'insufficient_credits', details: { cost: 7, balance: 3 } })
  })
})

describe('the orchestrator', () => {
  beforeEach(async () => {
    await setupServer({ credits: 2000 })
    await writeIntermediate(2048)
  })

  it('reserves, uploads, polls and downloads, reporting server-charged credits', async () => {
    const { jobId, estimatedCost, upload } = await createJobFor(2048)
    const stages: string[] = []
    const outcome = await runCloudExport({
      job: { jobId, estimatedCost, upload },
      intermediatePath,
      outputPath: OUTPUT(),
      cancel: { cancelled: false },
      minChargeCredits: 10,
      onProgress: (progress) => stages.push(progress.stage),
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.charge).toBe(estimatedCost)
    expect(outcome.refund).toBe(0)
    expect(stages).toContain('Uploading')
    expect(stages).toContain('Done')
    await expect(fsp.stat(OUTPUT())).resolves.toBeTruthy()
  })
})
