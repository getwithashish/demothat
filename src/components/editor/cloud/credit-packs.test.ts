import { describe, expect, it } from 'vitest'
import { CREDIT_PACKS } from '../../../../shared/license'
import { priceLabel, pickNoteTarget, fallbackPackViews, recommendedPackIndex, visiblePacks } from './credit-packs'

describe('recommendedPackIndex', () => {
  it('preselects the first pack when nothing is short', () => {
    expect(recommendedPackIndex(null)).toBe(0)
    expect(recommendedPackIndex(0)).toBe(0)
  })

  it('picks the smallest pack that covers the shortfall', () => {
    // The packs are 1,800 / 3,000 / 30,000 / 300,000 credits ($3 / $5 / $50 / $500).
    // 1,200 short: the entry pack already covers it.
    expect(recommendedPackIndex(1200)).toBe(0)
    // 3,500 short: the entry pack and the 3,000 one both fall short.
    expect(recommendedPackIndex(3500)).toBe(2)
    // 40,000 short: only the largest pack reaches.
    expect(recommendedPackIndex(40_000)).toBe(3)
  })

  it('falls back to the largest pack when nothing covers the shortfall', () => {
    expect(recommendedPackIndex(10_000_000)).toBe(CREDIT_PACKS.length - 1)
  })

  it('handles an empty pack list', () => {
    expect(recommendedPackIndex(1200, [])).toBe(0)
  })
})

describe('priceLabel', () => {
  it('shows whole dollars without decimals', () => {
    expect(priceLabel({ productId: 'p', label: 'Pro', credits: 1800, priceUsd: 3, kind: 'first_purchase' })).toBe('$3')
  })

  it('shows cents when there are any', () => {
    expect(priceLabel({ productId: 'p', label: 'Pro', credits: 900, priceUsd: 1.5, kind: 'first_purchase' })).toBe(
      '$1.50',
    )
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

describe('credit packs', () => {
  it('are ordered cheapest first, which the recommendation relies on', () => {
    const credits = CREDIT_PACKS.map((pack) => pack.credits)
    expect([...credits].sort((a, b) => a - b)).toEqual(credits)
  })

  it('lead with the entry pack, which is the only one a new copy may buy', () => {
    expect(CREDIT_PACKS[0].kind).toBe('first_purchase')
    expect(CREDIT_PACKS.filter((pack) => pack.kind === 'first_purchase')).toHaveLength(1)
  })
})

describe('visiblePacks', () => {
  it('shows the entry pack alone until the copy holds Pro', () => {
    const shown = visiblePacks(fallbackPackViews(), false)
    expect(shown).toHaveLength(1)
    expect(shown[0].kind).toBe('first_purchase')
    expect(shown[0].productId).toBe(CREDIT_PACKS[0].productId)
  })

  it('shows the top-ups once the copy holds Pro', () => {
    expect(visiblePacks(fallbackPackViews(), true)).toHaveLength(CREDIT_PACKS.length)
  })

  it('returns the catalogue whole when it carries no entry pack', () => {
    // Better to show what the server sells than an empty dialog.
    const topups = fallbackPackViews().filter((pack) => pack.kind === 'topup')
    expect(visiblePacks(topups, false)).toEqual(topups)
  })
})
