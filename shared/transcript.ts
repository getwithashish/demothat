// The transcript document a cloud transcription returns, and the reader for it.
//
// Shape (worker-protocol §2.4): timings and text only. No styling, no line breaks,
// no speaker labels — those are the app's business, which is why a caption preset
// change is not a contract change.
//
// Every `start`/`end` is a **source-time** offset into the audio that was
// transcribed, which is the recording's own timeline, not the edited one. The
// subtitle layer maps source time onto export time with the same helpers the
// renderer already uses for cuts and speed regions, so a transcript stays valid
// when the user edits afterwards.

export interface TranscriptWord {
  start: number
  end: number
  text: string
}

export interface TranscriptSegment {
  start: number
  end: number
  text: string
  /** Present only when word timings were requested; the karaoke style needs them. */
  words?: TranscriptWord[]
}

export interface TranscriptDocument {
  version: number
  language: string | null
  model: string
  durationSec: number
  segments: TranscriptSegment[]
}

/** The payload version this build understands. */
export const TRANSCRIPT_VERSION = 1

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseWord(value: unknown): TranscriptWord | null {
  if (typeof value !== 'object' || value === null) return null
  const word = value as Record<string, unknown>
  if (!isFiniteNumber(word.start) || !isFiniteNumber(word.end)) return null
  if (typeof word.text !== 'string' || word.text.length === 0) return null
  return { start: word.start, end: word.end, text: word.text }
}

function parseSegment(value: unknown): TranscriptSegment | null {
  if (typeof value !== 'object' || value === null) return null
  const segment = value as Record<string, unknown>
  if (!isFiniteNumber(segment.start) || !isFiniteNumber(segment.end)) return null
  if (typeof segment.text !== 'string') return null

  const words = Array.isArray(segment.words)
    ? segment.words.map(parseWord).filter((word): word is TranscriptWord => word !== null)
    : []

  return {
    start: segment.start,
    end: segment.end,
    text: segment.text,
    // An empty `words` array is dropped rather than kept: "no word timings" and
    // "word timings that all failed to parse" mean the same thing to every caller.
    ...(words.length > 0 ? { words } : {}),
  }
}

/**
 * Read a transcript document.
 *
 * Returns null rather than throwing: this parses bytes that came back over the
 * network, and a malformed document should surface as "the transcription came back
 * unreadable" rather than as an exception in the middle of a UI update.
 *
 * Segments that do not parse are dropped and the rest kept, so one bad row costs a
 * caption rather than the whole transcript. A document with no usable segment at
 * all is still returned — a recording of pure silence legitimately has none — and
 * `segments.length === 0` is what the caller checks.
 */
export function parseTranscript(value: unknown): TranscriptDocument | null {
  if (typeof value !== 'object' || value === null) return null
  const document = value as Record<string, unknown>
  if (!Array.isArray(document.segments)) return null
  if (!isFiniteNumber(document.durationSec)) return null

  const segments = document.segments
    .map(parseSegment)
    .filter((segment): segment is TranscriptSegment => segment !== null)
    .sort((a, b) => a.start - b.start)

  return {
    version: isFiniteNumber(document.version) ? document.version : TRANSCRIPT_VERSION,
    language: typeof document.language === 'string' ? document.language : null,
    model: typeof document.model === 'string' ? document.model : 'unknown',
    durationSec: document.durationSec,
    segments,
  }
}

/** Parse the raw bytes of a downloaded transcript file. */
export function parseTranscriptJson(raw: string): TranscriptDocument | null {
  try {
    return parseTranscript(JSON.parse(raw))
  } catch {
    return null
  }
}

/** The plain text of a transcript, for a copy action or a sidecar file. */
export function transcriptText(document: TranscriptDocument): string {
  return document.segments
    .map((segment) => segment.text.trim())
    .filter((text) => text.length > 0)
    .join(' ')
}
