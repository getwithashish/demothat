import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storeState = vi.hoisted(() => ({ data: new Map<string, unknown>() }))

vi.mock('electron-store', () => ({
  default: class MockStore {
    get(key: string) {
      return storeState.data.get(key)
    }
    set(key: string, value: unknown) {
      storeState.data.set(key, value)
    }
  },
}))

vi.mock('electron-log/main', () => ({
  default: { info: () => undefined, warn: () => undefined, error: () => undefined },
}))

import { getEntitlement, getUnlockUrl } from './entitlement'

describe('entitlement', () => {
  beforeEach(() => {
    storeState.data.clear()
    delete process.env.DEMOTHAT_FORCE_PRO
    delete process.env.DEMOTHAT_UNLOCK_URL
  })

  afterEach(() => {
    delete process.env.DEMOTHAT_FORCE_PRO
    delete process.env.DEMOTHAT_UNLOCK_URL
  })

  it('is not Pro without a licence key', async () => {
    expect(await getEntitlement()).toEqual({ pro: false, credits: 0 })
  })

  it('is not Pro for a key the placeholder verifier does not accept', async () => {
    storeState.data.set('pro.licenseKey', 'DEMO-BASIC-123')
    expect(await getEntitlement()).toEqual({ pro: false, credits: 0 })
  })

  it('accepts the placeholder key shape', async () => {
    storeState.data.set('pro.licenseKey', 'DEMO-PRO-123')
    expect(await getEntitlement()).toEqual({ pro: true, credits: 0 })
  })

  it('is forced on in development', async () => {
    process.env.DEMOTHAT_FORCE_PRO = '1'
    expect(await getEntitlement()).toEqual({ pro: true, credits: 0 })
  })

  it('ignores a blank stored key', async () => {
    storeState.data.set('pro.licenseKey', '   ')
    expect(await getEntitlement()).toEqual({ pro: false, credits: 0 })
  })

  describe('unlock url', () => {
    it('falls back to the built-in default', () => {
      expect(getUnlockUrl()).toBe('https://demothat.app/pro')
    })

    it('honours the environment variable', () => {
      process.env.DEMOTHAT_UNLOCK_URL = 'https://example.test/env'
      expect(getUnlockUrl()).toBe('https://example.test/env')
    })

    it('prefers a configured setting over the environment', () => {
      process.env.DEMOTHAT_UNLOCK_URL = 'https://example.test/env'
      storeState.data.set('pro.unlockUrl', 'https://example.test/setting')
      expect(getUnlockUrl()).toBe('https://example.test/setting')
    })

    it('ignores a blank setting', () => {
      storeState.data.set('pro.unlockUrl', '  ')
      expect(getUnlockUrl()).toBe('https://demothat.app/pro')
    })
  })
})
