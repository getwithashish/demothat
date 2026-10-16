// Devices dialog: which computers are on this license, and Deactivate (design §4).
//
// The same content is shown as a hover card under the capsule's balance segment.

import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useEditorStore } from '../../../store/editorStore'
import { Button } from '../../ui/button'
import { CloudDialog, CloudDialogSection } from './CloudDialog'
import { DevicesList } from './DevicesList'
import { devicesSubtitle } from './device-copy'

export interface DevicesDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function DevicesDialog({ isOpen, onClose }: DevicesDialogProps) {
  const { devices, deactivateDevice, refreshDevices, licenseError } = useEditorStore(
    useShallow((state) => ({
      devices: state.licenseDevices,
      deactivateDevice: state.deactivateDevice,
      refreshDevices: state.refreshDevices,
      licenseError: state.licenseError,
    })),
  )
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    void refreshDevices()
  }, [isOpen, refreshDevices])

  if (!isOpen) return null

  const onDeactivate = async (deviceId: string) => {
    setBusy(true)
    await deactivateDevice(deviceId)
    setBusy(false)
  }

  return (
    <CloudDialog
      title="Devices"
      subtitle={devicesSubtitle(devices)}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <CloudDialogSection>
        <DevicesList devices={devices} onDeactivate={(id) => void onDeactivate(id)} busy={busy} error={licenseError} />
      </CloudDialogSection>
    </CloudDialog>
  )
}
