import { describe, expect, it } from 'vitest'
import { LOW_CREDIT_THRESHOLD, creditStatus, devicesInUse, formatCredits } from './license'
import type { DeviceView } from './license'

function device(overrides: Partial<DeviceView> = {}): DeviceView {
  return {
    id: 'd1',
    label: 'Studio-PC',
    platform: 'Windows',
    active: true,
    activatedAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    current: false,
    ...overrides,
  }
}

describe('creditStatus', () => {
  it('is empty at zero and below', () => {
    expect(creditStatus(0)).toBe('empty')
    expect(creditStatus(-5)).toBe('empty')
  })

  it('is low at and below the threshold', () => {
    expect(creditStatus(1)).toBe('low')
    expect(creditStatus(LOW_CREDIT_THRESHOLD)).toBe('low')
  })

  it('is normal above the threshold', () => {
    expect(creditStatus(LOW_CREDIT_THRESHOLD + 1)).toBe('normal')
    expect(creditStatus(1800)).toBe('normal')
  })

  it('honours a custom threshold', () => {
    expect(creditStatus(150, 200)).toBe('low')
    expect(creditStatus(150, 100)).toBe('normal')
  })
})

describe('formatCredits', () => {
  it('groups thousands', () => {
    expect(formatCredits(1800)).toBe('1,800')
    expect(formatCredits(600000)).toBe('600,000')
  })

  it('never shows a negative or fractional balance', () => {
    expect(formatCredits(-10)).toBe('0')
    expect(formatCredits(12.4)).toBe('12')
    expect(formatCredits(Number.NaN)).toBe('0')
  })
})

describe('devicesInUse', () => {
  it('counts only active devices', () => {
    expect(devicesInUse([device(), device({ id: 'd2', active: false })])).toBe(1)
    expect(devicesInUse([])).toBe(0)
  })
})
