// Waiting for payment (design reference §3 and §4).
//
// The app polls in the main process; this dialog is where the user waits. It
// offers the link again, explains a timeout or a failure, and — after a minute
// without a key — points at the Activate dialog instead.

import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Loader2, Ban } from 'tabler-icons-react'
import { useEditorStore } from '../../../store/editorStore'
import { Button } from '../../ui/button'
import { ICON_STROKE } from '../../ui/icons'
import { CloudDialog } from './CloudDialog'

/** After this long without a key, offer the manual path (design §4). */
const OFFER_ENTER_KEY_AFTER_MS = 60_000

export interface WaitingForPaymentDialogProps {
  isOpen: boolean
  onClose: () => void
  /** Opens the Activate dialog ("Enter key instead"). */
  onEnterKey: () => void
  /** Opens the Buy credits dialog again after a failure ("Try again"). */
  onTryAgain: () => void
}

export function WaitingForPaymentDialog({ isOpen, onClose, onEnterKey, onTryAgain }: WaitingForPaymentDialogProps) {
  const { checkoutUrl, purchaseError, pushToast } = useEditorStore(
    useShallow((state) => ({
      checkoutUrl: state.checkoutUrl,
      purchaseError: state.purchaseError,
      pushToast: state.pushToast,
    })),
  )
  const [showEnterKey, setShowEnterKey] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setShowEnterKey(false)
      return
    }
    const timer = window.setTimeout(() => setShowEnterKey(true), OFFER_ENTER_KEY_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [isOpen])

  if (!isOpen) return null

  const copyLink = async () => {
    if (!checkoutUrl) return
    try {
      await navigator.clipboard.writeText(checkoutUrl)
      pushToast({ message: 'Checkout link copied.' })
    } catch {
      pushToast({ message: 'Could not copy the link.' })
    }
  }

  const failed = purchaseError != null

  return (
    <CloudDialog
      title={failed ? 'Could not start the purchase' : 'Finish payment in your browser'}
      variant="state"
      icon={
        failed ? (
          <Ban size={28} strokeWidth={ICON_STROKE} className="text-danger" />
        ) : (
          <Loader2 size={28} strokeWidth={ICON_STROKE} className="animate-spin" />
        )
      }
      subtitle={failed ? purchaseError : 'We opened checkout. Credits appear here as soon as the payment goes through.'}
      onClose={onClose}
      maxWidth={380}
    >
      {showEnterKey && !failed && (
        <p className="mt-4 text-sm text-muted">
          Already have a key?{' '}
          <button
            type="button"
            className="text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={onEnterKey}
          >
            Enter key instead
          </button>
        </p>
      )}
      <div className="mt-6 flex w-full gap-2">
        {failed ? (
          <>
            <Button variant="secondary" className="flex-1" onClick={onClose}>
              Close
            </Button>
            <Button className="flex-1" onClick={onTryAgain}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" className="flex-1" onClick={() => void copyLink()} disabled={!checkoutUrl}>
              Copy link
            </Button>
            <Button className="flex-1" onClick={onClose}>
              Cancel
            </Button>
          </>
        )}
      </div>
    </CloudDialog>
  )
}
