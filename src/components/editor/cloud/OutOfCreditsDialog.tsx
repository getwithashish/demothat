// Out of credits (exposed from the export settings).
//
// The owner asked for this as its own dialog rather than an inline state, so the
// export settings opens it whenever the balance cannot cover the cloud cost.

import { Coin } from 'tabler-icons-react'
import { useEditorStore } from '../../../store/editorStore'
import { formatCredits } from '../../../../shared/license'
import { Button } from '../../ui/button'
import { CloudDialog } from './CloudDialog'

export interface OutOfCreditsDialogProps {
  isOpen: boolean
  /** What the export will cost, in credits. */
  cost: number
  /** The balance the server last reported. */
  balance: number
  onClose: () => void
}

export function OutOfCreditsDialog({ isOpen, cost, balance, onClose }: OutOfCreditsDialogProps) {
  const openBuyCredits = useEditorStore((state) => state.openBuyCredits)

  if (!isOpen) return null

  const shortfall = Math.max(0, cost - balance)

  return (
    <CloudDialog
      title="Not enough credits"
      variant="state"
      maxWidth={380}
      icon={<Coin size={28} strokeWidth={1.6} className="text-muted" />}
      subtitle={
        <>
          This export costs <span className="font-mono tabular-nums text-fg">{formatCredits(cost)}</span> credits and
          you have <span className="font-mono tabular-nums text-fg">{formatCredits(balance)}</span>.
        </>
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {/* Opens Buy credits preselected for this shortfall (design §5). */}
          <Button onClick={() => openBuyCredits(shortfall)}>Buy credits</Button>
        </>
      }
    >
      <p className="mt-4 text-sm text-muted">
        {shortfall > 0 ? `You need ${formatCredits(shortfall)} more credits for this export. ` : null}
        Standard upscaling needs no credits.
      </p>
    </CloudDialog>
  )
}
