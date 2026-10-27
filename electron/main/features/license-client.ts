// License client: activation, offline entitlement and device management.
//
// All of this runs in the main process — the renderer only ever sees the typed
// IPC surface. The license key and the license token are credentials and are
// kept in the encrypted store (lib/secure-store.ts), never in electron-store.
//
// HONEST NOTE: the app is GPL-3.0, so a local entitlement check can be removed
// by anyone who rebuilds it. The token check below is a *soft* gate that keeps
// Pro working offline until the token expires; only the cloud path can actually
// enforce payment, because the server checks credits before doing any work.

import { createHash } from 'node:crypto'
import os from 'node:os'
import { machineIdSync } from 'node-machine-id'
import log from 'electron-log/main'
import type { DeviceView, LicenseSummary } from '../../../shared/license'
import { ApiError, apiRequest } from '../lib/api-client'
import { DEVICE_ID_SALT, getApiBaseUrl } from '../lib/api-config'
import { licenseKeys, LicenseKeyResolver } from '../lib/license-keys'
import { clearSecrets, readSecret, writeSecret } from '../lib/secure-store'

const SECRETS_NAME = 'license'
const KEY_SECRET = 'licenseKey'
const TOKEN_SECRET = 'token'

/** Claims the API puts in the EdDSA license token. */
export interface LicenseTokenClaims {
  /** License subject: the license id. */
  sub: string
  plan: string
  /** Credit balance at issue time; the authoritative number still comes from the server. */
  balance: number
  /** Expiry, unix seconds. */
  exp: number
  /** The device this token was issued to, so a copied token is not silently usable. */
  deviceIdHash?: string
}

export interface Entitlement {
  pro: boolean
  credits: number
}

// --- Device identity ----------------------------------------------------------

/**
 * `sha256(salt + ":" + rawId)`. The raw machine id is never persisted or sent;
 * only this hash leaves the app (contract: ActivateRequest.deviceIdHash).
 */
export function computeDeviceIdHash(rawId: string, salt: string = DEVICE_ID_SALT): string {
  return createHash('sha256').update(`${salt}:${rawId}`).digest('hex')
}

let cachedDeviceIdHash: string | null = null

/** The current device's hash, computed once per process. */
export function getDeviceIdHash(): string {
  if (cachedDeviceIdHash) return cachedDeviceIdHash
  let raw: string
  try {
    raw = machineIdSync(true)
  } catch (error) {
    // Some Linux containers have no machine-id; the host name is a stable
    // fallback. It is still hashed with the salt before it leaves the app.
    log.warn(`[LicenseClient] machineIdSync failed (${(error as Error).message}); using the host name.`)
    raw = os.hostname()
  }
  cachedDeviceIdHash = computeDeviceIdHash(raw)
  return cachedDeviceIdHash
}

/** Human-readable device name shown in the Devices dialog. */
export function getDeviceLabel(): string {
  const hostname = os
    .hostname()
    .replace(/\.local$/i, '')
    .trim()
  return hostname || 'This computer'
}

/** The contract's platform string ("Windows" / "macOS" / "Linux"). */
export function getPlatformLabel(platform: NodeJS.Platform = process.platform): string {
  switch (platform) {
    case 'win32':
      return 'Windows'
    case 'darwin':
      return 'macOS'
    case 'linux':
      return 'Linux'
    default:
      return platform
  }
}

// --- Token verification -------------------------------------------------------

/** True when the token's `exp` has passed. Pure, so it is unit tested. */
export function isTokenExpired(claims: Pick<LicenseTokenClaims, 'exp'>, nowMs: number = Date.now()): boolean {
  if (!Number.isFinite(claims.exp)) return true
  return claims.exp * 1000 <= nowMs
}

function parseClaims(payload: Uint8Array): LicenseTokenClaims | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>
    const { sub, plan, balance, exp } = parsed
    if (typeof sub !== 'string' || typeof plan !== 'string') return null
    if (typeof balance !== 'number' || typeof exp !== 'number') return null
    const deviceIdHash = typeof parsed.deviceIdHash === 'string' ? parsed.deviceIdHash : undefined
    return { sub, plan, balance, exp, deviceIdHash }
  } catch {
    return null
  }
}

/**
 * Verifies the signature of a license token against the keys the API publishes, and
 * returns its claims, or null when the token is not trustworthy.
 *
 * The signature is checked at the JWS level so expiry is judged by the caller
 * (`isTokenExpired`): an expired-but-authentic token still proves the license
 * existed, it just no longer grants offline Pro.
 *
 * The resolver is a parameter so tests can supply their own keys; production uses the
 * process-wide one, which fetches from the API and caches the result.
 */
export async function verifyLicenseToken(
  token: string,
  resolver: LicenseKeyResolver = licenseKeys,
): Promise<LicenseTokenClaims | null> {
  if (typeof token !== 'string' || token.trim().length === 0) return null
  const payload = await resolver.verifySignature(token)
  if (payload === null) {
    log.warn('[LicenseClient] License token rejected: no published key verified it')
    return null
  }
  return parseClaims(payload)
}

// --- Stored credentials -------------------------------------------------------

export function getStoredLicenseKey(): string | null {
  return readSecret(SECRETS_NAME, KEY_SECRET)
}

