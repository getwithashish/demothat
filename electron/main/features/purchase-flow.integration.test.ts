// The purchase flow against the mock API server: a first purchase that activates
// this computer automatically, a plain top-up, and a payment that fails.
//
// This is the whole point of the flow, so it is exercised end to end — checkout
// URL validation, the poll, automatic activation, and the license token the mock
// server signs being verifiable with its published public key.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const secrets = vi.hoisted(() => ({ data: new Map<string, string>() }))

vi.mock('../lib/secure-store', () => ({
  readSecret: (_name: string, key: string) => secrets.data.get(key) ?? null,
  writeSecret: (_name: string, key: string, value: string) => {
    secrets.data.set(key, value)
  },
  deleteSecret: (_name: string, key: string) => {
    secrets.data.delete(key)
  },
  clearSecrets: () => {
    secrets.data.clear()
  },
}))

vi.mock('node-machine-id', () => ({ machineIdSync: () => 'MOCK-MACHINE-ID' }))

import { getEntitlement } from './license-client'
import { getPendingPurchase, pollPurchase, startCheckout } from './purchase-flow'

type MockServer = { url: string; close: () => Promise<void>; publicKeyPem: string }

async function startMock(options: Record<string, unknown> = {}): Promise<MockServer> {
  const module = (await import(new URL('../../../scripts/mock-api-server.mjs', import.meta.url).href)) as unknown as {
    createMockApiServer: (options?: Record<string, unknown>) => Promise<MockServer>
  }
  return module.createMockApiServer({ port: 0, ...options })
}

let server: MockServer

async function setupServer(options: Record<string, unknown> = {}): Promise<void> {
  server = await startMock(options)
  process.env.DEMOTHAT_API_BASE_URL = server.url
  process.env.DEMOTHAT_LICENSE_PUBLIC_KEY = server.publicKeyPem
}

beforeEach(() => {
  secrets.data.clear()
})

afterEach(async () => {
  delete process.env.DEMOTHAT_API_BASE_URL
  delete process.env.DEMOTHAT_LICENSE_PUBLIC_KEY
  delete process.env.DEMOTHAT_FORCE_PRO
  await server?.close()
})

describe('first purchase', () => {
  beforeEach(async () => {
    await setupServer({ scenario: 'first-purchase', credits: 0 })
  })

  it('opens an allow-listed checkout, then activates this computer from the returned key', async () => {
    const session = await startCheckout('pdt_pro_1800')
    expect(session.checkoutUrl.startsWith('https://checkout.dodopayments.com/')).toBe(true)
    expect(getPendingPurchase()?.purchaseId).toBe(session.purchaseId)

    const outcome = await pollPurchase({ maxWaitMs: 30_000 })
    expect(outcome).toEqual({ kind: 'succeeded', balance: 1800, firstPurchase: true })

    // Activated automatically: the key the API returned once is stored, and the
    // token it signed verifies against the server's published public key.
    expect(secrets.data.get('licenseKey')).toBe('DODO-TEST-0001-0002')
    expect(await getEntitlement()).toEqual({ pro: true, credits: 1800 })
    // A settled purchase leaves nothing behind to resume.
    expect(getPendingPurchase()).toBeNull()
  })
})

describe('top-up', () => {
  beforeEach(async () => {
    await setupServer({ scenario: 'topup', credits: 1800 })
  })

  it('moves the balance without returning a key', async () => {
    await startCheckout('pdt_topup_5400')
    const outcome = await pollPurchase({ maxWaitMs: 30_000 })
    expect(outcome).toEqual({ kind: 'succeeded', balance: 7200, firstPurchase: false })
    expect(secrets.data.get('licenseKey')).toBeUndefined()
  })
})

describe('a payment that fails', () => {
  beforeEach(async () => {
    await setupServer({ scenario: 'payment-failure' })
  })

  it('reports the failure and grants nothing', async () => {
    await startCheckout('pdt_pro_1800')
    const outcome = await pollPurchase({ maxWaitMs: 30_000 })
    expect(outcome.kind).toBe('failed')
    expect(secrets.data.get('token')).toBeUndefined()
    expect(await getEntitlement()).toEqual({ pro: false, credits: 0 })
  })
})

describe('the catalogue', () => {
  beforeEach(async () => {
    await setupServer({ scenario: 'topup', credits: 0 })
  })

  it('lists what checkout accepts, priced from the server', async () => {
    const { fetchProducts } = await import('./products')
    const { toCreditPackViews } = await import('../../../shared/pricing')

    const products = await fetchProducts(true)
    expect(products).not.toBeNull()

    const packs = toCreditPackViews(products)
    expect(packs.map((pack) => pack.credits)).toEqual([1800, 5400, 9000])
    expect(packs[0]).toMatchObject({
      productId: 'pdt_pro_1800',
      kind: 'first_purchase',
      priceLabel: '$3',
    })

    // The id the dialog would send back is one the API really sells.
    const session = await startCheckout(packs[0].productId)
    expect(session.checkoutUrl.startsWith('https://checkout.dodopayments.com/')).toBe(true)
  })

  it('reports the catalogue as unavailable rather than throwing', async () => {
    const { fetchProducts, clearProductsCache } = await import('./products')
    await server.close()
    // A dead local port: no external DNS, just a refused connection.
    process.env.DEMOTHAT_API_BASE_URL = 'http://127.0.0.1:1'
    clearProductsCache()
    expect(await fetchProducts(true)).toBeNull()
  })
})

describe('resuming', () => {
  beforeEach(async () => {
    // The payment stays pending for a fixed 3s: the first poll cannot beat that
    // even on a loaded machine, and the resume happens after it has passed.
    await setupServer({ scenario: 'first-purchase', credits: 0, pendingMs: 3000 })
  })

  it('keeps a timed-out purchase so the next launch can carry on', async () => {
    await startCheckout('pdt_pro_1800')
    const outcome = await pollPurchase({ maxWaitMs: 0 })
    expect(outcome.kind).toBe('timeout')
    // Nothing settled, so the record survives for the next attempt.
    expect(getPendingPurchase()).not.toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 3200))
    const resumed = await pollPurchase({ maxWaitMs: 30_000 })
    expect(resumed.kind).toBe('succeeded')
    expect(getPendingPurchase()).toBeNull()
  })
})
