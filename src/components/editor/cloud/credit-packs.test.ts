import { describe, expect, it } from 'vitest'
import { CREDIT_PACKS } from '../../../../shared/license'
import { priceLabel, recommendedPackIndex } from './credit-packs'

describe('recommendedPackIndex', () => {
  it('preselects the first pack when nothing is short', () => {
    expect(recommendedPackIndex(null)).toBe(0)
    expect(recommendedPackIndex(0)).toBe(0)
  })

  it('picks the smallest pack that covers the shortfall', () => {
    // 1200 credits short: the 1,800 pack is the cheapest that covers it.
    expect(recommendedPackIndex(1200)).toBe(0)
    // 2,000 short: the 1,800 pack no longer covers it.
    expect(recommendedPackIndex(2000)).toBe(1)
    expect(recommendedPackIndex(6000)).toBe(2)
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
    expect(priceLabel({ productId: 'p', label: 'Pro', credits: 1800, priceUsd: 3 })).toBe('$3')
  })

  it('shows cents when there are any', () => {
    expect(priceLabel({ productId: 'p', label: 'Pro', credits: 900, priceUsd: 1.5 })).toBe('$1.50')
  })
})

describe('credit packs', () => {
  it('are ordered cheapest first, which the recommendation relies on', () => {
    const credits = CREDIT_PACKS.map((pack) => pack.credits)
    expect([...credits].sort((a, b) => a - b)).toEqual(credits)
  })
})