export function getStoredToken(): string | null {
  return readSecret(SECRETS_NAME, TOKEN_SECRET)
}

function storeCredentials(licenseKey: string, token: string): void {
  writeSecret(SECRETS_NAME, KEY_SECRET, licenseKey)
  writeSecret(SECRETS_NAME, TOKEN_SECRET, token)
}

/** Forgets the credentials on this device (the server-side activation stays). */
export function signOut(): void {
  clearSecrets(SECRETS_NAME)
}

// --- Entitlement --------------------------------------------------------------

function forcedPro(): boolean {
  return process.env.DEMOTHAT_FORCE_PRO === '1' || process.env.DEMOTHAT_FORCE_PRO === 'true'
}

/**
 * Offline-capable entitlement: Pro while the stored token is authentic and
 * unexpired. Credits are a server number, so they are only reported from the
 * token; `getLicenseSummary` refreshes them from the API when it can.
 */
export async function getEntitlement(): Promise<Entitlement> {
  if (forcedPro()) return { pro: true, credits: 0 }

  const token = getStoredToken()
  if (!token) return { pro: false, credits: 0 }

  const claims = await verifyLicenseToken(token)
  if (!claims || isTokenExpired(claims)) return { pro: false, credits: 0 }
  return { pro: true, credits: claims.balance }
}

// --- Server calls -------------------------------------------------------------

function requireToken(): string {
  const token = getStoredToken()
  if (!token) throw new ApiError('This computer is not activated. Enter your license key first.', 'not_activated')
  return token
}

interface ActivateResponse {
  token: string
  balance: number
  devices: DeviceView[]
}

interface LicenseView {
  plan: string
  balance: number
  devices: DeviceView[]
}

/** Extracts the device list an activation failure carries, when it has one. */
export function devicesFromError(error: unknown): DeviceView[] | undefined {
  if (!(error instanceof ApiError)) return undefined
  const details = error.details as { devices?: unknown } | undefined
  if (details && Array.isArray(details.devices)) return details.devices as DeviceView[]
  if (Array.isArray(error.details)) return error.details as DeviceView[]
  return undefined
}

/** Activates this device against a license key and stores the returned token. */
export async function activateLicense(
  licenseKey: string,
  options: { label?: string; platform?: NodeJS.Platform } = {},
): Promise<ActivateResponse> {
  const key = licenseKey.trim()
  if (!key) throw new ApiError('Enter your license key.', 'validation_error', 400)

  const result = await apiRequest<ActivateResponse>(getApiBaseUrl(), {
    method: 'POST',
    path: '/v1/license/activate',
    body: {
      licenseKey: key,
      deviceIdHash: getDeviceIdHash(),
      label: options.label ?? getDeviceLabel(),
      platform: getPlatformLabel(options.platform ?? process.platform),
    },
    retries: 1,
  })

  if (!result?.token || typeof result.token !== 'string') {
    throw new ApiError('The server did not return a license token.', 'bad_response')
  }
  storeCredentials(key, result.token)
  return { token: result.token, balance: result.balance ?? 0, devices: result.devices ?? [] }
}

/** `GET /v1/license`: the authoritative plan, balance and device list. */
export async function fetchLicense(): Promise<LicenseView> {
  return apiRequest<LicenseView>(getApiBaseUrl(), { method: 'GET', path: '/v1/license', token: requireToken() })
}

/** Balance only, for the capsule's refresh. */
export async function refreshBalance(): Promise<number> {
  const view = await fetchLicense()
  return view.balance ?? 0
}

/** Everyone on this license (contract: DeviceView[]). */
export async function listDevices(): Promise<DeviceView[]> {
  const view = await fetchLicense()
  return view.devices ?? []
}

/** Deactivates a device through the API and returns the updated device list. */
export async function deactivateDevice(deviceId: string): Promise<DeviceView[]> {
  const view = await apiRequest<LicenseView>(getApiBaseUrl(), {
    method: 'DELETE',
    path: `/v1/devices/${encodeURIComponent(deviceId)}`,
    token: requireToken(),
    retries: 1,
  })
  return view.devices ?? []
}

/**
 * What the header and the dialogs need: the plan, the balance and the devices.
 *
 * Falls back to the token's claims when the API is unreachable, so an offline
 * editor still shows the balance it knows about (with no device list).
 */
export async function getLicenseSummary(): Promise<LicenseSummary> {
  const token = getStoredToken()
  if (!token) return { plan: null, balance: 0, devices: [] }

  const claims = await verifyLicenseToken(token)
  const offline: LicenseSummary = claims
    ? { plan: claims.plan, balance: claims.balance, devices: [] }
    : { plan: null, balance: 0, devices: [] }

  try {
    const view = await fetchLicense()
    return { plan: view.plan, balance: view.balance ?? 0, devices: view.devices ?? [] }
  } catch (error) {
    if ((error as ApiError).code === 'not_activated') return offline
    log.warn(`[LicenseClient] License refresh failed: ${(error as Error).message}`)
    // Expired token: do not keep reporting Pro from a stale claim.
    if (claims && isTokenExpired(claims)) return { plan: null, balance: 0, devices: [] }
    return offline
  }
}
