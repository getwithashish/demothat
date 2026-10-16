// The cancellation flag of the cloud work currently in flight.
//
// A cloud export can be cancelled from two places — the export modal (which also
// owns the local render) and the cloud retry/resume dialogs — and by the time a
// job is upscaling, the export path's `export:cancel` listener has already been
// torn down. One registered flag, reachable from both, keeps Cancel working at
// every stage.

import type { CloudCancellation } from './cloud-client'

let current: CloudCancellation | null = null

/** Publishes the flag that Cancel should flip. */
export function registerCloudCancellation(cancel: CloudCancellation): void {
  current = cancel
}

/** Clears it, but only if it is still the registered one. */
export function clearCloudCancellation(cancel?: CloudCancellation): void {
  if (!cancel || current === cancel) current = null
}

/** Flips the flag. Returns false when nothing cloud-side is running. */
export function cancelActiveCloudWork(): boolean {
  if (!current) return false
  current.cancelled = true
  return true
}
