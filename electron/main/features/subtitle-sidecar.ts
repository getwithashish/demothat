// The caption sidecar beside an exported video.
//
// The captions are a separate file, not pixels: the export writes the video it was
// always going to write and then writes the captions next to it. So a failure here
// must not fail the export — a video without its subtitles is still the video, and
// the user can export again.
//
// The cues are normalized again on the way out, not just when they were created. The
// editor lets the user drag a cue's edges and retype its text, and the guarantees the
// file format needs — sorted, non-overlapping, long enough to read — are about what
// is written, not about how it was produced.

import fsp from 'node:fs/promises'
import path from 'node:path'
import log from 'electron-log/main'
import { formatSubtitles, normalizeCues, type SubtitleCue, type SubtitleFormat } from '../../../shared/subtitles'

/**
 * Where the sidecar goes: beside the video, sharing its name.
 *
 * The extension is replaced rather than appended, so `holiday.mp4` gets
 * `holiday.srt` — the convention every player looks for when it auto-loads captions.
 * `holiday.mp4.srt` would not be found by most of them.
 */
export function sidecarPath(outputPath: string, format: SubtitleFormat): string {
  const extension = path.extname(outputPath)
  const withoutExtension = extension ? outputPath.slice(0, -extension.length) : outputPath
  return `${withoutExtension}.${format}`
}

export interface WriteSidecarOptions {
  /** The video that was just written. */
  outputPath: string
  cues: SubtitleCue[]
  format: SubtitleFormat
  /** False when the user has not asked for a sidecar. */
  enabled: boolean
}

export interface SidecarResult {
  written: boolean
  /** Where it went, when it did. */
  path?: string
  /** Why it did not, when it did not. */
  error?: string
}

/**
 * Write the caption sidecar, if there is one to write.
 *
 * Returns rather than throws: the caller has a finished video and a user waiting for
 * it, and neither should be held up by a file that could not be written.
 */
export async function writeSubtitleSidecar(options: WriteSidecarOptions): Promise<SidecarResult> {
  const { outputPath, cues, format, enabled } = options

  // Nothing to write is not a failure. A project with captions switched off, or one
  // whose transcript was empty, gets no file — and no empty file either, which a
  // player would offer as an empty caption track.
  if (!enabled) return { written: false }
  const normalized = normalizeCues(cues)
  if (normalized.length === 0) return { written: false }

  const target = sidecarPath(outputPath, format)
  try {
    await fsp.writeFile(target, formatSubtitles(normalized, format), 'utf8')
    log.info(`[Subtitles] Wrote ${normalized.length} caption(s) to ${target}`)
    return { written: true, path: target }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn(`[Subtitles] Could not write the caption sidecar: ${message}`)
    return { written: false, error: message }
  }
}
