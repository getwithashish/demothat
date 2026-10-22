// Pulling a recording's audio tracks out into files the preview can play.
//
// The preview mixes the microphone and the system audio with independent gain, and
// an HTML `<video>` element plays exactly one audio track — there is no way to give
// two MediaElementSources to one element. So each stream is demuxed into its own
// file and the renderer drives them through Web Audio alongside the video.
//
// The extraction is a **stream copy**: the bytes are already AAC, so this is a
// demux and not a decode, and it costs a fraction of the recording's length in
// wall time. Re-encoding here would also mean the preview plays audio that has been
// through a lossy encoder once more than the export has — the preview would no
// longer be the thing the export produces.
//
// Extracted files are cached under the app's own data directory, keyed on the
// recording's identity (path, size, mtime), so re-opening the same recording does
// not extract it again and a re-recording to the same path does.

import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { app } from 'electron'
import log from 'electron-log/main'
import { getFFmpegPath } from '../lib/utils'
import type { AudioTrack } from '../../../shared/audio-tracks'

/** `-map 0:a:<index> -c copy`, into an m4a. */
export function buildExtractArgs(input: string, output: string, audioIndex: number): string[] {
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    input,
    // Only this one stream: without it FFmpeg would pick a default and the two
    // extracted files could end up holding the same source.
    '-map',
    '0:a:' + String(audioIndex),
    '-c',
    'copy',
    output,
  ]
}

/**
 * The re-encode fallback, for a recording whose audio is not AAC.
 *
 * The recorder's mux always writes AAC, but a project can hold a recording made
 * before it, or a file the user brought in, and a stream copy of Opus into an MP4
 * fails outright. One fallback beats a preview with no sound and no explanation.
 */
export function buildReencodeExtractArgs(input: string, output: string, audioIndex: number): string[] {
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    input,
    '-map',
    '0:a:' + String(audioIndex),
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    output,
  ]
}

/**
 * A key that identifies one version of a recording.
 *
 * The modification time and the size are in it, so a re-recording over the same
 * path gets a new cache entry rather than silently serving the old audio — which
 * would be a preview of a recording that no longer exists.
 */
export function trackCacheKey(filePath: string, size: number, mtimeMs: number): string {
  return crypto.createHash('sha1').update(`${filePath}\u0000${size}\u0000${mtimeMs}`).digest('hex').slice(0, 16)
}

/** Where an extracted track lives. */
export function trackCachePath(key: string, trackId: string): string {
  return path.join(app.getPath('userData'), 'audio-cache', key, `${trackId}.m4a`)
}

function runFfmpeg(args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    let stderr = ''
    try {
      const proc = spawn(getFFmpegPath(), args)
      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })
      proc.on('error', (err) => resolve({ code: null, stderr: String(err) }))
      proc.on('close', (code) => resolve({ code, stderr }))
    } catch (err) {
      resolve({ code: null, stderr: String(err) })
    }
  })
}

export interface ExtractedTrack {
  id: string
  index: number
  /** Absolute path of the extracted file, which the renderer plays. */
  filePath: string
}

/**
 * Extract the given tracks of a recording into cache files.
 *
 * Tracks already extracted are left alone. A track that cannot be extracted at all
 * is omitted rather than reported as an empty file: a missing lane is a silence the
 * user can see is missing, and a zero-length file is a decoder error they cannot.
 */
export async function extractAudioTracks(filePath: string, tracks: AudioTrack[]): Promise<ExtractedTrack[]> {
  if (tracks.length === 0) return []

  let key: string
  try {
    const stats = await fsp.stat(filePath)
    key = trackCacheKey(filePath, stats.size, stats.mtimeMs)
  } catch (err) {
    log.warn('[AudioTracks] Cannot stat the recording, so nothing can be extracted:', err)
    return []
  }

  const extracted: ExtractedTrack[] = []
  for (const track of tracks) {
    const output = trackCachePath(key, track.id)
    try {
      // Already there from a previous open of this exact recording.
      const existing = await fsp.stat(output)
      if (existing.size > 0) {
        extracted.push({ id: track.id, index: track.index, filePath: output })
        continue
      }
    } catch {
      // Not extracted yet.
    }

    await fsp.mkdir(path.dirname(output), { recursive: true })

    let result = await runFfmpeg(buildExtractArgs(filePath, output, track.index))
    if (result.code !== 0) {
      log.info(`[AudioTracks] Stream copy failed for a:${track.index}, re-encoding instead.`)
      result = await runFfmpeg(buildReencodeExtractArgs(filePath, output, track.index))
    }

    if (result.code !== 0) {
      log.warn(`[AudioTracks] Could not extract a:${track.index}: ${result.stderr.slice(-300)}`)
      await fsp.rm(output, { force: true }).catch(() => undefined)
      continue
    }

    extracted.push({ id: track.id, index: track.index, filePath: output })
  }

  return extracted
}
