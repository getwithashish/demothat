// Subtitles: the cues, and the sidecar files they become.
//
// Sidecar only. The captions are a separate `.srt` or `.vtt` next to the exported
// video, not pixels burned into it — a burned-in caption cannot be turned off,
// restyled, translated or corrected afterwards, and the styles the app offers would
// be frozen into the file at the moment of export.
//
// Cue times are **export time**, not the recording's own time. The transcript arrives
// in source time (it is a transcription of the recording), so it is mapped through
// the same timeline the picture and the audio use — which means a cut moves the
// captions with the material they belong to, and a speed region keeps them in step
// with the words as they are heard.

import type { TranscriptDocument } from './transcript'

export interface SubtitleCue {
  id: string
  /** Seconds into the exported video. */
  start: number
  /** Seconds into the exported video; always after `start`. */
  end: number
  text: string
}

/** Roughly what a subtitle line holds before it is hard to read. */
export const DEFAULT_MAX_CHARS_PER_LINE = 42
/** Two lines is the convention; a third is a wall of text over the picture. */
export const DEFAULT_MAX_LINES = 2
/** Below this a cue is on screen too briefly to read. */
export const DEFAULT_MIN_DURATION_SEC = 0.6

/**
 * `HH:MM:SS,mmm` — the format SRT uses, with a comma before the milliseconds.
 *
 * Worked out in whole milliseconds rather than by rounding the fraction, because
 * rounding 59.9996 up to 60.000 would produce a timestamp no parser accepts.
 */
export function formatSrtTimestamp(seconds: number): string {
  const totalMs = Math.round(Math.max(0, seconds) * 1000)
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const secs = Math.floor((totalMs % 60_000) / 1000)
  const millis = totalMs % 1000

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

/** `HH:MM:SS.mmm` — the same thing WebVTT wants, with a dot. */
export function formatVttTimestamp(seconds: number): string {
  return formatSrtTimestamp(seconds).replace(',', '.')
}

/**
 * Break a cue's text into readable lines.
 *
 * Wrapped at word boundaries: a subtitle that breaks mid-word is harder to read than
 * one that runs a little long. A word longer than the line is left whole rather than
 * split, because splitting it would be the worse of the two.
 */
export function wrapCueText(
  text: string,
  maxCharsPerLine: number = DEFAULT_MAX_CHARS_PER_LINE,
  maxLines: number = DEFAULT_MAX_LINES,
): string {
  const words = text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
  if (words.length === 0) return ''

  const lines: string[] = []
  let current = ''

  for (const word of words) {
    if (current.length === 0) {
      current = word
      continue
    }
    if (current.length + 1 + word.length <= maxCharsPerLine) {
      current = `${current} ${word}`
      continue
    }
    lines.push(current)
    current = word
  }
  if (current.length > 0) lines.push(current)

  // More lines than the convention allows: keep the first ones and let the last line
  // take the remainder, rather than dropping words the speaker actually said.
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines - 1)
    kept.push(lines.slice(maxLines - 1).join(' '))
    return kept.join('\n')
  }

  return lines.join('\n')
}

export interface CueNormalizeOptions {
  minDurationSec?: number
  maxCharsPerLine?: number
  maxLines?: number
}

/**
 * Put a cue list into the shape a subtitle file needs.
 *
 * Sorted, non-empty, non-overlapping and long enough to read. Overlaps are removed
 * rather than left in: two captions on screen at once is a rendering decision each
 * player makes differently, and the file should not be asking the question. A cue
 * that has been left too short to read is extended into the gap after it, and one
 * that cannot be extended is kept short rather than dropped — the words were said.
 */
export function normalizeCues(cues: SubtitleCue[], options: CueNormalizeOptions = {}): SubtitleCue[] {
  const minDuration = options.minDurationSec ?? DEFAULT_MIN_DURATION_SEC

  const ordered = cues
    .filter((cue) => cue.text.trim().length > 0)
    .map((cue) => ({
      ...cue,
      text: wrapCueText(cue.text, options.maxCharsPerLine, options.maxLines),
      start: Math.max(0, cue.start),
      end: cue.end,
    }))
    .filter((cue) => cue.end > cue.start)
    .sort((a, b) => a.start - b.start)

  const result: SubtitleCue[] = []
  for (let index = 0; index < ordered.length; index += 1) {
    const cue = ordered[index] as SubtitleCue
    const next = ordered[index + 1]

    // How far this cue may run: up to the next one, or — for the last cue — as long
    // as the minimum reading time needs.
    const limit = next ? Math.max(cue.start, next.start) : Math.max(cue.end, cue.start + minDuration)
    // Its own end, extended to the minimum reading time where there is room, and
    // never past the limit. An overlap is trimmed to the limit: two captions on
    // screen at once is a question the file should not be asking, because each player
    // answers it differently.
    const end = Math.min(Math.max(cue.end, Math.min(cue.start + minDuration, limit)), limit)

    // No room at all — a cue that shares its instant with the next one, or an empty
    // one. Dropped rather than written as a zero-length cue, which some players show
    // as a flash and others ignore.
    if (end <= cue.start) continue
    result.push({ ...cue, end })
  }

  return result
}

/**
 * Turn a transcript into cues on the export's timeline.
 *
 * `mapSourceToExport` is the timeline the export uses, so a segment inside a cut maps
 * to a zero-length cue and disappears — the words were removed from the video, and a
 * caption for them would be on screen over material that is not there.
 */
export function cuesFromTranscript(
  transcript: TranscriptDocument,
  mapSourceToExport: (sourceTime: number) => number,
  options: CueNormalizeOptions = {},
): SubtitleCue[] {
  const cues = transcript.segments.map((segment, index) => ({
    id: `cue-${index}-${Math.round(segment.start * 1000)}`,
    start: mapSourceToExport(segment.start),
    end: mapSourceToExport(segment.end),
    text: segment.text,
  }))

  return normalizeCues(cues, options)
}

/** The sidecar's text. */
export function toSrt(cues: SubtitleCue[]): string {
  return cues
    .map((cue, index) => {
      // SRT numbers its cues from one, and a reader may rely on the order.
      const counter = index + 1
      return `${counter}\n${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}\n${cue.text}\n`
    })
    .join('\n')
}

/** The sidecar's text, as WebVTT. */
export function toVtt(cues: SubtitleCue[]): string {
  const body = cues
    .map((cue) => `${formatVttTimestamp(cue.start)} --> ${formatVttTimestamp(cue.end)}\n${cue.text}\n`)
    .join('\n')

  // The header is required, and the blank line after it is what separates it from the
  // first cue.
  return `WEBVTT\n\n${body}`
}

/** Which sidecar file a set of cues belongs in. */
export type SubtitleFormat = 'srt' | 'vtt'

export function subtitleFileExtension(format: SubtitleFormat): string {
  return `.${format}`
}

/** The sidecar's contents, in the requested format. */
export function formatSubtitles(cues: SubtitleCue[], format: SubtitleFormat): string {
  return format === 'vtt' ? toVtt(cues) : toSrt(cues)
}
