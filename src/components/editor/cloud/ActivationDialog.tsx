// Activate Pro: paste a license key (design reference §4).
//
// Used from the header's "Enter key" segment, from the export modal's "I already
// have a key" link, and as the fallback when automatic activation does not
// arrive after a payment.

import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useEditorStore } from '../../../store/editorStore'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { CloudDialog, CloudDialogSection } from './CloudDialog'

export interface ActivationDialogProps {
  isOpen: boolean
  onClose: () => void
  /** Opens checkout — "Don't have a key? Get Pro". */
  onGetPro: () => void
  /** Called after a successful activation, before the dialog closes. */
  onActivated?: () => void
}

export function ActivationDialog({ isOpen, onClose, onGetPro, onActivated }: ActivationDialogProps) {
  const { activateLicense, licenseBusy, licenseError, clearLicenseError } = useEditorStore(
    useShallow((state) => ({
      activateLicense: state.activateLicense,
      licenseBusy: state.licenseBusy,
      licenseError: state.licenseError,
      clearLicenseError: state.clearLicenseError,
    })),
  )
  const [key, setKey] = useState('')

  // Start each attempt clean: an old failure message must not stick to a new key.
  useEffect(() => {
    if (!isOpen) return
    setKey('')
    clearLicenseError()
  }, [isOpen, clearLicenseError])

  if (!isOpen) return null

  const submit = async () => {
    if (!key.trim() || licenseBusy) return
    const ok = await activateLicense(key.trim())
    if (ok) {
      onActivated?.()
      onClose()
    }
  }

  return (
    <CloudDialog
      title="Activate Pro"
      subtitle="Paste the key from your purchase email."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={licenseBusy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!key.trim() || licenseBusy}>
            {licenseBusy ? 'Activating…' : 'Activate'}
          </Button>
        </>
      }
    >
      <CloudDialogSection>
        <Input
          label="License key"
          className="font-mono"
          placeholder="DODO-XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          autoFocus
          value={key}
          onChange={(event) => setKey(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
          error={licenseError ?? undefined}
          aria-invalid={licenseError ? true : undefined}
        />
        {!licenseError && (
          <p className="mt-2 text-sm text-muted">
            Don&rsquo;t have a key?{' '}
            <button
              type="button"
              className="text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={onGetPro}
            >
              Get Pro
            </button>
          </p>
        )}
      </CloudDialogSection>
    </CloudDialog>
  )
}
