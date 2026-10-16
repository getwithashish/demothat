// First cloud use: consent (design reference §8).
//
// Shown once, before the first cloud export: what leaves the machine, how long
// it is kept, and how charging works. The "Don't ask again" switch is remembered.

import { useEffect, useState } from 'react'
import { ToggleRow } from '../../ui/toggle-row'
import { Button } from '../../ui/button'
import { CloudDialog } from './CloudDialog'

export interface CloudConsentDialogProps {
  isOpen: boolean
  /** Called with whether the user asked not to be shown this again. */
  onContinue: (dontAskAgain: boolean) => void
  onClose: () => void
}

export function CloudConsentDialog({ isOpen, onContinue, onClose }: CloudConsentDialogProps) {
  const [dontAskAgain, setDontAskAgain] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (isOpen) setBusy(false)
  }, [isOpen])

  if (!isOpen) return null

  return (
    <CloudDialog
      title="Upscale in the cloud?"
      subtitle="Read this once before your first cloud export."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Not now
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true)
              onContinue(dontAskAgain)
            }}
          >
            Continue
          </Button>
        </>
      }
    >
      <div className="px-[18px] py-[14px]">
        <p className="text-ui text-fg">
          Your rendered video is uploaded to a secure server, upscaled, and deleted about 24 hours after it finishes.
          Your project file stays on this computer. You are charged credits only for frames processed.
        </p>
      </div>
      <div className="border-t border-line px-[18px] py-[14px]">
        <ToggleRow label="Don't ask again" checked={dontAskAgain} onCheckedChange={setDontAskAgain} />
      </div>
    </CloudDialog>
  )
}
