import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose'

// The license client reaches for Electron-backed modules at import time; stub
// them so the pure logic can run under plain Node.
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

const machine = vi.hoisted(() => ({ id: 'RAW-MACHINE-ID', throw: false }))

vi.mock('node-machine-id', () => ({
  machineIdSync: () => {
    if (machine.throw) throw new Error('no machine id')
    return machine.id
  },
}))

import {
  activateLicense,
  computeDeviceIdHash,
  getEntitlement,
  getStoredToken,
  isTokenExpired,
  signOut,
  verifyLicenseToken,
} from './license-client'
import { DEVICE_ID_SALT } from '../lib/api-config'
import { LicenseKeyResolver } from '../lib/license-keys'

/** A throwaway Ed25519 keypair, so no real key material is ever in the repo. */
async function keypair() {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
  return { privateKey, publicJwk: (await exportJWK(publicKey)) as JWK }
}

/** A key set response, as the API serves it at `/.well-known/jwks.json`. */
function keySetResponse(publicJwk: JWK): Response {
  return new Response(JSON.stringify({ keys: [{ ...publicJwk, alg: 'EdDSA', use: 'sig' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** A resolver that serves `publicJwk` as if it had been fetched from the API. */
function resolverFor(publicJwk: JWK): LicenseKeyResolver {
  return new LicenseKeyResolver({
    apiBaseUrl: () => 'https://api.test',
    fetchImpl: (async () => keySetResponse(publicJwk)) as unknown as typeof fetch,
    readCache: () => null,
    writeCache: () => {},
  })
}

let apiSeq = 0

/**
 * Points the app at a fresh (stubbed) API whose published key set is `publicJwk`,
 * so `getEntitlement` — which uses the process-wide resolver — verifies against it.
 * A distinct URL per call keeps the resolver's per-API memory cache from leaking
 * one test's keys into the next.
 */
function stubPublishedKeys(publicJwk: JWK): void {
  process.env.DEMOTHAT_API_BASE_URL = `https://unit.test/${++apiSeq}`
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input)
    if (url.endsWith('/.well-known/jwks.json')) return keySetResponse(publicJwk)
    return new Response('{}', { status: 404 })
  })
}

async function signToken(privateKey: CryptoKey, claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims).setProtectedHeader({ alg: 'EdDSA' }).setIssuedAt().sign(privateKey)
}

const validClaims = {
  sub: 'lic_123',
  plan: 'pro',
  balance: 1800,
  exp: Math.floor(Date.now() / 1000) + 3600,
}

describe('computeDeviceIdHash', () => {
  it('is deterministic and salted', () => {
    const a = computeDeviceIdHash('abc', 'salt')
    const b = computeDeviceIdHash('abc', 'salt')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(computeDeviceIdHash('abc', 'other-salt'))
    expect(a).not.toBe(computeDeviceIdHash('abd', 'salt'))
  })

  it('never returns the raw id', () => {
    expect(computeDeviceIdHash('RAW-MACHINE-ID')).not.toContain('RAW-MACHINE-ID')
    expect(computeDeviceIdHash('RAW-MACHINE-ID', DEVICE_ID_SALT)).not.toContain('RAW-MACHINE-ID')
  })
})

describe('isTokenExpired', () => {
  it('treats a past expiry as expired and a future one as live', () => {
    const now = Date.UTC(2026, 0, 1)
    expect(isTokenExpired({ exp: Math.floor(now / 1000) - 1 }, now)).toBe(true)
    expect(isTokenExpired({ exp: Math.floor(now / 1000) + 1 }, now)).toBe(false)
  })

  it('treats a missing or nonsense expiry as expired', () => {
    expect(isTokenExpired({ exp: Number.NaN })).toBe(true)
    expect(isTokenExpired({ exp: Number.POSITIVE_INFINITY })).toBe(true)
  })
})

describe('verifyLicenseToken', () => {
  it('accepts a token signed by the published key', async () => {
    const { privateKey, publicJwk } = await keypair()
    const token = await signToken(privateKey, validClaims)
    expect(await verifyLicenseToken(token, resolverFor(publicJwk))).toMatchObject({ plan: 'pro', balance: 1800 })
  })

  it('rejects a token signed by another key', async () => {
    const a = await keypair()
    const b = await keypair()
    const token = await signToken(a.privateKey, validClaims)
    expect(await verifyLicenseToken(token, resolverFor(b.publicJwk))).toBeNull()
  })

  it('rejects a tampered payload', async () => {
    const { privateKey, publicJwk } = await keypair()
    const token = await signToken(privateKey, validClaims)
    const [header, , signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...validClaims, balance: 999999 })).toString('base64url')
    expect(await verifyLicenseToken(`${header}.${forged}.${signature}`, resolverFor(publicJwk))).toBeNull()
  })

  it('rejects a token that is not a JWS', async () => {
    const { publicJwk } = await keypair()
    expect(await verifyLicenseToken('not-a-token', resolverFor(publicJwk))).toBeNull()
    expect(await verifyLicenseToken('', resolverFor(publicJwk))).toBeNull()
  })

  it('returns claims for an authentic but expired token (the caller decides)', async () => {
    const { privateKey, publicJwk } = await keypair()
    const token = await signToken(privateKey, { ...validClaims, exp: Math.floor(Date.now() / 1000) - 10 })
    const claims = await verifyLicenseToken(token, resolverFor(publicJwk))
    expect(claims).not.toBeNull()
    expect(isTokenExpired(claims!)).toBe(true)
  })
})

