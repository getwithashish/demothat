// Purchase flow: checkout, then polling the purchase until it settles.
//
// The app never handles card details. `POST /v1/checkout` returns a Dodo
// checkout URL, which is validated against the host allowlist and opened in the
// system browser; the app then polls `GET /v1/purchases/:id` with the poll token
// until the payment settles. The pending purchase is persisted in the encrypted
// store, so polling resumes after a restart.

import log from 'electron-log/main'
import { ApiError, apiRequest } from '../lib/api-client'
import { getApiBaseUrl, isAllowedCheckoutUrl } from '../lib/api-config'
import { deleteSecret, readSecret, writeSecret } from '../lib/secure-store'
import type { DeviceView } from '../../../shared/license'
import { activateLicense, devicesFromError, getDeviceIdHash, getStoredToken } from './license-client'

const SECRETS_NAME = 'purchase'
const PURCHASE_ID_SECRET = 'purchaseId'
const POLL_TOKEN_SECRET = 'pollToken'
const CHECKOUT_URL_SECRET = 'checkoutUrl'

/** Poll every 2 seconds, for up to 15 minutes (spec). */
export const POLL_INTERVAL_MS = 2000
export const POLL_MAX_WAIT_MS = 15 * 60 * 1000
/** Ceiling for the network-error backoff. */
export const POLL_MAX_BACKOFF_MS = 10_000

export interface CheckoutSession {
  purchaseId: string
  pollToken: string
  checkoutUrl: string
}

export interface PendingPurchase {
  purchaseId: string
  pollToken: string
  /** Remembered so "Copy link" still works after a restart. */
  checkoutUrl: string | null
}

export interface PurchaseView {
  status: 'pending' | 'succeeded' | 'failed'
  balance?: number
  /** Returned exactly once, on a first purchase, then removed server-side. */
  licenseKey?: string
}

/** What the renderer is told when a purchase settles (or does not). */
export type PurchaseOutcome =
  | { kind: 'succeeded'; balance: number; firstPurchase: boolean }
  | { kind: 'failed'; message: string }
  | { kind: 'timeout' }
  | { kind: 'device_limit_reached'; message: string; devices: DeviceView[]; licenseKey: string }

/** A caller-owned flag so a cancel or a window close can stop the poll loop. */
export interface PollCancellation {
  cancelled: boolean
}

/**
 * Delay before the next poll. While the API is answering, stay at the steady
 * 2s cadence; only a network error backs off (×1.5, capped).
 */
export function nextPollDelay(currentMs: number, hadNetworkError: boolean, maxMs = POLL_MAX_BACKOFF_MS): number {
  if (!hadNetworkError) return POLL_INTERVAL_MS
  return Math.min(Math.round(Math.max(currentMs, POLL_INTERVAL_MS) * 1.5), maxMs)
}

/** True for failures that are worth retrying rather than reporting. */
export function isTransient(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === undefined || error.status >= 500
  return true
}

// --- Pending purchase (survives a restart) -------------------------------------

export function rememberPending(purchase: PendingPurchase): void {
  writeSecret(SECRETS_NAME, PURCHASE_ID_SECRET, purchase.purchaseId)
  writeSecret(SECRETS_NAME, POLL_TOKEN_SECRET, purchase.pollToken)
  if (purchase.checkoutUrl) writeSecret(SECRETS_NAME, CHECKOUT_URL_SECRET, purchase.checkoutUrl)
}

export function getPendingPurchase(): PendingPurchase | null {
  const purchaseId = readSecret(SECRETS_NAME, PURCHASE_ID_SECRET)
  const pollToken = readSecret(SECRETS_NAME, POLL_TOKEN_SECRET)
  if (!purchaseId || !pollToken) return null
  return { purchaseId, pollToken, checkoutUrl: readSecret(SECRETS_NAME, CHECKOUT_URL_SECRET) }
}

export function clearPendingPurchase(): void {
  deleteSecret(SECRETS_NAME, PURCHASE_ID_SECRET)
  deleteSecret(SECRETS_NAME, POLL_TOKEN_SECRET)
  deleteSecret(SECRETS_NAME, CHECKOUT_URL_SECRET)
}

// --- Checkout -----------------------------------------------------------------

/**
 * Starts a purchase. With a license token this is a top-up; without one it is a
 * first purchase, and the API issues a new license.
 */
