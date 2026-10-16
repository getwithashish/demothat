// Wires the purchase flow's IPC events into the store and the toasts.
//
// The main process owns checkout and polling; this hook reacts: it resumes a
// pending purchase after a restart, settles the dialogs, counts the credits that
// arrived, and re-checks a pending purchase whenever the window regains focus.

import { useCallback, useEffect, useRef } from 'react'
import { useEditorStore } from '../store/editorStore'
import { formatCredits, type PurchaseEvent } from '../../shared/license'

export interface PurchaseFlowOptions {
  /** Activation was refused because no device slot is free. */
  onDeviceLimitReached?: () => void
  /** A purchase succeeded; the caller may resume whatever was waiting on credits. */
  onCreditsAdded?: (added: number) => void
}

export function usePurchaseFlow(options: PurchaseFlowOptions = {}): void {
  const optionsRef = useRef(options)
  optionsRef.current = options

  const handle = useCallback(async (event: PurchaseEvent) => {
    const store = useEditorStore.getState()
    switch (event.kind) {
      case 'pending':
        useEditorStore.setState({ waitingForPayment: true })
        return

      case 'cancelled':
        useEditorStore.setState({ waitingForPayment: false, checkoutUrl: null })
        return

      case 'succeeded': {
        // The balance before the refresh is what makes "+N credits added" possible.
        const previous = store.balance
        await store.refreshBalance()
        await store.refreshDevices()
        const added = Math.max(0, useEditorStore.getState().balance - previous)
        useEditorStore.setState({ waitingForPayment: false, checkoutUrl: null, purchaseError: null })
        if (added > 0) {
          store.showCreditsAdded(added)
          store.pushToast({ message: `${formatCredits(added)} credits added` })
        } else if (event.firstPurchase) {
          store.pushToast({ message: 'Pro is active on this computer.' })
        }
        optionsRef.current.onCreditsAdded?.(added)
        return
      }

      case 'failed':
        // Keep the dialog open so the message has somewhere to live.
        useEditorStore.setState({ purchaseError: event.message })
        return

      case 'timeout':
        useEditorStore.setState({
          purchaseError: 'We have not heard back from the payment provider yet. Any credits are added automatically.',
        })
        return

      case 'device_limit_reached':
        useEditorStore.setState({ purchaseError: event.message })
        optionsRef.current.onDeviceLimitReached?.()
        store.pushToast({ message: 'Deactivate a device to activate this computer.' })
        return
    }
  }, [])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onCheckoutStatus) return

    // A purchase that was still pending when the app last closed carries on.
    void (async () => {
      const status = await api.getCheckoutStatus?.()
      if (!status?.pending) return
      useEditorStore.setState({ waitingForPayment: true })
      await api.resumeCheckout?.()
    })()

    const unsubscribe = api.onCheckoutStatus((event) => {
      void handle(event)
    })
    return () => {
      unsubscribe?.()
    }
  }, [handle])

  useEffect(() => {
    const onFocus = () => {
      // A payment can settle while the browser has focus; re-check on return.
      if (!useEditorStore.getState().waitingForPayment) return
      void window.electronAPI?.resumeCheckout?.()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
}
