import { describe, expect, it } from 'vitest'
import { creditsPerFrameFor, estimateCloudCredits, labelHeight, rateKeyForHeight } from './cloud-cost'

/** The live production table as served by /v1/capabilities. */
const PRODUCTION_TABLE = { '1080p': 1, '1440p': 2, '2160p': 4, '4320p': 8 }

describe('rateKeyForHeight / creditsPerFrameFor', () => {
  it('resolves each export height to the pixel-height server key', () => {
    expect(rateKeyForHeight(PRODUCTION_TABLE, 1080)).toBe('1080p')
    expect(rateKeyForHeight(PRODUCTION_TABLE, 1440)).toBe('1440p')
    expect(rateKeyForHeight(PRODUCTION_TABLE, 2160)).toBe('2160p')
    expect(rateKeyForHeight(PRODUCTION_TABLE, 4320)).toBe('4320p')
  })

  it('charges every resolution from the server table, not just 1080p', () => {
    expect(creditsPerFrameFor(PRODUCTION_TABLE, 1080)).toBe(1)
    expect(creditsPerFrameFor(PRODUCTION_TABLE, 1440)).toBe(2)
    expect(creditsPerFrameFor(PRODUCTION_TABLE, 2160)).toBe(4)
    expect(creditsPerFrameFor(PRODUCTION_TABLE, 4320)).toBe(8)
  })

  it('rounds a below-bucket height up to the nearest priced target', () => {
    // A 720p export is priced at the 1080p rate (the server never undercharges).
    expect(creditsPerFrameFor(PRODUCTION_TABLE, 720)).toBe(1)
  })

  it('falls back to the tallest label for a target above the largest bucket', () => {
    expect(creditsPerFrameFor(PRODUCTION_TABLE, 8640)).toBe(8)
  })

  it('handles 1k-style labels ("4k","8k") like the mock server', () => {
    const mockTable = { '1080p': 0.01, '4k': 0.05, '8k': 0.11 }
    expect(labelHeight('4k')).toBe(4320)
    expect(labelHeight('8k')).toBe(8640)
    expect(creditsPerFrameFor(mockTable, 2160)).toBe(0.05)
  })

  it('returns null when the table has no usable rate', () => {
    expect(creditsPerFrameFor(undefined, 1080)).toBeNull()
    expect(creditsPerFrameFor({}, 1080)).toBeNull()
  })
})

describe('estimateCloudCredits', () => {
  it('prices a full 4K minute at the 4K rate', () => {
    // 60s * 30fps = 1800 frames * 4 = 7200 credits.
    const est = estimateCloudCredits(PRODUCTION_TABLE, 2160, 60, 30)
    expect(est?.credits).toBe(7200)
    expect(est?.target).toBe('4k')
  })

  it('never returns fewer than 1 credit', () => {
    const est = estimateCloudCredits(PRODUCTION_TABLE, 1080, 0.001, 1)
    expect(est?.credits).toBe(1)
  })
})
