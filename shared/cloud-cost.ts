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

export interface CloudCostEstimate {
  credits: number
  frames: number
  /** The capabilities key the estimate came from. */
  target: ResolutionKey
}

/** Credits per frame for a target height, or null when the table omits it. */
export function creditsPerFrameFor(creditsPerFrame: Record<string, number> | undefined, height: number): number | null {
  const key = resolutionKeyForHeight(height)
  if (!key) return null
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
  const target = resolutionKeyForHeight(height)
  if (!target) return null
  const rate = creditsPerFrameFor(creditsPerFrame, height)
  if (rate == null) return null
  const frames = Math.max(1, Math.ceil(Math.max(0, durationSec) * fps))
  return { credits: Math.max(1, Math.ceil(frames * rate)), frames, target }
}

/** True when the balance covers the estimate. */
export function hasEnoughCredits(balance: number, credits: number): boolean {
  return balance >= credits
}