export async function startCheckout(productId: string): Promise<CheckoutSession> {
  const productId_ = productId.trim()
  if (!productId_) throw new ApiError('Choose a credit pack first.', 'validation_error', 400)

  const token = getStoredToken()
  const body: Record<string, unknown> = { productId: productId_ }
  // First purchase: the API records which device asked, so activation can be
  // automatic when the key comes back.
  if (!token) body.deviceIdHash = getDeviceIdHash()

  const session = await apiRequest<CheckoutSession>(getApiBaseUrl(), {
    method: 'POST',
    path: '/v1/checkout',
    body,
    token,
    retries: 1,
  })

  if (!session?.purchaseId || !session?.pollToken) {
    throw new ApiError('The server did not return a purchase.', 'bad_response')
  }
  // A checkout URL outside the allowlist is refused: the app must not open a
  // browser on a host the backend was not configured to use.
  if (!isAllowedCheckoutUrl(session.checkoutUrl)) {
    throw new ApiError('The checkout link was not on an allowed host.', 'checkout_url_rejected', 400)
  }

  rememberPending({ purchaseId: session.purchaseId, pollToken: session.pollToken, checkoutUrl: session.checkoutUrl })
  return session
}

/** One `GET /v1/purchases/:id` call. */
export async function fetchPurchase(pending: PendingPurchase): Promise<PurchaseView> {
  return apiRequest<PurchaseView>(getApiBaseUrl(), {
    method: 'GET',
    path: `/v1/purchases/${encodeURIComponent(pending.purchaseId)}`,
    headers: { 'X-Poll-Token': pending.pollToken },
    retries: 0,
  })
}

/**
 * Polls a purchase until it settles, a cancel arrives, or 15 minutes pass.
 *
 * Network errors back off and keep going (the payment happens in the browser, so
 * the API being briefly unreachable must not lose a purchase). A settled
 * purchase is cleared from disk; a timeout is not, so the next app start can
 * still pick it up.
 */
export async function pollPurchase(
  options: {
    pending?: PendingPurchase
    cancel?: PollCancellation
    maxWaitMs?: number
    onPending?: () => void
  } = {},
): Promise<PurchaseOutcome> {
  const pending = options.pending ?? getPendingPurchase()
  if (!pending) throw new ApiError('There is no purchase to watch.', 'no_pending_purchase')

  const startedAt = Date.now()
  const maxWaitMs = options.maxWaitMs ?? POLL_MAX_WAIT_MS
  let delay = POLL_INTERVAL_MS

  for (;;) {
    if (options.cancel?.cancelled) throw new ApiError('Cancelled', 'cancelled')

    let view: PurchaseView | null = null
    let hadNetworkError = false
    try {
      view = await fetchPurchase(pending)
    } catch (error) {
      if (!isTransient(error)) {
        clearPendingPurchase()
        return { kind: 'failed', message: (error as Error).message }
      }
      hadNetworkError = true
      log.warn(`[Purchase] Poll failed (${(error as Error).message}); backing off.`)
    }

    if (view) {
      if (view.status === 'succeeded') {
        clearPendingPurchase()
        return settleSuccess(view)
      }
      if (view.status === 'failed') {
        clearPendingPurchase()
        return { kind: 'failed', message: 'The payment did not go through. No credits were added.' }
      }
      options.onPending?.()
    }

    if (Date.now() - startedAt > maxWaitMs) {
      // Keep the record: the webhook can still grant the credits, and the next
      // launch (or a window focus) will pick the purchase up again.
      return { kind: 'timeout' }
    }

    await new Promise((resolve) => setTimeout(resolve, delay))
    delay = nextPollDelay(delay, hadNetworkError)
  }
}

/**
 * Turns a succeeded purchase into an outcome: a first purchase is activated
 * automatically with the key the API returns (the email is only a backup).
 */
async function settleSuccess(view: PurchaseView): Promise<PurchaseOutcome> {
  if (!view.licenseKey) {
    return { kind: 'succeeded', balance: view.balance ?? 0, firstPurchase: false }
  }

  try {
    const activation = await activateLicense(view.licenseKey)
    return { kind: 'succeeded', balance: activation.balance ?? view.balance ?? 0, firstPurchase: true }
  } catch (error) {
    const apiError = error as ApiError
    if (apiError.code === 'device_limit_reached') {
      // The key is valid but this license has no free slot: keep it so the user
      // can free one and activate without buying again.
      return {
        kind: 'device_limit_reached',
        message: apiError.message,
        devices: devicesFromError(error) ?? [],
        licenseKey: view.licenseKey,
      }
    }
    log.warn(`[Purchase] Automatic activation failed: ${apiError.message}`)
    // Not fatal: the key is in the user's email, and the balance still moved.
    return { kind: 'succeeded', balance: view.balance ?? 0, firstPurchase: true }
  }
}
