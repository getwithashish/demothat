import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Secrets live in Electron's safeStorage; an in-memory map stands in for it.
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

const activation = vi.hoisted(() => ({
  activate: vi.fn(async () => ({ token: 'tok', balance: 1800, devices: [] })),
}))

vi.mock('./license-client', () => ({
  activateLicense: activation.activate,
  getDeviceIdHash: () => 'device-hash',
  getStoredToken: () => secrets.data.get('token') ?? null,
  devicesFromError: () => undefined,
}))

import {
  POLL_INTERVAL_MS,
  clearPendingPurchase,
  getPendingPurchase,
  isTransient,
  nextPollDelay,
  pollPurchase,
  startCheckout,
} from './purchase-flow'
import { ApiError } from '../lib/api-client'

// --- A tiny stand-in for demothat-api ----------------------------------------

interface Route {
  status?: number
  body: unknown
}

let server: Server
let baseUrl = ''
let checkoutRoute: Route
let purchaseRoutes: Route[]
let purchaseCalls = 0

function json(res: import('node:http').ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/checkout') {
      return json(res, checkoutRoute.status ?? 200, checkoutRoute.body)
    }
    if (req.method === 'GET' && req.url?.startsWith('/v1/purchases/')) {
      const route = purchaseRoutes[Math.min(purchaseCalls, purchaseRoutes.length - 1)]
      purchaseCalls += 1
      return json(res, route.status ?? 200, route.body)
    }
    return json(res, 404, { error: { code: 'not_found', message: 'no route' } })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  secrets.data.clear()
  purchaseCalls = 0
  purchaseRoutes = []
  checkoutRoute = { body: {} }
  activation.activate.mockClear()
  process.env.DEMOTHAT_API_BASE_URL = baseUrl
})

afterEach(() => {
  delete process.env.DEMOTHAT_API_BASE_URL
})

// --- Pure logic ---------------------------------------------------------------

describe('nextPollDelay', () => {
  it('holds the steady 2s cadence while the API answers', () => {
    expect(nextPollDelay(2000, false)).toBe(POLL_INTERVAL_MS)
    expect(nextPollDelay(9000, false)).toBe(POLL_INTERVAL_MS)
  })

  it('backs off by 1.5x on network errors, capped', () => {
    expect(nextPollDelay(2000, true)).toBe(3000)
    expect(nextPollDelay(3000, true)).toBe(4500)
    expect(nextPollDelay(9000, true, 10_000)).toBe(10_000)
  })
})

describe('isTransient', () => {
  it('retries network failures and 5xx', () => {
    expect(isTransient(new Error('socket hang up'))).toBe(true)
    expect(isTransient(new ApiError('boom', 'server_error', 500))).toBe(true)
    expect(isTransient(new ApiError('offline', 'unreachable'))).toBe(true)
  })

  it('does not retry a 4xx the server meant', () => {
    expect(isTransient(new ApiError('gone', 'not_found', 404))).toBe(false)
    expect(isTransient(new ApiError('bad', 'validation_error', 400))).toBe(false)
  })
})

// --- Checkout -----------------------------------------------------------------

describe('startCheckout', () => {
  it('accepts an allow-listed https checkout and remembers the purchase', async () => {
    checkoutRoute = {
      body: {
        purchaseId: 'pur_1',
        pollToken: 'poll_1',
        checkoutUrl: 'https://checkout.dodopayments.com/session/abc',
      },
    }
    const session = await startCheckout('pdt_pro_1800')
    expect(session.purchaseId).toBe('pur_1')
    expect(getPendingPurchase()).toEqual({
      purchaseId: 'pur_1',
      pollToken: 'poll_1',
      checkoutUrl: 'https://checkout.dodopayments.com/session/abc',
    })
  })

  it('refuses a checkout URL on a host that is not allow-listed', async () => {
    checkoutRoute = {
      body: { purchaseId: 'pur_1', pollToken: 'poll_1', checkoutUrl: 'https://evil.example.com/pay' },
    }
    await expect(startCheckout('pdt_pro_1800')).rejects.toThrow(/allowed host/)
    expect(getPendingPurchase()).toBeNull()
  })

  it('refuses an empty product id before calling the API', async () => {
    await expect(startCheckout('  ')).rejects.toThrow(/credit pack/)
  })
})

// --- Polling ------------------------------------------------------------------

describe('pollPurchase', () => {
  beforeEach(() => {
    secrets.data.set('purchaseId', 'pur_1')
    secrets.data.set('pollToken', 'poll_1')
  })

  it('returns the new balance for a top-up', async () => {
    purchaseRoutes = [
      { body: { status: 'pending' } },
      { body: { status: 'pending' } },
      { body: { status: 'succeeded', balance: 7200 } },
    ]
    const outcome = await pollPurchase({ maxWaitMs: 30_000 })
    expect(outcome).toEqual({ kind: 'succeeded', balance: 7200, firstPurchase: false })
    // The purchase is done with, so nothing is left on disk to resume.
    expect(getPendingPurchase()).toBeNull()
  })

  it('activates automatically on a first purchase', async () => {
    purchaseRoutes = [{ body: { status: 'succeeded', balance: 1800, licenseKey: 'DODO-KEY' } }]
    const outcome = await pollPurchase({ maxWaitMs: 30_000 })
    expect(outcome).toEqual({ kind: 'succeeded', balance: 1800, firstPurchase: true })
    expect(activation.activate).toHaveBeenCalledWith('DODO-KEY')
  })

  it('reports a failed payment and stops watching it', async () => {
    purchaseRoutes = [{ body: { status: 'failed' } }]
    const outcome = await pollPurchase({ maxWaitMs: 30_000 })
    expect(outcome.kind).toBe('failed')
    expect(getPendingPurchase()).toBeNull()
  })

  it('stops on a 404 without retrying forever', async () => {
    purchaseRoutes = [{ status: 404, body: { error: { code: 'not_found', message: 'gone' } } }]
    const outcome = await pollPurchase({ maxWaitMs: 30_000 })
    expect(outcome.kind).toBe('failed')
    expect(getPendingPurchase()).toBeNull()
  })

  it('times out but keeps the purchase for a later resume', async () => {
    purchaseRoutes = [{ body: { status: 'pending' } }]
    const outcome = await pollPurchase({ maxWaitMs: 0 })
    expect(outcome).toEqual({ kind: 'timeout' })
    expect(getPendingPurchase()).not.toBeNull()
  })

  it('can be cancelled', async () => {
    purchaseRoutes = [{ body: { status: 'pending' } }]
    const cancel = { cancelled: true }
    await expect(pollPurchase({ cancel, maxWaitMs: 30_000 })).rejects.toThrow(/Cancelled/)
    // Cancel is not a settlement: the purchase stays resumable.
    expect(getPendingPurchase()).not.toBeNull()
  })

  it('has nothing to do without a pending purchase', async () => {
    clearPendingPurchase()
    await expect(pollPurchase()).rejects.toThrow(/no purchase/i)
  })
})
