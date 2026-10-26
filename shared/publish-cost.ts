// Publishing cost, quoted in the app before anything is uploaded.
//
// This mirrors `demothat-api`'s `src/domain/publishing.ts` deliberately, and it is a
// mirror rather than a source of truth: the app never sends a price. `POST
// /v1/publications` preflights with the declared size and charges nothing, and the
// real charge is computed server-side from the size the server reads back from the
// object store. What this is for is the dialog — the user has to see what a term will
// cost before they commit to it, and the number has to be the number they will be
// charged, not an approximation that turns into a surprise.
//
// The formula is therefore copied exactly, including the part that is easy to get
// wrong: the floor applies to the **total**, not to the storage term alone. A 2 MB
// clip published as a landing page costs 901, not 900, because storage always costs
// at least one credit of its own.

import type { components } from './api-types'

export type PublishingCapabilities = components['schemas']['PublishingCapabilities']
export type PublicationKind = components['schemas']['PublicationKind']

/** The unit the published price is quoted in. R2 bills decimal GB, so we do too. */
export const BYTES_PER_GB = 1_000_000_000

export interface PublishCostInput {
  sizeBytes: number
  storageDays: number
  kind: PublicationKind
}

/**
 * What a publication will cost, in credits.
 *
 * Never below `minCredits`, and the landing page's surcharge is added on top of that
 * floor rather than being able to absorb it.
 */
export function estimatePublishCredits(capabilities: PublishingCapabilities, input: PublishCostInput): number {
  const storage = storageCredits(input.sizeBytes, input.storageDays, capabilities.creditsPerGbYear)
  const landing = input.kind === 'page' ? capabilities.landingPageCredits : 0
  // The floor is on the **total**, which is where the server applies it. Flooring the
  // storage term instead gives the same number for every rate in use today (a positive
  // size always ceilings to at least one credit) and a different one the moment a
  // deployment sets its minimum above a component — 1,000 against a server charge of
  // 1,000 rather than 1,900.
  return Math.max(capabilities.minCredits, storage + landing)
}

/**
 * The storage half of the price, before the floor and the landing surcharge.
 *
 * Deliberately identical in shape to the server's `storageCredits`, including returning
 * 0 for a degenerate size or term: the floor belongs to the total, and duplicating it
 * here is how the two drift apart.
 */
export function storageCredits(sizeBytes: number, storageDays: number, creditsPerGbYear: number): number {
  if (sizeBytes <= 0 || storageDays <= 0) return 0
  const gigabytes = sizeBytes / BYTES_PER_GB
  return Math.ceil((gigabytes * creditsPerGbYear * storageDays) / 365)
}

/** Dollar value of a credit count, at the published rate. For display only. */
export const CREDITS_PER_USD = 600

export function creditsToUsd(credits: number): number {
  return credits / CREDITS_PER_USD
}

/**
 * How a term should read to a user.
 *
 * "1 year" rather than "365 days": the number is the same and the meaning is not —
 * one is a term someone chooses, the other is arithmetic.
 */
export function describeTerm(days: number): string {
  if (days === 365) return '1 year'
  if (days === 30) return '1 month'
  if (days === 7) return '1 week'
  if (days === 90) return '3 months'
  if (days % 30 === 0) {
    const months = days / 30
    return months === 1 ? '1 month' : `${months} months`
  }
  if (days % 7 === 0) {
    const weeks = days / 7
    return weeks === 1 ? '1 week' : `${weeks} weeks`
  }
  return days === 1 ? '1 day' : `${days} days`
}

/**
 * Whether the video is small enough to publish at all.
 *
 * Checked here so the dialog can say so before the upload starts, and checked again
 * by the server, which is the check that counts.
 */
export function fitsSizeLimit(capabilities: PublishingCapabilities, sizeBytes: number): boolean {
  return sizeBytes <= capabilities.maxSizeBytes
}

/** Bytes as a user reads them, decimal to match the price's unit. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  const units = ['kB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[unit]}`
}

/** The kind's own one-line description, for the radio group in the dialog. */
export function describeKind(kind: PublicationKind): string {
  switch (kind) {
    case 'page':
      return 'A hosted landing page with a player and a download link, on a link you can share.'
    case 'embed':
      return 'A player you can embed in a page, plus the direct download links.'
    case 'links':
      return 'Just the direct download links. No page and nothing to embed.'
  }
}

/** True when the kind serves a hosted landing page, which is what carries the surcharge. */
export function hasLandingPage(kind: PublicationKind): boolean {
  return kind === 'page'
}
