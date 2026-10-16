// Configuration constants for the demothat-api backend.
//
// This is the single place the app learns *where* the backend is and *which*
// hosts it may open. Nothing here is a server secret: the API base URL, the
// checkout host allowlist and the EdDSA public key are all public values that
// ship inside the bundle. Server secrets (Dodo API key, worker secret, JWT
// signing key) live only in the API repo's environment and never reach the app.

/** Production API host. Overridable for local development. */
export const DEFAULT_API_BASE_URL = 'https://api.demothat.app'

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
 * EdDSA (Ed25519) public key for the license token issued by
 * `POST /v1/license/activate`. The app verifies tokens locally so Pro keeps
 * working offline until the token expires.
 *
 * TODO(owner): replace this development key with the production public key
 * before release. Rotating it only requires re-vendoring this constant; the
 * private key stays in the API deployment.
 */
export const LICENSE_TOKEN_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEALiP2zcxtuHj63ldcMHEZMu3B9AVdd93wooPE62V3IkA=
-----END PUBLIC KEY-----`

/**
 * The key the app verifies tokens with: the embedded one, unless a development
 * override is set. `DEMOTHAT_LICENSE_PUBLIC_KEY` exists so a dev build can point
 * at the mock server's throwaway signing key without editing this file; it is
 * never set in a release build.
 */
export function getLicensePublicKeyPem(): string {
  const override = process.env.DEMOTHAT_LICENSE_PUBLIC_KEY
  if (typeof override === 'string' && override.includes('BEGIN PUBLIC KEY')) return override
  return LICENSE_TOKEN_PUBLIC_KEY_PEM
}

/**
 * Salt mixed into the machine identifier before hashing. The raw machine id is
 * never sent anywhere; only `sha256(salt + ":" + machineId)` leaves the app.
 */
export const DEVICE_ID_SALT = 'demothat-device-v1'

/** License tokens are EdDSA; pinning the algorithm blocks algorithm confusion. */
export const LICENSE_TOKEN_ALGORITHM = 'EdDSA'
