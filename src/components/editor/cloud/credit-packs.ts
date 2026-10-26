// Credit pack helpers for the Buy credits dialog.
//
// The dialog shows the catalogue from `GET /v1/products`; these helpers cover the
// offline fallback (when the API cannot be reached), the price rendering for that
// fallback, and the "smallest pack that covers the shortfall" choice.
//
// Kept out of the component file so React Fast Refresh stays happy.

import { CREDIT_PACKS, type CreditPack } from '../../../../shared/license'
import type { CreditPackView } from '../../../../shared/pricing'

/** Display price for an offline pack, e.g. "$3" or "$4.50". */
export function priceLabel(pack: CreditPack): string {
  return `$${Number.isInteger(pack.priceUsd) ? pack.priceUsd : pack.priceUsd.toFixed(2)}`
}

/**
 * The offline packs, in the same shape as the server's catalogue.
 *
 * Only used when `GET /v1/products` is unreachable: the product ids here are
 * placeholders and the prices are indicative, so anything drawn from this list is
 * a best effort until the server answers.
 */
export function fallbackPackViews(packs: CreditPack[] = CREDIT_PACKS): CreditPackView[] {
  return packs.map((pack) => ({
    productId: pack.productId,
    label: pack.label,
    credits: pack.credits,
    priceLabel: priceLabel(pack),
    kind: pack.kind,
  }))
}

/**
 * The packs this copy may actually buy, in the order the dialog shows them.
 *
 * The API is the enforcement point — a first purchase needs no licence and a top-up
 * needs one — so mirroring the rule here means the dialog never offers a pack the
 * server would refuse. A copy that has not bought in yet sees the single entry pack
 * instead of four buttons, three of which would fail.
 *
 * A catalogue that carries no entry pack is returned whole: showing what the server
 * sells beats showing an empty dialog.
 */
export function visiblePacks<T extends { kind: 'first_purchase' | 'topup' }>(packs: T[], licensed: boolean): T[] {
  if (licensed) return packs
  const entry = packs.filter((pack) => pack.kind === 'first_purchase')
  return entry.length > 0 ? entry : packs
}

/**
 * The target a pack note quotes: 8K when the table has it, otherwise the largest
 * resolution the table prices. Null when there is no table to read.
 */
export function pickNoteTarget(creditsPerFrame: Record<string, number> | undefined): string | null {
  if (!creditsPerFrame) return null
  const keys = Object.keys(creditsPerFrame).filter((key) => (creditsPerFrame[key] ?? 0) > 0)
  if (keys.length === 0) return null
  if (keys.includes('8k')) return '8k'
  const ordered = ['720p', '1080p', '2k', '4k', '8k'].filter((key) => keys.includes(key))
  return ordered.length > 0 ? ordered[ordered.length - 1] : keys[0]
}

/**
 * The pack to preselect: the smallest one that covers the shortfall, else the
 * first (design §2: "the smallest pack that covers the export is preselected").
 * Falls back to the largest pack when even that does not cover the shortfall —
 * a purchase is still the only way forward. Expects the list cheapest-first,
 * which both the server's order and `fallbackPackViews` guarantee.
 */
export function recommendedPackIndex(
  shortfall: number | null | undefined,
  packs: Array<{ credits: number }> = CREDIT_PACKS,
): number {
  if (!shortfall || shortfall <= 0 || packs.length === 0) return 0
  const index = packs.findIndex((pack) => pack.credits >= shortfall)
  return index === -1 ? packs.length - 1 : index
}
