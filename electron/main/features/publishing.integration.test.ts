// Instant publishing against the mock API server (scripts/mock-api-server.mjs).
//
// What is worth testing here is the money path, because everything else about
// publishing is a set of URLs. In particular:
//
//   * the charge is the server's, computed from the bytes that landed rather than the
//     size the app declared, and the app's own quote agrees with it;
//   * a publication that never activated leaves the balance exactly where it was, and
//     does not sit in the user's Shared links list pretending to exist;
//   * deleting does not return credits, and the client says so rather than implying it.
//
// The video is a file of the right size and not a real encoding: nothing in the
// publishing path decodes it — the object store holds bytes, and the price is a
// function of length — so a real encoder would only make the test slower and the
// sizes less exact.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { normalizeCues, type SubtitleCue } from '../../../shared/subtitles'
import { estimatePublishCredits, type PublishingCapabilities } from '../../../shared/publish-cost'

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

import {
  captionsForPublication,
  deletePublication,
  fetchPublicationAnalytics,
  listPublications,
  publish,
  MAX_CAPTIONS_BYTES,
  type PublishStage,
} from './publishing'
import { clearCapabilitiesCache } from './cloud-client'

type MockServer = {
  url: string
  close: () => Promise<void>
  state: { credits: number; publications: Map<string, unknown>; publicationEvents: unknown[] }
}

async function startMock(options: Record<string, unknown> = {}): Promise<MockServer> {
  const module = (await import(new URL('../../../scripts/mock-api-server.mjs', import.meta.url).href)) as unknown as {
    createMockApiServer: (options?: Record<string, unknown>) => Promise<MockServer>
  }
  return module.createMockApiServer({ port: 0, credits: 5000, ...options })
}

/** A file of exactly `size` bytes. */
async function writeFile(name: string, size: number): Promise<string> {
  const filePath = path.join(workDir, name)
  await fsp.writeFile(filePath, crypto.randomBytes(size))
  return filePath
}

const cues: SubtitleCue[] = [
  { id: 'cue-1', start: 0, end: 2, text: 'The first thing to know' },
  { id: 'cue-2', start: 2, end: 4, text: 'and the second' },
]

let server: MockServer
let workDir = ''

beforeEach(async () => {
  workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'publish-test-'))
  clearCapabilitiesCache()
})

afterEach(async () => {
  delete process.env.DEMOTHAT_API_BASE_URL
  await server?.close()
  if (workDir) await fsp.rm(workDir, { recursive: true, force: true })
  workDir = ''
})

async function setupServer(options: Record<string, unknown> = {}): Promise<void> {
  server = await startMock(options)
  process.env.DEMOTHAT_API_BASE_URL = server.url
  secrets.data.set('token', 'mock-token')
}