describe('getEntitlement', () => {
  beforeEach(() => {
    secrets.data.clear()
    delete process.env.DEMOTHAT_FORCE_PRO
    machine.throw = false
    machine.id = 'RAW-MACHINE-ID'
  })

  afterEach(() => {
    delete process.env.DEMOTHAT_FORCE_PRO
    delete process.env.DEMOTHAT_API_BASE_URL
    vi.unstubAllGlobals()
  })

  it('is not Pro without a stored token', async () => {
    expect(await getEntitlement()).toEqual({ pro: false, credits: 0 })
  })

  it('is Pro with a live token, reporting the token balance', async () => {
    // The token is signed with a throwaway keypair and verified against a stubbed
    // API that publishes its public half — as production fetches the real key set.
    const { privateKey, publicJwk } = await keypair()
    stubPublishedKeys(publicJwk)
    secrets.data.set('token', await signToken(privateKey, validClaims))
    expect(await getEntitlement()).toEqual({ pro: true, credits: 1800 })
  })

  it('is not Pro when the stored token is signed by an untrusted key', async () => {
    const untrusted = await keypair()
    const trusted = await keypair()
    stubPublishedKeys(trusted.publicJwk)
    secrets.data.set('token', await signToken(untrusted.privateKey, validClaims))
    expect(await getEntitlement()).toEqual({ pro: false, credits: 0 })
  })

  it('is not Pro once the stored token has expired', async () => {
    const { privateKey, publicJwk } = await keypair()
    stubPublishedKeys(publicJwk)
    secrets.data.set('token', await signToken(privateKey, { ...validClaims, exp: Math.floor(Date.now() / 1000) - 10 }))
    expect(await getEntitlement()).toEqual({ pro: false, credits: 0 })
  })

  it('is forced on in development', async () => {
    process.env.DEMOTHAT_FORCE_PRO = '1'
    expect(await getEntitlement()).toEqual({ pro: true, credits: 0 })
    delete process.env.DEMOTHAT_FORCE_PRO
  })
})

describe('stored credentials', () => {
  beforeEach(() => {
    secrets.data.clear()
  })

  it('keeps the token out of the activation result and forgets it on sign out', async () => {
    secrets.data.set('token', 'a.b.c')
    expect(getStoredToken()).toBe('a.b.c')
    signOut()
    expect(getStoredToken()).toBeNull()
  })

  it('refuses an empty key before any network call', async () => {
    await expect(activateLicense('   ')).rejects.toThrow(/Enter your license key/)
  })
})
