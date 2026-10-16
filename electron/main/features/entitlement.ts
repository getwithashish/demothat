// Local entitlement ("Pro") check.
//
// HONEST NOTE: this app is GPL-3.0. Anyone can rebuild it with this file
// removed or patched, so this local gate is a *soft convenience*, not a
// security boundary. Only the cloud path can actually enforce payment, because
// the server checks credits before doing any work.
//
// The real check lives in features/license-client.ts (token verification against
// the embedded public key); this module keeps the small surface the export modal
// already uses and owns the "Unlock Pro" URL.

import Store from 'electron-store'
import { getEntitlement as getLicenseEntitlement, type Entitlement } from './license-client'

export type { Entitlement }

const LICENSE_KEY_SETTING = 'pro.licenseKey'
const UNLOCK_URL_SETTING = 'pro.unlockUrl'
const DEFAULT_UNLOCK_URL = 'https://demothat.app/pro'

const store = new Store()

/** Where the export modal's "Unlock Pro" action sends the user. */
export function getUnlockUrl(): string {
  const configured = store.get(UNLOCK_URL_SETTING)
  if (typeof configured === 'string' && configured.trim()) return configured.trim()
  const fromEnv = process.env.DEMOTHAT_UNLOCK_URL
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim()
  return DEFAULT_UNLOCK_URL
}

/**
 * Whether this device is Pro, and the balance it knows about. Development escape
 * hatch: `DEMOTHAT_FORCE_PRO=1` unlocks everything without a key.
 */
export async function getEntitlement(): Promise<Entitlement> {
  return getLicenseEntitlement()
}

/**
 * The legacy plaintext setting is no longer written to. It is cleared on read so
 * an old install does not keep a license key lying around in electron-store.
 */
export function clearLegacyLicenseKeySetting(): void {
  if (store.get(LICENSE_KEY_SETTING) !== undefined) store.delete(LICENSE_KEY_SETTING)
}
