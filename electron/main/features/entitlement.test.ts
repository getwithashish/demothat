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
    delete(key: string) {
      storeState.data.delete(key)
    }
  },
}))

vi.mock('electron-log/main', () => ({
  default: { info: () => undefined, warn: () => undefined, error: () => undefined },
}))

// The real check lives in license-client; this module is a facade over it.
vi.mock('./license-client', () => ({
  getEntitlement: vi.fn(async () => ({ pro: true, credits: 4200 })),
}))

import { getEntitlement, getUnlockUrl } from './entitlement'

describe('entitlement', () => {
  beforeEach(() => {
    storeState.data.clear()
    delete process.env.DEMOTHAT_UNLOCK_URL
  })

  afterEach(() => {
    delete process.env.DEMOTHAT_UNLOCK_URL
  })

  it('reports what the license client says', async () => {
    expect(await getEntitlement()).toEqual({ pro: true, credits: 4200 })
  })

  describe('unlock url', () => {
    it('falls back to the built-in default', () => {
      expect(getUnlockUrl()).toBe('https://demothat.yahodu.in/pro')
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
      expect(getUnlockUrl()).toBe('https://demothat.yahodu.in/pro')
    })
  })
})
