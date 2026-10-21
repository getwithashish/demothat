import { describe, expect, it } from 'vitest'
import { formatPrice, toCreditPackView, toCreditPackViews, type Product, type ProductPrice } from './pricing'

const usd = (amountMinor: number, isMinimum = false): ProductPrice => ({
  amountMinor,
  currency: 'USD',
  minorUnitExponent: 2,
  isMinimum,
})

const product = (overrides: Partial<Product> = {}): Product => ({
  productId: 'pdt_pro_1800',
  kind: 'first_purchase',
  credits: 1800,
  name: 'Pro',
  price: usd(300),
  ...overrides,
})

describe('formatPrice', () => {
  it('drops the decimals on a whole amount', () => {
    expect(formatPrice(usd(300))).toBe('$3')
    expect(formatPrice(usd(900))).toBe('$9')
  })

  it('keeps the cents when there are any', () => {
    expect(formatPrice(usd(450))).toBe('$4.50')
    expect(formatPrice(usd(349))).toBe('$3.49')
  })

  it('respects a zero-decimal currency instead of assuming cents', () => {
    // 500 minor units of JPY is 500 yen, not 5.
    const yen: ProductPrice = { amountMinor: 500, currency: 'JPY', minorUnitExponent: 0, isMinimum: false }
    const rendered = formatPrice(yen)
    expect(rendered).toContain('500')
    expect(rendered).not.toContain('5.00')
  })

  it('keeps a three-decimal currency at three decimals', () => {
    const dinar: ProductPrice = { amountMinor: 1250, currency: 'KWD', minorUnitExponent: 3, isMinimum: false }
    expect(formatPrice(dinar)).toContain('1.25')
  })

  it('says "from" when the amount is a floor', () => {
    expect(formatPrice(usd(300, true))).toMatch(/^from\s/)
  })

  it('has nothing to show without a price', () => {
    expect(formatPrice(null)).toBeNull()
    expect(formatPrice(undefined)).toBeNull()
  })

  it('survives a currency the runtime does not know', () => {
    const odd: ProductPrice = { amountMinor: 700, currency: 'ZZZ', minorUnitExponent: 2, isMinimum: false }
    expect(formatPrice(odd)).toContain('7')
  })
})

describe('toCreditPackView', () => {
  it('carries the server product id, credits and rendered price', () => {
    expect(toCreditPackView(product())).toEqual({
      productId: 'pdt_pro_1800',
      label: 'Pro',
      credits: 1800,
      priceLabel: '$3',
      kind: 'first_purchase',
    })
  })

  it('falls back to the kind when the product has no name', () => {
    expect(toCreditPackView(product({ name: undefined })).label).toBe('Pro')
    expect(toCreditPackView(product({ name: '  ', kind: 'topup' })).label).toBe('Top-up')
  })

  it('shows no price while the provider has not answered', () => {
    expect(toCreditPackView(product({ price: null })).priceLabel).toBeNull()
  })
})

describe('toCreditPackViews', () => {
  it('orders the packs cheapest first, which the recommendation relies on', () => {
    const views = toCreditPackViews([
      product({ productId: 'big', credits: 9000 }),
      product({ productId: 'small', credits: 1800 }),
      product({ productId: 'mid', credits: 5400 }),
    ])
    expect(views.map((view) => view.credits)).toEqual([1800, 5400, 9000])
  })

  it('ignores entries with no id or no credits', () => {
    const views = toCreditPackViews([
      product({ productId: '' }),
      product({ productId: 'zero', credits: 0 }),
      product({ productId: 'ok' }),
    ])
    expect(views.map((view) => view.productId)).toEqual(['ok'])
  })

  it('has nothing to show without a catalogue', () => {
    expect(toCreditPackViews(null)).toEqual([])
    expect(toCreditPackViews(undefined)).toEqual([])
  })
})
