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

/** One credit pack as the Buy credits dialog offers it. */
export interface CreditPack {
  /**
   * Dodo product id. The API maps it to the credits and price in its own
   * server-side `PRODUCTS` table — the numbers here are display only.
   */
  productId: string
  label: string
  credits: number
  /** Display-only price in USD. */
  priceUsd: number
}

/**
 * The packs the app offers.
 *
 * TODO(owner): replace the placeholder product ids with the real Dodo product
 * ids, and keep the credit amounts in step with `PRODUCTS` in demothat-api. The
 * server is the source of truth: it ignores anything here that disagrees.
 *
 * Packs only: the owner has dropped the design's custom-amount field and slider,
 * because the contract prices a purchase from the server-side product table and
 * an arbitrary amount is not purchasable without a new contract route.
 */
export const CREDIT_PACKS: CreditPack[] = [
  { productId: 'pdt_pro_1800', label: 'Pro', credits: 1800, priceUsd: 3 },
  { productId: 'pdt_topup_5400', label: 'Top-up', credits: 5400, priceUsd: 9 },
  { productId: 'pdt_topup_9000', label: 'Top-up', credits: 9000, priceUsd: 15 },
]

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
