// The device list, shared by the Devices dialog and the capsule's hover card.
//
// Design reference (docs/design/cloud-ui-variants.html §4): one row per device,
// the current one marked "This device", and Deactivate inline in the row with no
// second dialog.

import { Button } from '../../ui/button'
import { cn } from '../../../lib/utils'
import type { DeviceView } from '../../../../shared/license'
import { formatLastUsed } from './device-copy'

export interface DevicesListProps {
  devices: DeviceView[]
  onDeactivate: (deviceId: string) => void
  /** True while a deactivation is in flight. */
  busy?: boolean
  /** Shown under the list when a deactivation failed. */
  error?: string | null
  className?: string
}

export function DevicesList({ devices, onDeactivate, busy, error, className }: DevicesListProps) {
  if (devices.length === 0) {
    return <p className={cn('text-sm text-muted', className)}>No devices are listed for this license yet.</p>
  }

  return (
    <div className={className}>
      <ul>
        {devices.map((device) => (
          <li
            key={device.id}
            className="flex items-center justify-between gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0 last:pb-0"
          >
            <span className="min-w-0">
              <span className="block truncate text-ui text-fg">{`${device.label}, ${device.platform}`}</span>
              <small className="block text-sm text-muted">
                {device.current ? 'This device' : formatLastUsed(device.lastSeenAt)}
              </small>
            </span>
            {!device.current && device.active && (
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => onDeactivate(device.id)}
                aria-label={`Deactivate ${device.label}`}
              >
                Deactivate
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  )
}
