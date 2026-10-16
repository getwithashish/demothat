// IPC for license activation, the credit balance and device management.
//
// The renderer never sees the license key or the token; it asks for a summary
// and gets plain data back.

import { ipcMain } from 'electron'
import type { ActivationResult, DeactivationResult, DeviceView, LicenseSummary } from '../../../../shared/license'
import { ApiError } from '../../lib/api-client'
import {
  activateLicense,
  deactivateDevice,
  devicesFromError,
  getLicenseSummary,
  listDevices,
} from '../../features/license-client'

/** Failures the renderer shows verbatim, keyed by the API's error code. */
const FRIENDLY_MESSAGES: Record<string, string> = {
  not_found: "This key wasn't recognised. Check for missing characters and try again.",
  validation_error: "This key wasn't recognised. Check for missing characters and try again.",
  license_revoked: 'This license has been revoked. Contact support if you think that is wrong.',
  device_limit_reached: 'This license has no free device slots. Deactivate one to activate this computer.',
  too_many_requests: 'Too many activation attempts. Wait a moment and try again.',
  not_activated: 'This computer is not activated.',
}

function friendlyMessage(error: unknown): { code: string; message: string } {
  if (error instanceof ApiError) {
    return { code: error.code, message: FRIENDLY_MESSAGES[error.code] ?? error.message }
  }
  if (error instanceof Error) return { code: 'unknown', message: error.message }
  return { code: 'unknown', message: 'Something went wrong.' }
}

/** Plan, balance and devices for the header and the Devices dialog. */
export function handleLicenseSummary(): Promise<LicenseSummary> {
  return getLicenseSummary()
}

/** Activates this device against a license key. */
export async function handleLicenseActivate(_event: unknown, licenseKey: unknown): Promise<ActivationResult> {
  if (typeof licenseKey !== 'string') {
    return { ok: false, code: 'validation_error', message: 'Enter your license key.' }
  }
  try {
    const result = await activateLicense(licenseKey)
    const summary = await getLicenseSummary()
    return {
      ok: true,
      plan: summary.plan ?? 'pro',
      balance: result.balance ?? summary.balance,
      devices: summary.devices.length > 0 ? summary.devices : result.devices,
    }
  } catch (error) {
    const { code, message } = friendlyMessage(error)
    return { ok: false, code, message, devices: devicesFromError(error) }
  }
}

/** The devices on this license. */
export async function handleLicenseDevices(): Promise<DeviceView[]> {
  try {
    return await listDevices()
  } catch {
    return []
  }
}

/** Deactivates a device, returning the remaining list. */
export async function handleLicenseDeactivate(_event: unknown, deviceId: unknown): Promise<DeactivationResult> {
  if (typeof deviceId !== 'string' || !deviceId) return { ok: false, message: 'No device was selected.' }
  try {
    return { ok: true, devices: await deactivateDevice(deviceId) }
  } catch (error) {
    return { ok: false, message: friendlyMessage(error).message }
  }
}

export function registerLicenseHandlers(): void {
  ipcMain.handle('license:summary', handleLicenseSummary)
  ipcMain.handle('license:activate', handleLicenseActivate)
  ipcMain.handle('license:devices', handleLicenseDevices)
  ipcMain.handle('license:deactivate', handleLicenseDeactivate)
}
