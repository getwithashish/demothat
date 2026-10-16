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
