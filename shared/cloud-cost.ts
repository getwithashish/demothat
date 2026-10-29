// Cost of a cloud upscale, from the server's own `creditsPerFrame` table.
//
// Shared by the main process (which quotes a job) and the renderer (which shows
// the Cost row and decides whether the balance is enough), so the two always
// agree. The server recomputes the price from its probe of the upload and its
// number is final.

import { RESOLUTIONS, type ResolutionKey } from './export-resolutions'

/** The resolution key whose height matches an export target. */
export function resolutionKeyForHeight(height: number): ResolutionKey | null {
  const match = (Object.keys(RESOLUTIONS) as ResolutionKey[]).find((key) => RESOLUTIONS[key].height === height)
  return match ?? null
}

/** Parse the numeric height out of a rate-table label like "1440p" or "4k". */
export function labelHeight(label: string): number | undefined {
  const p = /^(\d+)p$/i.exec(label)
  if (p?.[1] !== undefined) return Number(p[1])
  const k = /^(\d+)k$/i.exec(label)
  if (k?.[1] !== undefined) return Number(k[1]) * 1080
  return undefined
}

/**
 * The rate-table key for a target height — the exact `${height}p` label when the
 * table carries one, otherwise the shortest label whose height is >= the target
 * (round up, never undercharge), otherwise the tallest label available.
 *
 * Mirrors the server's `resolveTargetLabel` (demothat-api target-keys.ts), and
 * deliberately does NOT look up by the app's own resolution keys. The live table
 * is keyed by pixel-height labels ("1080p","1440p","2160p","4320p"), not the app's
 * "2k"/"4k"/"8k", so a key-based lookup missed every non-1080 target and the
 * cost row + credit gate silently no-op'd for 2K/4K/8K. Keying by height fixes it.
 */
export function rateKeyForHeight(creditsPerFrame: Record<string, number> | undefined, height: number): string | null {
  if (!creditsPerFrame) return null
  const exact = `${height}p`
  if (Object.prototype.hasOwnProperty.call(creditsPerFrame, exact)) return exact

  const parsed = (Object.keys(creditsPerFrame) as string[])
    .map((label) => ({ label, height: labelHeight(label) }))
    .filter((entry): entry is { label: string; height: number } => entry.height !== undefined)
    .sort((a, b) => a.height - b.height)

  if (parsed.length === 0) {
    // Unparseable labels: fall back to the first key so the caller can still price.
    return Object.keys(creditsPerFrame)[0] ?? null
  }
  const above = parsed.find((entry) => entry.height >= height)
  return above?.label ?? parsed[parsed.length - 1].label
}

export interface CloudCostEstimate {
  credits: number
  frames: number
  /** The capabilities key the estimate came from. */
  target: ResolutionKey
}

/** Credits per frame for a target height, or null when the table omits it. */
export function creditsPerFrameFor(creditsPerFrame: Record<string, number> | undefined, height: number): number | null {
  const key = rateKeyForHeight(creditsPerFrame, height)
  if (key === null) return null
  const rate = creditsPerFrame?.[key]
  return typeof rate === 'number' && rate > 0 ? rate : null
}

/**
 * `ceil(frames * creditsPerFrame[target])` — the same formula as the server, over
 * the clip's own length (cuts and speed regions already applied).
 */
export function estimateCloudCredits(
  creditsPerFrame: Record<string, number> | undefined,
  height: number,
  durationSec: number,
  fps: number,
): CloudCostEstimate | null {
  const rate = creditsPerFrameFor(creditsPerFrame, height)
  if (rate == null) return null
  return {
    credits: Math.max(1, Math.ceil(Math.max(1, Math.ceil(Math.max(0, durationSec) * fps)) * rate)),
    frames: Math.max(1, Math.ceil(Math.max(0, durationSec) * fps)),
    target: resolutionKeyForHeight(height) ?? '1080p',
  }
}

/** True when the balance covers the estimate. */
export function hasEnoughCredits(balance: number, credits: number): boolean {
  return balance >= credits
}
