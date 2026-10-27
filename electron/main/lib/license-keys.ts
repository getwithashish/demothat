// Resolving the license signing key from the API, instead of embedding it.
//
// The app used to carry a copy of the API's EdDSA public key, which meant one build
// could only ever be right for one environment: a development build verified
// development tokens, and a release had to be cut with the production key baked in.
// That also made a key rotation an app release.
//
// The API publishes the key at `GET /.well-known/jwks.json`, so the app fetches it
// from the API it is already pointed at. One keypair per environment, nothing in the
// source tree, and a rotation the app can pick up without a restart or a release.
//
// Lookup order for the key set: memory, then the last set written to disk, then the
// network. The set is public — an SPKI public key cannot sign anything — so caching it
// is free, and losing the cache only means an activation needs to be online.

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { compactVerify, importJWK, type JWK } from 'jose'
import log from 'electron-log/main'
import { LICENSE_TOKEN_ALGORITHM, getApiBaseUrl } from './api-config'

/** One key set as it is cached: the API it came from, when it was fetched, and the keys themselves. */
interface CachedKeySet {
  url: string
  fetchedAt: number
  keys: JWK[]
}

export interface LicenseKeyResolverOptions {
  /** Where the API lives. Defaults to the configured base URL, like every other call. */
  apiBaseUrl?: () => string
  fetchImpl?: typeof fetch
  /** Cache overrides, so the resolver can be tested without Electron or the disk. */
  readCache?: (url: string) => string | null
  writeCache?: (value: string) => void
  now?: () => number
  /** How long a fetched set is trusted before it is refreshed. One hour. */
  ttlMs?: number
}

const DEFAULT_TTL_MS = 60 * 60 * 1000

let memoisedCachePath: string | null = null

/**
 * Where the last good key set is kept. Resolved lazily: `app.getPath` is only
 * meaningful once Electron has started, and this module is imported at startup.
 */
function cacheFilePath(): string {
  memoisedCachePath ??= path.join(app.getPath('userData'), 'license-keys.json')
  return memoisedCachePath
}

/** Reads a key set from the API. Throws when it cannot, so the caller can fall back. */
async function fetchKeySet(apiBaseUrl: string, fetchImpl: typeof fetch): Promise<JWK[]> {
  const response = await fetchImpl(`${apiBaseUrl}/.well-known/jwks.json`, {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`the key set request returned ${response.status}`)
  const body = (await response.json()) as { keys?: unknown }
  if (!Array.isArray(body.keys)) throw new Error('the key set response is malformed')
  return body.keys as JWK[]
}

/**
 * Resolves the keys the license token is verified against.
 *
 * A failure to reach the API is not fatal: the last good set is used instead, because
 * a token issued minutes ago should still verify on a flaky connection. Nothing here
 * ever treats "no key available" as "the licence is invalid" — the caller decides, and
 * the two cases are different.
 */
export class LicenseKeyResolver {
  private readonly options: LicenseKeyResolverOptions
  private memory: CachedKeySet | null = null

  constructor(options: LicenseKeyResolverOptions = {}) {
    this.options = options
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now()
  }

  private readCache(url: string): CachedKeySet | null {
    const raw = this.options.readCache
      ? this.options.readCache(url)
      : ((): string | null => {
          try {
            return fs.readFileSync(cacheFilePath(), 'utf8')
          } catch {
            return null
          }
        })()
    if (raw === null) return null
    try {
      const parsed = JSON.parse(raw) as CachedKeySet
      if (!parsed || !Array.isArray(parsed.keys) || typeof parsed.fetchedAt !== 'number') return null
      // A set cached for a different API is not this API's set: ignore it rather
      // than verify a token against keys from another environment.
      if (parsed.url !== url) return null
      return parsed
    } catch {
      return null
    }
  }

  private writeCache(value: CachedKeySet): void {
    const serialised = JSON.stringify(value)
    if (this.options.writeCache) {
      this.options.writeCache(serialised)
      return
    }
    // Best effort: a cache that cannot be written costs a network round trip, nothing more.
    try {
      const file = cacheFilePath()
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, serialised)
    } catch (error) {
      log.warn(`[LicenseKeys] Could not cache the key set: ${(error as Error).message}`)
    }
  }

  /**
   * The key set: from memory while it is fresh, otherwise fetched — and from the cache
   * when the fetch fails.
   */
  async keys(options: { refresh?: boolean } = {}): Promise<JWK[]> {
    const url = this.options.apiBaseUrl ? this.options.apiBaseUrl() : getApiBaseUrl()
    const now = this.now()
    const ttl = this.options.ttlMs ?? DEFAULT_TTL_MS
    if (!options.refresh && this.memory !== null && this.memory.url === url && now - this.memory.fetchedAt < ttl) {
      return this.memory.keys
    }

    try {
      const keys = await fetchKeySet(url, this.options.fetchImpl ?? fetch)
      const fresh = { url, fetchedAt: now, keys }
      this.memory = fresh
      this.writeCache(fresh)
      return keys
    } catch (error) {
      log.warn(`[LicenseKeys] Could not fetch the license key set: ${(error as Error).message}`)
      const cached = this.memory?.url === url ? this.memory : this.readCache(url)
      if (cached !== null) {
        this.memory = cached
        return cached.keys
      }
      return []
    }
  }

  /**
   * Verify a compact JWS against the published keys, returning its payload.
   *
   * A failure against the cached keys is retried once against a freshly fetched set.
   * That is the rotation path: the app notices a new key immediately, without a
   * restart and without waiting for the cache to expire.
   */
  async verifySignature(token: string): Promise<Uint8Array | null> {
    const attempt = async (keys: JWK[]): Promise<Uint8Array | null> => {
      for (const key of keys) {
        try {
          const imported = await importJWK(key, LICENSE_TOKEN_ALGORITHM)
          const { payload } = await compactVerify(token, imported, {
            algorithms: [LICENSE_TOKEN_ALGORITHM],
          })
          return payload
        } catch {
          // A key that does not verify this token is not an error: the next one may.
        }
      }
      return null
    }

    const first = await attempt(await this.keys())
    if (first !== null) return first
    return await attempt(await this.keys({ refresh: true }))
  }
}

/**
 * The process-wide resolver. One instance so the memory cache is shared by every
 * caller, and so a rotation is noticed once rather than per call site.
 */
export const licenseKeys = new LicenseKeyResolver()
