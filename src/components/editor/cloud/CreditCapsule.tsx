// Credit indicator in the editor header (design reference §1).
//
// One segmented button, 32px high, with the same 6px radius, 1px hairline and
// secondary fill as the buttons beside it. Three segments when licensed — Pro,
// balance, Buy credits — and two when not: Get Pro, Enter key. Hovering (or
// focusing) the balance segment opens the Devices hover card.

import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Coin } from 'tabler-icons-react'
import { useEditorStore } from '../../../store/editorStore'
import { cn } from '../../../lib/utils'
import { formatCredits } from '../../../../shared/license'
import type { CreditStatus } from '../../../../shared/license'
import { ICON_SIZE, ICON_STROKE } from '../../ui/icons'
import { DevicesList } from './DevicesList'
import { devicesSubtitle } from './device-copy'
import { useCountUp } from './use-count-up'

/** Grace period so the pointer can travel from the segment onto the card. */
const HOVER_CLOSE_DELAY_MS = 150
/** How long the one-shot "empty" pulse stays applied. */
const PULSE_MS = 800

export interface CreditCapsuleProps {
  /** Opens the Buy credits dialog. */
  onBuyCredits: () => void
  /** Opens checkout for a first purchase. */
  onGetPro: () => void
  /** Opens the Activate dialog (an existing key). */
  onEnterKey: () => void
}

export function CreditCapsule({ onBuyCredits, onGetPro, onEnterKey }: CreditCapsuleProps) {
  const { plan, balance, creditStatus, devices, deactivateDevice, creditsAddedChip, dismissCreditsAdded } =
    useEditorStore(
      useShallow((state) => ({
        plan: state.plan,
        balance: state.balance,
        creditStatus: state.creditStatus,
        devices: state.licenseDevices,
        deactivateDevice: state.deactivateDevice,
        creditsAddedChip: state.creditsAddedChip,
        dismissCreditsAdded: state.dismissCreditsAdded,
      })),
    )

  // The balance counts to its new value after a purchase (design §3).
  const displayedBalance = useCountUp(balance)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (creditsAddedChip == null) return
    setFlash(true)
    // The chip rides for 1.3s; the outline holds the accent for 3s.
    const hideChip = window.setTimeout(() => dismissCreditsAdded(), 1300)
    const stopFlash = window.setTimeout(() => setFlash(false), 3000)
    return () => {
      window.clearTimeout(hideChip)
      window.clearTimeout(stopFlash)
    }
  }, [creditsAddedChip, dismissCreditsAdded])

  const licensed = plan != null
  const [cardOpen, setCardOpen] = useState(false)
  const [pulse, setPulse] = useState(false)
  const closeTimer = useRef<number | null>(null)
  const previousStatus = useRef<CreditStatus | null>(null)

  // One soft pulse when the balance arrives (or starts) empty (design §9).
  useEffect(() => {
    const was = previousStatus.current
    previousStatus.current = creditStatus
    if (creditStatus !== 'empty' || was === 'empty') return
    setPulse(true)
    const timer = window.setTimeout(() => setPulse(false), PULSE_MS)
    return () => window.clearTimeout(timer)
  }, [creditStatus])

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    },
    [],
  )

  const openCard = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setCardOpen(true)
  }

  const scheduleClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setCardOpen(false), HOVER_CLOSE_DELAY_MS)
  }

  const low = creditStatus === 'low' || creditStatus === 'empty'

  return (
    <div className="relative inline-flex whitespace-nowrap" style={{ WebkitAppRegion: 'no-drag' }}>
      <div
        className={cn(
          'inline-flex h-8 items-stretch overflow-hidden rounded-ctl border border-line bg-ctl transition-colors duration-300',
          pulse && 'animate-credit-pulse',
          flash && 'border-accent shadow-[0_0_0_1px_var(--sa-accent)]',
        )}
      >
        {licensed ? (
          <>
            <span className="inline-flex items-center px-2.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
              Pro
            </span>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={cardOpen}
              onMouseEnter={openCard}
              onMouseLeave={scheduleClose}
              onFocus={openCard}
              onBlur={scheduleClose}
              className="inline-flex items-center gap-1.5 border-l border-line px-2.5 text-sm text-fg hover:bg-ctl-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            >
              <Coin size={ICON_SIZE} strokeWidth={ICON_STROKE} />
              <span className={cn('whitespace-nowrap font-mono tabular-nums', low && 'text-danger')}>
                {formatCredits(displayedBalance)}
              </span>
              {creditStatus === 'low' && <span className="text-muted">Low</span>}
            </button>
            <button
              type="button"
              onClick={onBuyCredits}
              className={cn(
                'border-l border-line px-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                low ? 'bg-accent font-semibold text-on-accent hover:opacity-90' : 'text-fg hover:bg-ctl-hover',
              )}
            >
              Buy credits
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onGetPro}
              className="bg-accent px-2.5 font-semibold text-on-accent hover:opacity-90 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            >
              Get Pro
            </button>
            <button
              type="button"
              onClick={onEnterKey}
              className="border-l border-line px-2.5 text-fg hover:bg-ctl-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            >
              Enter key
            </button>
          </>
        )}
      </div>

      {licensed && creditsAddedChip != null && (
        <span
          role="status"
          className="animate-credit-chip pointer-events-none absolute left-1/2 top-[-12px] rounded-pv bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-on-accent"
        >
          +{formatCredits(creditsAddedChip)}
        </span>
      )}

      {licensed && cardOpen && (
        <div
          className="absolute right-0 top-full z-50 w-[360px] pt-1.5"
          onMouseEnter={openCard}
          onMouseLeave={scheduleClose}
        >
          <div className="card-clean animate-menu-in overflow-hidden">
            <header className="border-b border-line px-[18px] pt-4 pb-1.5">
              <h3 className="text-title font-semibold text-fg">Devices</h3>
              <p className="mt-0.5 text-sm text-muted">{devicesSubtitle(devices)}</p>
            </header>
            <div className="px-[18px] py-[14px]">
              <DevicesList devices={devices} onDeactivate={(id) => void deactivateDevice(id)} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
