// Buy credits (design reference §2).
//
// Packs only: the contract prices a purchase from a server-side product table,
// so there is no free-form amount here (see CREDIT_PACKS in shared/license.ts).
// Continue opens the allow-listed Dodo checkout in the system browser.

import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ExternalLink } from 'tabler-icons-react'
import { useEditorStore } from '../../../store/editorStore'
import { CREDIT_PACKS, formatCredits } from '../../../../shared/license'
import { cn } from '../../../lib/utils'
import { Button } from '../../ui/button'
import { ICON_SIZE, ICON_STROKE } from '../../ui/icons'
import { CloudDialog, CloudDialogSection } from './CloudDialog'
import { priceLabel, recommendedPackIndex } from './credit-packs'

export interface BuyCreditsDialogProps {
  isOpen: boolean
  onClose: () => void
  /** Credits still needed (export shortfall): preselects the smallest covering pack. */
  shortfall?: number | null
}

export function BuyCreditsDialog({ isOpen, onClose, shortfall }: BuyCreditsDialogProps) {
  const { balance, startPurchase, purchaseError } = useEditorStore(
    useShallow((state) => ({
      balance: state.balance,
      startPurchase: state.startPurchase,
      purchaseError: state.purchaseError,
    })),
  )
  const [selected, setSelected] = useState(() => recommendedPackIndex(shortfall, CREDIT_PACKS))
  const [busy, setBusy] = useState(false)

  // Re-pick the pack each time the dialog opens for a new shortfall.
  useEffect(() => {
    if (!isOpen) return
    setSelected(recommendedPackIndex(shortfall, CREDIT_PACKS))
    setBusy(false)
  }, [isOpen, shortfall])

  if (!isOpen) return null

  const pack = CREDIT_PACKS[selected]
  const covers = shortfall != null && shortfall > 0 && pack.credits >= shortfall

  const continueToCheckout = async () => {
    setBusy(true)
    const ok = await startPurchase(pack.productId)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <CloudDialog
      title="Buy credits"
      subtitle={
        shortfall != null && shortfall > 0
          ? `You need ${formatCredits(shortfall)} more credits for this export. You are only charged for frames processed.`
          : 'Credits pay for cloud upscaling. You are only charged for frames processed.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void continueToCheckout()} disabled={busy}>
            Continue in browser
            <ExternalLink size={ICON_SIZE} strokeWidth={ICON_STROKE} className="ml-2" />
          </Button>
        </>
      }
    >
      <CloudDialogSection>
        <span className="mb-1.5 block text-sm text-muted">Recommended packs</span>
        <div className="grid grid-cols-3 gap-2">
          {CREDIT_PACKS.map((option, index) => {
            const active = index === selected
            const badge = covers && option.productId === pack.productId ? 'Covers this export' : null
            return (
              <button
                key={option.productId}
                type="button"
                aria-pressed={active}
                onClick={() => setSelected(index)}
                className={cn(
                  'relative flex flex-col gap-0.5 rounded-ctl border border-line bg-ctl p-3 text-left transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  active && 'border-accent bg-panel shadow-[0_0_0_1px_var(--sa-accent)]',
                  !active && 'hover:bg-ctl-hover',
                )}
              >
                {badge && (
                  <span className="absolute -top-[9px] left-2.5 whitespace-nowrap rounded-pv border border-line bg-panel px-1.5 py-px text-[11px] font-semibold text-accent">
                    {badge}
                  </span>
                )}
                <b className="whitespace-nowrap font-mono text-title font-semibold tabular-nums text-fg">
                  {formatCredits(option.credits)}
                </b>
                <span className="whitespace-nowrap font-mono text-sm text-muted">{priceLabel(option)}</span>
                <small className="text-sm text-muted">{option.label}</small>
              </button>
            )
          })}
        </div>
      </CloudDialogSection>

      <CloudDialogSection className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <span className="text-ui text-fg">Price</span>
          <span className="whitespace-nowrap font-mono text-sm tabular-nums text-muted">{priceLabel(pack)}</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="text-ui text-fg">Balance after</span>
          <span className="whitespace-nowrap font-mono text-sm tabular-nums text-muted">
            {formatCredits(balance + pack.credits)}
          </span>
        </div>
        {purchaseError && <p className="text-sm text-danger">{purchaseError}</p>}
      </CloudDialogSection>
    </CloudDialog>
  )
}
