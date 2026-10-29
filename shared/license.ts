// License and credit types shared by the main process and the renderer.
//
// The shapes mirror `contract/openapi.yaml` (DeviceView, LicenseView). They live
// in `shared/` so both bundles resolve the same definitions.

/** A device activated against a license (contract: DeviceView). */
export interface DeviceView {
  id: string
  label: string
  platform: string
  active: boolean
  activatedAt: string
  lastSeenAt: string
  /** True for the device making the request. */
  current: boolean
}

/** What the renderer needs to render the credit capsule and the devices dialog. */
export interface LicenseSummary {
  /** Plan name, or null when this device has no activation. */
  plan: string | null
  balance: number
  devices: DeviceView[]
}

/** How the balance should read in the header. */
export type CreditStatus = 'normal' | 'low' | 'empty'

/**
 * At or below this balance the capsule shows "Low" and the Buy segment takes
 * the accent fill (DESIGN reference §1). One constant, so the main process and
 * the renderer cannot disagree.
 */
export const LOW_CREDIT_THRESHOLD = 100

/** Maps a balance to its display state. Pure, so it is unit tested directly. */
export function creditStatus(balance: number, threshold = LOW_CREDIT_THRESHOLD): CreditStatus {
  if (!(balance > 0)) return 'empty'
  return balance <= threshold ? 'low' : 'normal'
}

/** Thousands-separated credits, as the header and the dialogs show them. */
export function formatCredits(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
  return safe.toLocaleString('en-US')
}

/**
 * A licence activates on up to this many devices (SHARED_SPEC §0.2). The API is
 * the enforcement point; this constant only fills in "3 of 10 in use".
 */
export const DEVICE_ACTIVATION_LIMIT = 10

/** Active devices on a licence, i.e. the number of slots currently used. */
export function devicesInUse(devices: DeviceView[]): number {
  return devices.filter((device) => device.active).length
}

/** Outcome of an activation attempt, as it crosses IPC. */
export type ActivationResult =
  | { ok: true; plan: string; balance: number; devices: DeviceView[] }
  | { ok: false; code: string; message: string; devices?: DeviceView[] }

/** Outcome of a device deactivation, as it crosses IPC. */
export type DeactivationResult = { ok: true; devices: DeviceView[] } | { ok: false; message: string }

/** Display name for a capabilities target key ("8k" → "8K"). */
export function targetLabel(targetKey: string): string {
  return targetKey.toUpperCase()
}

/**
 * How many minutes of a target a number of credits buys, straight from the
 * server's `creditsPerFrame` table. Null when the table does not cover the
 * target (better to show nothing than to invent a number).
 */
export function packMinutes(
  credits: number,
  creditsPerFrame: Record<string, number> | undefined,
  targetKey: string,
  fps: number,
): number | null {
  const rate = creditsPerFrame?.[targetKey]
  if (typeof rate !== 'number' || rate <= 0 || fps <= 0 || credits <= 0) return null
  return credits / rate / (fps * 60)
}

/** "About 9 min of 8K", or null when the capabilities cannot say. */
export function packNote(
  credits: number,
  creditsPerFrame: Record<string, number> | undefined,
  targetKey: string,
  fps: number,
): string | null {
  const minutes = packMinutes(credits, creditsPerFrame, targetKey, fps)
  if (minutes == null) return null
  const rounded = Math.max(1, Math.round(minutes))
  return `About ${rounded} min of ${targetLabel(targetKey)}`
}

/** Result of asking the main process to start a purchase. */
export type CheckoutStartResult =
  { ok: true; purchaseId: string; checkoutUrl: string } | { ok: false; code: string; message: string }

/** Status pushed to the renderer while a purchase is being watched. */
export type PurchaseEvent =
  | { kind: 'pending' }
  | { kind: 'cancelled' }
  | { kind: 'succeeded'; balance: number; firstPurchase: boolean }
  | { kind: 'failed'; message: string }
  | { kind: 'timeout' }
  | { kind: 'device_limit_reached'; message: string; devices: DeviceView[]; licenseKey: string }
