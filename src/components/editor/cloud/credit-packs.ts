// Credit pack helpers for the Buy credits dialog.
//
// Kept out of the component file so React Fast Refresh stays happy.

import { CREDIT_PACKS, type CreditPack } from '../../../../shared/license'

/** Display price, e.g. "$3" or "$4.50". */
export function priceLabel(pack: CreditPack): string {
  return `$${Number.isInteger(pack.priceUsd) ? pack.priceUsd : pack.priceUsd.toFixed(2)}`
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
 * a purchase is still the only way forward.
 */
export function recommendedPackIndex(shortfall: number | null | undefined, packs: CreditPack[] = CREDIT_PACKS): number {
  if (!shortfall || shortfall <= 0 || packs.length === 0) return 0
  const index = packs.findIndex((pack) => pack.credits >= shortfall)
  return index === -1 ? packs.length - 1 : index
}
