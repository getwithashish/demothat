// Cost of a cloud transcription, from the server's own `creditsPerMinute`.
//
// The twin of `cloud-cost.ts`, and for the same reason: the renderer shows the
// estimate and the main process decides whether the balance covers it, so the two
// must agree — and both must agree with the server, which recomputes the price
// from its own probe of the uploaded audio. The server's number is final.

export interface TranscribeCostEstimate {
  credits: number
  audioSeconds: number
  /** The rate the estimate came from, in credits per minute. */
  creditsPerMinute: number
}

/**
 * `ceil(audioSeconds / 60 * creditsPerMinute)` — the same formula as the server,
 * over the clip's own length.
 *
 * Returns null when the capabilities do not publish a usable rate, so a caller
 * shows "unavailable" rather than quoting a price of zero.
 */
export function estimateTranscribeCredits(
  transcription:
    | { enabled?: boolean; creditsPerMinute?: number; maxAudioSeconds?: number }
    | undefined,
  audioSeconds: number,
): TranscribeCostEstimate | null {
  const rate = transcription?.creditsPerMinute
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) return null
  if (!Number.isFinite(audioSeconds) || audioSeconds <= 0) return null
  return {
    credits: Math.max(1, Math.ceil((audioSeconds / 60) * rate)),
    audioSeconds,
    creditsPerMinute: rate,
  }
}

/** True when the balance covers the estimate. */
export function hasEnoughCredits(balance: number, credits: number): boolean {
  return balance >= credits
}

/**
 * Why a transcription cannot be offered, or null when it can.
 *
 * The reasons are the ones a user can act on, in the order they would hit them:
 * switched off, no audio in the recording, too long for the deployment's cap.
 */
export function transcribeBlockedReason(
  transcription: { enabled?: boolean; maxAudioSeconds?: number } | undefined,
  audioSeconds: number,
  hasAudio: boolean,
): string | null {
  if (transcription?.enabled === false) {
    return 'Cloud transcription is switched off for this build.'
  }
  if (!hasAudio) {
    return 'This recording has no audio track, so there is nothing to transcribe.'
  }
  const max = transcription?.maxAudioSeconds
  if (typeof max === 'number' && max > 0 && audioSeconds > max) {
    return `This recording is longer than the ${Math.round(max / 60)} minutes a transcription can cover.`
  }
  return null
}
