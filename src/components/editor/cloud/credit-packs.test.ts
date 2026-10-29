import { describe, expect, it } from 'vitest'
import { pickNoteTarget, recommendedPackIndex, visiblePacks } from './credit-packs'

/** A stand-in for the server catalogue: cheapest first, one entry pack then top-ups. */
const packs: Array<{ productId: string; kind: 'first_purchase' | 'topup'; credits: number }> = [
  { productId: 'pro', kind: 'first_purchase', credits: 1800 },
  { productId: 't1', kind: 'topup', credits: 3000 },
  { productId: 't2', kind: 'topup', credits: 30000 },
  { productId: 't3', kind: 'topup', credits: 300000 },
]

describe('recommendedPackIndex', () => {
  it('preselects the first pack when nothing is short', () => {
    expect(recommendedPackIndex(null, packs)).toBe(0)
    expect(recommendedPackIndex(0, packs)).toBe(0)
  })

  it('picks the smallest pack that covers the shortfall', () => {
    // The packs are 1,800 / 3,000 / 30,000 / 300,000 credits.
    // 1,200 short: the entry pack already covers it.
    expect(recommendedPackIndex(1200, packs)).toBe(0)
    // 3,500 short: the entry pack and the 3,000 one both fall short.
    expect(recommendedPackIndex(3500, packs)).toBe(2)
    // 40,000 short: only the largest pack reaches.
    expect(recommendedPackIndex(40_000, packs)).toBe(3)
  })

  it('falls back to the largest pack when nothing covers the shortfall', () => {
    expect(recommendedPackIndex(10_000_000, packs)).toBe(packs.length - 1)
  })

  it('handles an empty pack list', () => {
    expect(recommendedPackIndex(1200, [])).toBe(0)
  })
})

describe('pickNoteTarget', () => {
  it('prefers 8K when the table prices it', () => {
    expect(pickNoteTarget({ '1080p': 0.01, '4k': 0.05, '8k': 0.11 })).toBe('8k')
  })

  it('falls back to the largest priced target', () => {
    expect(pickNoteTarget({ '1080p': 0.01, '4k': 0.05 })).toBe('4k')
  })

  it('ignores zero-priced entries and has no answer without a table', () => {
    expect(pickNoteTarget({ '4k': 0, '1080p': 0.01 })).toBe('1080p')
    expect(pickNoteTarget(undefined)).toBeNull()
    expect(pickNoteTarget({})).toBeNull()
  })
})

describe('visiblePacks', () => {
  it('shows the entry pack alone until the copy holds Pro', () => {
    const shown = visiblePacks(packs, false)
    expect(shown).toHaveLength(1)
    expect(shown[0].kind).toBe('first_purchase')
    expect(shown[0].productId).toBe('pro')
  })

  it('shows the top-ups once the copy holds Pro', () => {
    expect(visiblePacks(packs, true)).toHaveLength(packs.length)
  })

  it('returns the catalogue whole when it carries no entry pack', () => {
    // Better to show what the server sells than an empty dialog.
    const topups = packs.filter((pack) => pack.kind === 'topup')
    expect(visiblePacks(topups, false)).toEqual(topups)
  })
})
