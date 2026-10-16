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
 * NOTE: the design reference (§2) also offers a "choose your own amount" field
 * and slider. The contract only accepts a product id from the server-side
 * table, so arbitrary amounts are not purchasable without adding a contract
 * route first — packs only, for now.
 */
export const CREDIT_PACKS: CreditPack[] = [
  { productId: 'pdt_pro_1800', label: 'Pro', credits: 1800, priceUsd: 3 },
  { productId: 'pdt_topup_5400', label: 'Top-up', credits: 5400, priceUsd: 9 },
  { productId: 'pdt_topup_9000', label: 'Top-up', credits: 9000, priceUsd: 15 },
]

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
