// Configuration constants for the demothat-api backend.
//
// This is the single place the app learns *where* the backend is and *which*
// hosts it may open. Nothing here is a server secret: the API base URL and the
// checkout host allowlist are public values that ship inside the bundle, and the
// key tokens are verified against is not here at all — the app fetches it from the
// API it is pointed at (lib/license-keys.ts). Server secrets (Dodo API key, worker
// secret, JWT signing key) live only in the API repo's environment and never reach
// the app.

/** Production API host. Overridable for local development. */
export const DEFAULT_API_BASE_URL = 'https://api.demothat.yahodu.in'

/**
 * The API base URL, honouring `DEMOTHAT_API_BASE_URL` so the app can be pointed
 * at a local mock server (scripts/mock-api-server.mjs) during development.
 */
export function getApiBaseUrl(): string {
  const override = process.env.DEMOTHAT_API_BASE_URL
  if (typeof override === 'string' && override.trim()) return override.trim().replace(/\/+$/, '')
  return DEFAULT_API_BASE_URL
}

/**
 * Dodo Payments checkout hosts. `POST /v1/checkout` returns a `checkoutUrl` that
 * the app opens in the system browser; anything outside this list is refused, so
 * a compromised or mistaken API response cannot send the user somewhere else.
 */
export const CHECKOUT_HOST_ALLOWLIST = [
  'checkout.dodopayments.com',
  'test.checkout.dodopayments.com',
  'checkout.dodopayments.tech',
]

/**
 * True when `raw` is an https URL on an allow-listed checkout host. Pure, so it
 * is unit tested (C5) without Electron.
 */
export function isAllowedCheckoutUrl(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.trim().length === 0) return false
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  return CHECKOUT_HOST_ALLOWLIST.includes(url.hostname.toLowerCase())
}

/**
 * EdDSA (Ed25519) is the algorithm the API signs license tokens with. The key itself
 * is no longer part of this bundle: the app fetches it from
 * `GET /.well-known/jwks.json` on the API it is configured with (lib/license-keys.ts),
 * so a build carries no key for one particular environment and a rotation needs no
 * release.
 *
 * Pinning the algorithm still matters — it blocks algorithm confusion, where a token
 * arrives claiming a weaker `alg` than the key actually is.
 */
export const LICENSE_TOKEN_ALGORITHM = 'EdDSA'

/**
 * Salt mixed into the machine identifier before hashing. The raw machine id is
 * never sent anywhere; only `sha256(salt + ":" + machineId)` leaves the app.
 */
export const DEVICE_ID_SALT = 'demothat-device-v1'
