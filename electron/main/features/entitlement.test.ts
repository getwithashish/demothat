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

import { getEntitlement } from './entitlement'

describe('entitlement', () => {
  beforeEach(() => {
    storeState.data.clear()
  })

  afterEach(() => {
    storeState.data.clear()
  })

  it('reports what the license client says', async () => {
    expect(await getEntitlement()).toEqual({ pro: true, credits: 4200 })
  })
})
