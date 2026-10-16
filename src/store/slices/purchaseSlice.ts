// Purchase UI state: the Buy credits dialog, the waiting-for-payment dialog and
// the "credits added" chip.
//
// The actual checkout and polling happen in the main process; this slice only
// holds what the dialogs need to render.

import type { PurchaseActions, PurchaseState, Slice } from '../../types'

export const initialPurchaseState: PurchaseState = {
  buyCreditsOpen: false,
  buyCreditsShortfall: null,
  waitingForPayment: false,
  checkoutUrl: null,
  purchaseError: null,
  creditsAddedChip: null,
}

function bridge() {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

export const createPurchaseSlice: Slice<PurchaseState, PurchaseActions> = (set) => ({
  ...initialPurchaseState,

  openBuyCredits: (shortfall?: number | null) => {
    set((state) => {
      state.buyCreditsOpen = true
      state.buyCreditsShortfall = shortfall ?? null
      state.purchaseError = null
    })
  },

  closeBuyCredits: () => {
    set((state) => {
      state.buyCreditsOpen = false
      state.buyCreditsShortfall = null
    })
  },

  startPurchase: async (productId: string) => {
    const api = bridge()
    if (!api?.startCheckout) return false
    try {
      const result = await api.startCheckout(productId)
      if (!result.ok) {
        set((state) => {
          state.purchaseError = result.message
        })
        return false
      }
      set((state) => {
        state.buyCreditsOpen = false
        state.waitingForPayment = true
        state.checkoutUrl = result.checkoutUrl
        state.purchaseError = null
      })
      return true
    } catch (error) {
      set((state) => {
        state.purchaseError = error instanceof Error ? error.message : 'Could not start the purchase.'
      })
      return false
    }
  },

  cancelWaiting: () => {
    bridge()?.cancelCheckout?.()
    set((state) => {
      state.waitingForPayment = false
      state.purchaseError = null
    })
  },

  showCreditsAdded: (credits: number) => {
    set((state) => {
      state.creditsAddedChip = credits
    })
  },

  dismissCreditsAdded: () => {
    set((state) => {
      state.creditsAddedChip = null
    })
  },
})
