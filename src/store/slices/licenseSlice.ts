// License and credit state: plan, balance and the devices on this license.
//
// Every value comes from the main process over IPC; nothing here talks to the
// network or touches the license key.

import { creditStatus as toCreditStatus } from '../../../shared/license'
import type { LicenseActions, LicenseState, Slice } from '../../types'

export const initialLicenseState: LicenseState = {
  plan: null,
  balance: 0,
  creditStatus: 'empty',
  licenseDevices: [],
  licenseBusy: false,
  licenseError: null,
}

/** True when the preload bridge is present (it is absent in plain-Node tests). */
function bridge() {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

export const createLicenseSlice: Slice<LicenseState, LicenseActions> = (set) => ({
  ...initialLicenseState,

  refreshBalance: async () => {
    const api = bridge()
    if (!api?.getLicenseSummary) return
    try {
      const summary = await api.getLicenseSummary()
      set((state) => {
        state.plan = summary.plan
        state.balance = summary.balance
        state.creditStatus = toCreditStatus(summary.balance)
        state.licenseDevices = summary.devices
      })
    } catch {
      // Keep the last known values; a refresh failure is not worth a dialog.
    }
  },

  activateLicense: async (licenseKey: string) => {
    const api = bridge()
    if (!api?.activateLicense) return false
    set((state) => {
      state.licenseBusy = true
      state.licenseError = null
    })
    try {
      const result = await api.activateLicense(licenseKey)
      if (!result.ok) {
        set((state) => {
          state.licenseBusy = false
          state.licenseError = result.message
          if (result.devices) state.licenseDevices = result.devices
        })
        return false
      }
      set((state) => {
        state.licenseBusy = false
        state.licenseError = null
        state.plan = result.plan
        state.balance = result.balance
        state.creditStatus = toCreditStatus(result.balance)
        state.licenseDevices = result.devices
      })
      return true
    } catch (error) {
      set((state) => {
        state.licenseBusy = false
        state.licenseError = error instanceof Error ? error.message : 'Activation failed.'
      })
      return false
    }
  },

  refreshDevices: async () => {
    const api = bridge()
    if (!api?.listLicenseDevices) return
    try {
      const devices = await api.listLicenseDevices()
      set((state) => {
        state.licenseDevices = devices
      })
    } catch {
      // Leave the existing list in place.
    }
  },

  deactivateDevice: async (deviceId: string) => {
    const api = bridge()
    if (!api?.deactivateLicenseDevice) return false
    try {
      const result = await api.deactivateLicenseDevice(deviceId)
      if (!result.ok) {
        set((state) => {
          state.licenseError = result.message
        })
        return false
      }
      set((state) => {
        state.licenseDevices = result.devices
      })
      return true
    } catch (error) {
      set((state) => {
        state.licenseError = error instanceof Error ? error.message : 'Could not deactivate that device.'
      })
      return false
    }
  },

  clearLicenseError: () => {
    set((state) => {
      state.licenseError = null
    })
  },
})
