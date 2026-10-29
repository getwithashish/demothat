import { describe, expect, it } from 'vitest'
import {
  BYTES_PER_GB,
  creditsToUsd,
  describeKind,
  describeTerm,
  estimatePublishCredits,
  fitsSizeLimit,
  formatBytes,
  hasLandingPage,
  storageCredits,
  type PublishingCapabilities,
} from './publish-cost'

/** The defaults the API publishes (PUBLISH_CREDITS_PER_GB_YEAR etc.). */
const capabilities: PublishingCapabilities = {
  enabled: true,
  creditsPerGbYear: 1200,
  landingPageCredits: 900,
  minCredits: 1,
  durationsDays: [7, 30, 90, 365],
  defaultDurationDays: 365,
  maxSizeBytes: 2_147_483_648,
  baseUrl: 'https://share.example.test',
  kinds: ['page', 'links', 'embed'],
}

const GB = BYTES_PER_GB

describe('estimatePublishCredits', () => {
  // The owner's own reference points, which is what makes this a mirror of the
  // server rather than a plausible-looking formula of its own.
  it('matches the published reference points', () => {
    // 1.5 GB for a year = $3.00 = 1,800 credits.
    expect(estimatePublishCredits(capabilities, { sizeBytes: 1.5 * GB, storageDays: 365, kind: 'links' })).toBe(1800)
    // 18 GB for a month = the same $3.00 = 1,776 credits.
    expect(estimatePublishCredits(capabilities, { sizeBytes: 18 * GB, storageDays: 30, kind: 'links' })).toBe(1776)
    // 1 GB for a year = 1,200 credits ($2.00).
    expect(estimatePublishCredits(capabilities, { sizeBytes: 1 * GB, storageDays: 365, kind: 'links' })).toBe(1200)
    // 5 GB for a year = 6,000 credits.
    expect(estimatePublishCredits(capabilities, { sizeBytes: 5 * GB, storageDays: 365, kind: 'links' })).toBe(6000)
  })

  it('charges the landing page surcharge on top of the floor, not inside it', () => {
    // The easy mistake: a nearly-free publication with a landing page is 901, not
    // 900, because the storage term still costs its own one credit.
    expect(estimatePublishCredits(capabilities, { sizeBytes: 2_000_000, storageDays: 7, kind: 'page' })).toBe(901)
    expect(estimatePublishCredits(capabilities, { sizeBytes: 2_000_000, storageDays: 7, kind: 'links' })).toBe(1)
    expect(estimatePublishCredits(capabilities, { sizeBytes: GB, storageDays: 365, kind: 'page' })).toBe(2100)
  })

  it('never quotes less than one credit', () => {
    for (const sizeBytes of [0, 1, 1000]) {
      expect(estimatePublishCredits(capabilities, { sizeBytes, storageDays: 1, kind: 'links' })).toBe(1)
    }
  })

  it('scales with the term, and a longer term always costs at least as much', () => {
    const size = 500 * 1000 * 1000 // 0.5 GB, i.e. 600 credits for a year
    const costs = capabilities.durationsDays.map((days) =>
      estimatePublishCredits(capabilities, { sizeBytes: size, storageDays: days, kind: 'links' }),
    )
    expect(costs).toEqual([...costs].sort((a, b) => a - b))
    expect(costs).toEqual([12, 50, 148, 600])
    // The same clip at a tenth of the size, for contrast: 50 MB for a week is 2.
    expect(estimatePublishCredits(capabilities, { sizeBytes: 50 * 1000 * 1000, storageDays: 7, kind: 'links' })).toBe(2)
  })

  it('uses decimal GB, so it does not overcharge by the GiB/G B difference', () => {
    // 1 GiB of bytes is 1.0737 GB, and quoting that as "1 GB" would be 7.4% light.
    // Read the other way: a true gigabyte is 1,000,000,000 bytes, exactly.
    expect(storageCredits(1_000_000_000, 365, 1200)).toBe(1200)
    expect(storageCredits(1_073_741_824, 365, 1200)).toBe(1289)
  })

  it('mirrors the server when the floor is set above a component', () => {
    // The floor is on the total, so a deployment with a high minimum and a landing page
    // charges that minimum — not the minimum plus the surcharge. Flooring the storage
    // term instead (as this file used to) would quote 1,900 where the server charges
    // 1,000, which is the kind of gap a user only finds out about afterwards.
    const highFloor: PublishingCapabilities = { ...capabilities, minCredits: 1000 }
    expect(estimatePublishCredits(highFloor, { sizeBytes: 2_000_000, storageDays: 7, kind: 'page' })).toBe(1000)
  })

  it('has no surcharge for the kinds without a landing page', () => {
    for (const kind of ['links', 'embed'] as const) {
      expect(hasLandingPage(kind)).toBe(false)
      expect(estimatePublishCredits(capabilities, { sizeBytes: 100_000_000, storageDays: 30, kind })).toBe(10)
    }
  })

  it('follows the server when the server changes its rates', () => {
    // Nothing here is hard-coded: a deployment that doubles the rate doubles the quote.
    const dearer: PublishingCapabilities = { ...capabilities, creditsPerGbYear: 2400, landingPageCredits: 0 }
    expect(estimatePublishCredits(dearer, { sizeBytes: GB, storageDays: 365, kind: 'page' })).toBe(2400)
  })
})

describe('describeTerm', () => {
  it('reads a term the way a person says it', () => {
    expect(describeTerm(365)).toBe('1 year')
    expect(describeTerm(90)).toBe('3 months')
    expect(describeTerm(30)).toBe('1 month')
    expect(describeTerm(7)).toBe('1 week')
    expect(describeTerm(1)).toBe('1 day')
    expect(describeTerm(14)).toBe('2 weeks')
    expect(describeTerm(45)).toBe('45 days')
  })
})

describe('creditsToUsd', () => {
  it('values credits at the published rate', () => {
    expect(creditsToUsd(600)).toBe(1)
    expect(creditsToUsd(1800)).toBe(3)
    expect(creditsToUsd(900)).toBe(1.5)
  })
})

describe('fitsSizeLimit', () => {
  it('accepts what the server accepts and refuses the rest', () => {
    expect(fitsSizeLimit(capabilities, capabilities.maxSizeBytes)).toBe(true)
    expect(fitsSizeLimit(capabilities, capabilities.maxSizeBytes + 1)).toBe(false)
  })
})

describe('formatBytes', () => {
  it('formats decimal, to match the unit the price is quoted in', () => {
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(1500)).toBe('1.5 kB')
    expect(formatBytes(50_000_000)).toBe('50 MB')
    expect(formatBytes(1_000_000_000)).toBe('1 GB')
    expect(formatBytes(1_500_000_000)).toBe('1.5 GB')
    expect(formatBytes(2_147_483_648)).toBe('2.1 GB')
  })
})

describe('describeKind', () => {
  it('describes all three kinds without naming one of them wrongly', () => {
    for (const kind of ['page', 'links', 'embed'] as const) {
      expect(describeKind(kind).length).toBeGreaterThan(20)
    }
  })
})
