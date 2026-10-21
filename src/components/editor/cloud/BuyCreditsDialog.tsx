// Buy credits (design reference §2).
//
// Packs only: the contract prices a purchase from a server-side product table,
// so there is no free-form amount here (see CREDIT_PACKS in shared/license.ts).
// Continue opens the allow-listed Dodo checkout in the system browser.

import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ExternalLink } from 'tabler-icons-react'
import { useEditorStore } from '../../../store/editorStore'
import { CREDIT_PACKS, formatCredits, packNote } from '../../../../shared/license'
import { toCreditPackViews, type CreditPackView } from '../../../../shared/pricing'
import { cn } from '../../../lib/utils'
import { Button } from '../../ui/button'
import { ICON_SIZE, ICON_STROKE } from '../../ui/icons'
import { CloudDialog, CloudDialogSection } from './CloudDialog'
import { fallbackPackViews, pickNoteTarget, recommendedPackIndex } from './credit-packs'

export interface BuyCreditsDialogProps {
  isOpen: boolean
  onClose: () => void
  /** Credits still needed (export shortfall): preselects the smallest covering pack. */
  shortfall?: number | null
}

/** Assumed project frame rate for the pack notes when the export dialog is not open. */
const NOTE_FPS = 30

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
  // Pack notes come from the server's own pricing table, never from guesses.
  const [creditsPerFrame, setCreditsPerFrame] = useState<Record<string, number> | undefined>(undefined)
  // The catalogue the server says it sells; null until it answers, and empty
  // when it could not be reached (then the offline packs stand in).
  const [packs, setPacks] = useState<CreditPackView[] | null>(null)

  // Re-pick the pack each time the dialog opens for a new shortfall.
  useEffect(() => {
    if (!isOpen) return
    setSelected(recommendedPackIndex(shortfall, CREDIT_PACKS))
    setBusy(false)
    window.electronAPI
      .getCloudCapabilities?.()
      .then((result) => setCreditsPerFrame(result?.capabilities?.creditsPerFrame))
      .catch(() => setCreditsPerFrame(undefined))
    window.electronAPI
      .listProducts?.()
      .then((result) => {
        const views = toCreditPackViews(result?.products)
        setPacks(views.length > 0 ? views : fallbackPackViews())
      })
      .catch(() => setPacks(fallbackPackViews()))
  }, [isOpen, shortfall])

  if (!isOpen) return null

  // The server's catalogue while it is loading too: it is the real answer.
  const catalogue = packs ?? toCreditPackViews(null)
  const options: CreditPackView[] = catalogue.length > 0 ? catalogue : fallbackPackViews()
  const safeIndex = Math.min(selected, options.length - 1)
  const pack = options[safeIndex]
  const covers = shortfall != null && shortfall > 0 && pack.credits >= shortfall
  const noteTarget = pickNoteTarget(creditsPerFrame)

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
          {options.map((option, index) => {
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
                {option.priceLabel && (
                  <span className="whitespace-nowrap font-mono text-sm text-muted">{option.priceLabel}</span>
                )}
                <small className="text-sm text-muted">{option.label}</small>
                {noteTarget && (
                  <small className="text-sm text-muted">
                    {packNote(option.credits, creditsPerFrame, noteTarget, NOTE_FPS)}
                  </small>
                )}
              </button>
            )
          })}
        </div>
      </CloudDialogSection>

      <CloudDialogSection className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <span className="text-ui text-fg">Price</span>
          <span className="whitespace-nowrap font-mono text-sm tabular-nums text-muted">{pack.priceLabel ?? '—'}</span>
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
