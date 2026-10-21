// IPC for the purchase flow: start a checkout, watch it settle, or stop watching.
//
// The main process opens the browser and polls; the renderer only shows the
// dialogs and reacts to the `checkout:status` events.

import { BrowserWindow, ipcMain, shell } from 'electron'
import log from 'electron-log/main'
import type { CheckoutStartResult, PurchaseEvent } from '../../../../shared/license'
import type { Product } from '../../../../shared/pricing'
import { ApiError } from '../../lib/api-client'
import { appState } from '../../state'
import { fetchProducts } from '../../features/products'
import {
  clearPendingPurchase,
  getPendingPurchase,
  pollPurchase,
  startCheckout,
  type PollCancellation,
} from '../../features/purchase-flow'

/** The poll loop currently running, so it can be cancelled from the UI. */
let activePoll: PollCancellation | null = null

function editorWindow(): BrowserWindow | null {
  const win = appState.editorWin
  return win && !win.isDestroyed() ? win : null
}

function emit(event: PurchaseEvent | { kind: 'pending' }): void {
  editorWindow()?.webContents.send('checkout:status', event)
}

/** Failures the renderer can show verbatim. */
function friendly(error: unknown): { code: string; message: string } {
  if (error instanceof ApiError) {
    if (error.code === 'checkout_url_rejected') {
      return { code: error.code, message: 'The checkout link could not be opened. Contact support.' }
    }
    return { code: error.code, message: error.message }
  }
  if (error instanceof Error) return { code: 'unknown', message: error.message }
  return { code: 'unknown', message: 'Could not start the purchase.' }
}

/**
 * Watches the persisted purchase until it settles and pushes each result to the
 * renderer. Safe to call twice: only one loop runs at a time.
 */
export async function watchPendingPurchase(): Promise<void> {
  if (activePoll) return
  const pending = getPendingPurchase()
  if (!pending) return

  const cancel: PollCancellation = { cancelled: false }
  activePoll = cancel
  emit({ kind: 'pending' })

  try {
    const outcome = await pollPurchase({ pending, cancel })
    emit(outcome)
  } catch (error) {
    const code = (error as ApiError).code
    if (code === 'cancelled') emit({ kind: 'cancelled' })
    else emit({ kind: 'failed', message: friendly(error).message })
  } finally {
    activePoll = null
  }
}

/** `POST /v1/checkout`, then open the allow-listed URL in the system browser. */
export async function handleCheckoutStart(_event: unknown, productId: unknown): Promise<CheckoutStartResult> {
  if (typeof productId !== 'string') {
    return { ok: false, code: 'validation_error', message: 'Choose a credit pack first.' }
  }
  try {
    const session = await startCheckout(productId)
    await shell.openExternal(session.checkoutUrl)
    log.info(`[Checkout] Opened checkout ${session.purchaseId}`)
    void watchPendingPurchase()
    return { ok: true, purchaseId: session.purchaseId, checkoutUrl: session.checkoutUrl }
  } catch (error) {
    const { code, message } = friendly(error)
    log.warn(`[Checkout] Could not start: ${message}`)
    return { ok: false, code, message }
  }
}

/** Whether a purchase is still being watched (used when the app starts again). */
export async function handleCheckoutStatus(): Promise<{ pending: boolean; watching: boolean }> {
  return { pending: getPendingPurchase() !== null, watching: activePoll !== null }
}

/** Resumes watching a purchase that was interrupted by a restart. */
export async function handleCheckoutResume(): Promise<{ pending: boolean }> {
  const pending = getPendingPurchase() !== null
  if (pending) void watchPendingPurchase()
  return { pending }
}

/**
 * Stops waiting. The payment may still complete in the browser, so the pending
 * purchase is kept: the webhook grants the credits either way, and the next
 * launch (or a window focus) picks the purchase back up.
 */
export function handleCheckoutCancel(): void {
  if (activePoll) activePoll.cancelled = true
}

/** Forgets the pending purchase (used once a purchase has been dealt with). */
export function handleCheckoutForget(): { forgotten: boolean } {
  const had = getPendingPurchase() !== null
  clearPendingPurchase()
  return { forgotten: had }
}

export function registerCheckoutHandlers(): void {
  ipcMain.handle('checkout:start', handleCheckoutStart)
  ipcMain.handle('checkout:status', handleCheckoutStatus)
  ipcMain.handle('checkout:resume', handleCheckoutResume)
  ipcMain.handle('checkout:forget', handleCheckoutForget)
  ipcMain.on('checkout:cancel', handleCheckoutCancel)
  ipcMain.handle('products:list', handleProductsList)
}

/**
 * The catalogue for the Buy credits dialog. A null list means the catalogue
 * could not be fetched; the renderer falls back to its offline packs.
 */
export async function handleProductsList(): Promise<{ products: Product[] | null; error: string | null }> {
  const products = await fetchProducts()
  return { products, error: products === null ? 'Could not reach the store.' : null }
}
