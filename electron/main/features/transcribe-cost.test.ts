// The client-side mirror of the server's transcription price.
//
// The server recomputes the cost from its own probe of the uploaded audio, so this
// only has to agree closely enough to warn about a shortfall before an upload
// starts. A disagreement is a UI bug, not a billing bug — but it is still worth
// pinning down, because the dialog shows the number and the capsule compares it
// against the balance.

import { describe, expect, it } from 'vitest'
import {
  estimateTranscribeCredits,
  hasEnoughCredits,
  transcribeBlockedReason,
} from '../../../shared/transcribe-cost'

const CAPS = { enabled: true, creditsPerMinute: 1800, maxAudioSeconds: 900 }

describe('estimateTranscribeCredits', () => {
  it('prices a transcription per minute of audio', () => {
    // The shipped default: 1800 credits a minute, the cost of a 30fps 1080p cloud
    // upscale of the same clip.
    expect(estimateTranscribeCredits(CAPS, 60)?.credits).toBe(1800)
    expect(estimateTranscribeCredits(CAPS, 120)?.credits).toBe(3600)
    expect(estimateTranscribeCredits(CAPS, 300)?.credits).toBe(9000)
  })

  it('rounds up, so a partial minute is never free', () => {
    expect(estimateTranscribeCredits(CAPS, 0.5)?.credits).toBe(15)
    expect(estimateTranscribeCredits(CAPS, 1)?.credits).toBe(30)
    expect(estimateTranscribeCredits(CAPS, 118.4)?.credits).toBe(3552)
  })

  it('never quotes less than one credit', () => {
    // A fractional rate on a very short clip must not round down to nothing.
    expect(estimateTranscribeCredits({ creditsPerMinute: 1 }, 1)?.credits).toBe(1)
  })

  it('carries the rate it used, so the dialog can explain the number', () => {
    expect(estimateTranscribeCredits(CAPS, 120)?.creditsPerMinute).toBe(1800)
  })

  it('reports unavailable rather than a price of zero', () => {
    // An older API, or a deployment that does not publish the block at all.
    expect(estimateTranscribeCredits(undefined, 120)).toBeNull()
    expect(estimateTranscribeCredits({}, 120)).toBeNull()
    expect(estimateTranscribeCredits({ creditsPerMinute: Number.NaN }, 120)).toBeNull()
    expect(estimateTranscribeCredits(CAPS, 0)).toBeNull()
    expect(estimateTranscribeCredits(CAPS, Number.NaN)).toBeNull()
  })

  it('follows a re-priced deployment', () => {
    expect(estimateTranscribeCredits({ creditsPerMinute: 120 }, 300)?.credits).toBe(600)
    // A free tier is a valid configuration.
    expect(estimateTranscribeCredits({ creditsPerMinute: 0 }, 300)?.credits).toBe(1)
  })
})

describe('hasEnoughCredits', () => {
  it('compares the balance against the estimate', () => {
    expect(hasEnoughCredits(3600, 3600)).toBe(true)
    expect(hasEnoughCredits(3599, 3600)).toBe(false)
  })
})

describe('transcribeBlockedReason', () => {
  it('is null when a transcription can be offered', () => {
    expect(transcribeBlockedReason(CAPS, 120, true)).toBeNull()
  })

  it('explains a recording with no audio', () => {
    expect(transcribeBlockedReason(CAPS, 120, false)).toMatch(/no audio track/i)
  })

  it('explains a switched-off deployment', () => {
    expect(transcribeBlockedReason({ enabled: false }, 120, true)).toMatch(/switched off/i)
  })

  it('explains audio beyond the cap, in minutes', () => {
    expect(transcribeBlockedReason(CAPS, 1000, true)).toMatch(/15 minutes/)
  })

  it('does not block on a cap the deployment did not publish', () => {
    expect(transcribeBlockedReason({ enabled: true }, 100_000, true)).toBeNull()
  })
})
