// Reading a file's audio stream and duration without ffprobe.
//
// The bundled FFmpeg has no ffprobe next to it (see `video-size.ts`), so both facts
// come out of the `ffmpeg -i` banner:
//
//   Duration: 00:00:10.04, start: 0.000000, bitrate: 1234 kb/s
//   Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo
//
// Transcription needs both: whether there is anything to transcribe, and how long
// it is — the latter is the declared length the API's preflight is priced from.

import { spawn } from 'node:child_process'
import log from 'electron-log/main'
import { getFFmpegPath } from './utils'

export interface AudioInfo {
  /** True when the file carries at least one audio stream. */
  hasAudio: boolean
  /** Length in seconds, or null when the banner does not say. */
  durationSec: number | null
}

/** The `Duration:` line, as `HH:MM:SS.ss` (or `N/A`). */
export function parseDuration(stderr: string): number | null {
  const match = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/)
  if (!match) return null
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

/** True when the banner lists an audio stream. */
export function parseHasAudio(stderr: string): boolean {
  return stderr.split('\n').some((line) => line.includes('Stream #') && line.includes('Audio:'))
}

export function parseAudioInfo(stderr: string): AudioInfo {
  return { hasAudio: parseHasAudio(stderr), durationSec: parseDuration(stderr) }
}

/**
 * Probe a local file for an audio stream and its length.
 *
 * Resolves as soon as both facts are readable, and never rejects: a file FFmpeg
 * cannot parse is reported as "no audio", which the caller turns into a plain
 * "there is nothing to transcribe here" rather than an exception.
 */
export async function probeAudio(filePath: string): Promise<AudioInfo> {
  return new Promise<AudioInfo>((resolve) => {
    let stderr = ''
    let settled = false
    const finish = (info: AudioInfo) => {
      if (settled) return
      settled = true
      resolve(info)
    }

    try {
      // No output file: FFmpeg prints the banners and exits non-zero, which is the
      // expected outcome — the exit code carries no information here.
      const proc = spawn(getFFmpegPath(), ['-hide_banner', '-i', filePath, '-f', 'null', '-'])
      proc.stderr.on('data', (data) => {
        stderr += data.toString()
        const info = parseAudioInfo(stderr)
        // The audio stream line and the Duration line both arrive with the input
        // banner, so stop reading as soon as we have seen them.
        if (info.hasAudio && info.durationSec !== null) {
          proc.kill('SIGKILL')
          finish(info)
        }
      })
      proc.on('error', (err) => {
        log.warn('[AudioInfo] Could not run ffmpeg to probe the file:', err)
        finish({ hasAudio: false, durationSec: null })
      })
      proc.on('close', () => finish(parseAudioInfo(stderr)))
    } catch (err) {
      log.warn('[AudioInfo] Probing threw:', err)
      finish({ hasAudio: false, durationSec: null })
    }
  })
}
