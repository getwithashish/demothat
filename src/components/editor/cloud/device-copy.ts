// Copy for the devices surfaces, kept out of the component files so React Fast
// Refresh stays happy (a module must export only components to hot-reload).

import { DEVICE_ACTIVATION_LIMIT, devicesInUse, type DeviceView } from '../../../../shared/license'

/** "3 of 10 in use. Deactivate one to free a slot." */
export function devicesSubtitle(devices: DeviceView[]): string {
  return `${devicesInUse(devices)} of ${DEVICE_ACTIVATION_LIMIT} in use. Deactivate one to free a slot.`
}

/** "Last used 2 days ago", from an ISO timestamp. Pure, so it is unit tested. */
export function formatLastUsed(iso: string, now: number = Date.now()): string {
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return 'Last used recently'
  const minutes = Math.floor(Math.max(0, now - parsed) / 60_000)
  if (minutes < 2) return 'Last used just now'
  if (minutes < 60) return `Last used ${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Last used ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `Last used ${days} ${days === 1 ? 'day' : 'days'} ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `Last used ${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`
  const months = Math.max(1, Math.floor(days / 30))
  return `Last used ${months} ${months === 1 ? 'month' : 'months'} ago`
}