describe('publish (mock API)', () => {
  it('uploads, activates, and reports the credits the server charged', async () => {
    await setupServer()
    const filePath = await writeFile('video.mp4', 6_000_000) // above the mock's part threshold

    const stages: PublishStage[] = []
    const result = await publish({
      filePath,
      kind: 'links',
      storageDays: 365,
      title: 'A quarterly demo',
      durationSec: 90,
      captions: cues,
      cancel: { cancelled: false },
      onProgress: (progress) => {
        if (stages[stages.length - 1] !== progress.stage) stages.push(progress.stage)
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Priced from the bytes that landed: 6 MB = 0.006 GB, 0.006 * 1200 = 7.2, ceil 8.
    expect(result.publication.sizeBytes).toBe(6_000_000)
    expect(result.publication.creditsCharged).toBe(8)
    expect(server.state.credits).toBe(5000 - 8)

    // The app's own quote, for the same numbers, agrees with what was charged. This is
    // the assertion that keeps the dialog honest.
    const capabilities = { ...publishCapabilities(), creditsPerGbYear: 1200 } as PublishingCapabilities
    expect(estimatePublishCredits(capabilities, { sizeBytes: 6_000_000, storageDays: 365, kind: 'links' })).toBe(8)

    expect(result.publication.status).toBe('active')
    expect(result.publication.title).toBe('A quarterly demo')
    expect(result.publication.storageDays).toBe(365)
    expect(result.captionsIncluded).toBe(true)
    expect(result.publication.hasCaptions).toBe(true)
    expect(result.publication.links.captionsDownloadUrl).toContain('/d/')
    // The slug is the API's, not the app's, and it is unguessable.
    expect(result.publication.slug).toHaveLength(22)

    // Every stage the user waits through, in order, ending at Done.
    expect(stages).toEqual(['Preparing', 'Uploading', 'Activating', 'Done'])
  }, 60_000)

  it('publishes a small video as a single upload, and prices the landing page surcharge', async () => {
    await setupServer()
    const filePath = await writeFile('small.mp4', 1_000_000)

    const result = await publish({
      filePath,
      kind: 'page',
      storageDays: 30,
      cancel: { cancelled: false },
      onProgress: () => undefined,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 0.001 GB * 1200 * 30/365 = 0.0986 -> floor 1 credit of storage, + 900 landing page.
    expect(result.publication.creditsCharged).toBe(901)
    expect(result.publication.served).toEqual({ page: true, embed: true, links: true })
    expect(result.publication.links.pageUrl).toContain('/p/')
    expect(result.publication.links.embedCode).toContain('<iframe')
  }, 60_000)

  it('charges nothing and leaves nothing behind when the upload is cancelled', async () => {
    await setupServer()
    const filePath = await writeFile('video.mp4', 6_000_000)

    const result = await publish({
      filePath,
      kind: 'links',
      storageDays: 30,
      cancel: { cancelled: true },
      onProgress: () => undefined,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('canceled')

    // Nothing was charged, and the publication that was created before the upload
    // started is not sitting in the list looking real.
    expect(server.state.credits).toBe(5000)
    const publications = await listPublications()
    for (const publication of publications) {
      expect(publication.status).not.toBe('active')
    }
  }, 60_000)

  it('refuses before uploading when the balance cannot cover the quote', async () => {
    await setupServer({ credits: 2 })
    const filePath = await writeFile('video.mp4', 6_000_000)

    const result = await publish({
      filePath,
      kind: 'links',
      storageDays: 365,
      cancel: { cancelled: false },
      onProgress: () => undefined,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('rejected')
    expect(result.error).toContain('not enough credits')
    expect(result.cost).toBe(8)
    expect(result.balance).toBe(2)

    // Refused at the preflight: no bytes, no publication, no charge.
    expect(server.state.credits).toBe(2)
    expect(await listPublications()).toHaveLength(0)
  }, 60_000)

  it('never sends a caption track the server would reject', async () => {
    await setupServer()
    const filePath = await writeFile('video.mp4', 1_000_000)

    const result = await publish({
      filePath,
      kind: 'links',
      storageDays: 7,
      cancel: { cancelled: false },
      onProgress: () => undefined,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // No cues means no track, and no captions link on the view.
    expect(result.captionsIncluded).toBe(false)
    expect(result.publication.hasCaptions).toBe(false)
    expect(result.publication.links.captionsDownloadUrl).toBeUndefined()
  }, 60_000)
})

describe('captionsForPublication', () => {
  it('produces a normalised WebVTT document', () => {
    const vtt = captionsForPublication(cues)
    expect(vtt).not.toBeNull()
    expect(vtt?.startsWith('WEBVTT\n\n')).toBe(true)
    expect(vtt).toContain('The first thing to know')
    // Same normalisation the exported sidecar uses, so the two cannot disagree: feeding
    // in already-normalised cues changes nothing.
    expect(captionsForPublication(normalizeCues(cues))).toBe(vtt)
  })

  it('returns null when there is nothing to send', () => {
    expect(captionsForPublication(undefined)).toBeNull()
    expect(captionsForPublication([])).toBeNull()
  })

  it('refuses a track too large to send rather than letting the server refuse it', () => {
    // Enough cues to exceed the server's 2,000,000-byte cap once serialised.
    const huge: SubtitleCue[] = Array.from({ length: 30_000 }, (_, index) => ({
      id: `big-${index}`,
      start: index,
      end: index + 1,
      text: `Cue number ${index} with enough text to add up quickly`,
    }))
    expect(() => captionsForPublication(huge)).toThrowError(/too long/)
    // And the cap is the server's, not a number invented here.
    expect(MAX_CAPTIONS_BYTES).toBe(2_000_000)
  })
})

describe('the shared links list', () => {
  it('lists what was published, newest last, with the links built on the share host', async () => {
    await setupServer()
    const small = await writeFile('one.mp4', 1_000_000)
    const larger = await writeFile('two.mp4', 1_200_000)

    await publish({
      filePath: small,
      kind: 'links',
      storageDays: 7,
      title: 'First',
      cancel: { cancelled: false },
      onProgress: () => undefined,
    })
    await publish({
      filePath: larger,
      kind: 'embed',
      storageDays: 7,
      title: 'Second',
      cancel: { cancelled: false },
      onProgress: () => undefined,
    })

    const publications = await listPublications()
    expect(publications).toHaveLength(2)
    expect(publications.map((publication) => publication.title)).toEqual(['First', 'Second'])
    for (const publication of publications) {
      expect(publication.links.videoDownloadUrl).toContain('share.mock.test')
    }
  }, 60_000)

  it('says out loud that deleting returns no credits', async () => {
    await setupServer()
    const filePath = await writeFile('video.mp4', 1_000_000)
    const published = await publish({
      filePath,
      kind: 'links',
      storageDays: 7,
      cancel: { cancelled: false },
      onProgress: () => undefined,
    })
    expect(published.ok).toBe(true)
    if (!published.ok) return

    const before = server.state.credits
    const result = await deletePublication(published.publication.publicationId)

    expect(result.creditsRefunded).toBe(0)
    expect(result.view.status).toBe('revoked')
    // The charge stands, which is the thing the UI has to be honest about.
    expect(server.state.credits).toBe(before)
  }, 60_000)
})

describe('analytics', () => {
  it('passes the range through and reports session-shaped numbers', async () => {
    await setupServer()
    const filePath = await writeFile('video.mp4', 1_000_000)
    const published = await publish({
      filePath,
      kind: 'links',
      storageDays: 30,
      durationSec: 100,
      cancel: { cancelled: false },
      onProgress: () => undefined,
    })
    expect(published.ok).toBe(true)
    if (!published.ok) return

    const id = published.publication.publicationId
    const now = Date.now()
    server.state.publicationEvents.push(
      { publicationId: id, type: 'view', sessionId: 'viewer-one', at: new Date(now - 1000).toISOString() },
      { publicationId: id, type: 'play', sessionId: 'viewer-one', at: new Date(now - 900).toISOString() },
      {
        publicationId: id,
        type: 'progress',
        sessionId: 'viewer-one',
        watchedSeconds: 40,
        at: new Date(now - 800).toISOString(),
      },
      { publicationId: id, type: 'complete', sessionId: 'viewer-one', at: new Date(now - 700).toISOString() },
      { publicationId: id, type: 'view', sessionId: 'viewer-two', at: new Date(now - 600).toISOString() },
      {
        publicationId: id,
        type: 'progress',
        sessionId: 'viewer-two',
        watchedSeconds: 20,
        at: new Date(now - 500).toISOString(),
      },
      // Outside the 7-day window, so `all` and `7d` must disagree once it is moved.
      { publicationId: id, type: 'view', sessionId: 'old-viewer', at: new Date(now - 10 * 86_400_000).toISOString() },
    )

    const recent = await fetchPublicationAnalytics(id, '7d')
    expect(recent.range).toBe('7d')
    expect(recent.totals.views).toBe(2)
    expect(recent.totals.uniqueViewers).toBe(2)
    expect(recent.totals.completions).toBe(1)
    // Watch time is the furthest point per session (40 + 20), not the sum of beacons.
    expect(recent.totals.watchedSeconds).toBe(60)
    expect(recent.totals.avgWatchSeconds).toBe(30)
    expect(recent.totals.completionRate).toBe(0.5)

    const all = await fetchPublicationAnalytics(id, 'all')
    expect(all.totals.views).toBe(3)
    expect(all.totals.uniqueViewers).toBe(3)
  }, 60_000)

  it('defaults to a 30-day window', async () => {
    await setupServer()
    const filePath = await writeFile('video.mp4', 1_000_000)
    const published = await publish({
      filePath,
      kind: 'links',
      storageDays: 30,
      cancel: { cancelled: false },
      onProgress: () => undefined,
    })
    expect(published.ok).toBe(true)
    if (!published.ok) return

    const analytics = await fetchPublicationAnalytics(published.publication.publicationId)
    expect(analytics.range).toBe('30d')
    expect(analytics.totals.views).toBe(0)
  }, 60_000)
})

/** The publishing block of `/v1/capabilities`, as the mock serves it. */
function publishCapabilities(): PublishingCapabilities {
  return {
    enabled: true,
    creditsPerGbYear: 1200,
    landingPageCredits: 900,
    minCredits: 1,
    durationsDays: [7, 30, 90, 365],
    defaultDurationDays: 365,
    maxSizeBytes: 2_147_483_648,
    baseUrl: 'https://share.mock.test',
    kinds: ['page', 'links', 'embed'],
  }
}
