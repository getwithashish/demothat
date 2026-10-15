// Local entitlement ("Pro") check.
//
// HONEST NOTE: this app is GPL-3.0. Anyone can rebuild it with this file
// removed or patched, so this local gate is a *soft convenience*, not a
// security boundary. Only the cloud path (Phase 5) can actually enforce
// payment, because the server checks credits before doing any work.

import Store from 'electron-store'
import log from 'electron-log/main'

export interface Entitlement {
  pro: boolean
  credits: number
}

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
 * Reads the stored licence key and verifies it. Development escape hatch:
 * `DEMOTHAT_FORCE_PRO=1` unlocks everything without a key.
 */
export async function getEntitlement(): Promise<Entitlement> {
  if (process.env.DEMOTHAT_FORCE_PRO === '1' || process.env.DEMOTHAT_FORCE_PRO === 'true') {
    return { pro: true, credits: 0 }
  }

  const key = store.get(LICENSE_KEY_SETTING)
  if (typeof key !== 'string' || !key.trim()) return { pro: false, credits: 0 }

  return verifyLicenseKey(key.trim())
}

/**
 * TODO: replace this with real verification — a signed licence checked against
 * an embedded public key, or a call to the licensing server. It is deliberately
 * a shape check so the UI can be built and tested without a backend.
 */
async function verifyLicenseKey(key: string): Promise<Entitlement> {
  log.info('[Entitlement] Using the placeholder licence check (no backend yet).')
  return { pro: key.startsWith('DEMO-PRO-'), credits: 0 }
}
