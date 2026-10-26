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

/** One audio stream of a file, as the banner describes it. */
export interface AudioStreamInfo {
  /** Position among the file's audio streams: `a:0`, `a:1`. This is what `-map` uses. */
  audioIndex: number
  /** The stream's index in the whole file, `Stream #0:N`. */
  streamIndex: number
  /**
   * The container's name for the track. The recorder's mux writes `mic` or
   * `system` here; a recording made before the sources were separated has none.
   */
  handlerName: string | null
  codec: string | null
  channels: number | null
  sampleRate: number | null
}

/**
 * Every audio stream in the banner, in file order.
 *
 * The banner is the only source for this — there is no ffprobe — and the name
 * arrives in the per-stream `Metadata:` block that follows the stream line, so a
 * stream's details and its name are read from the same block.
 */
export function parseAudioStreams(stderr: string): AudioStreamInfo[] {
  // Split into one chunk per stream, so a Metadata block is attributed to the
  // stream it belongs to rather than to whichever one came first.
  const chunks = stderr.split(/\n\s*Stream #/).slice(1)
  const streams: AudioStreamInfo[] = []
  let audioIndex = 0

  for (const chunk of chunks) {
    const head = chunk.split('\n')[0] ?? ''
    const indices = head.match(/^(\d+):(\d+)/)
    if (!indices) continue
    if (!/Audio:/.test(head)) continue

    const codec = head.match(/Audio:\s*([A-Za-z0-9_]+)/)
    const sampleRate = head.match(/(\d+)\s*Hz/)
    const channels = head.match(/(mono|stereo)/)
    const channelCount = head.match(/(\d+)\s*channels/)
    const name = chunk.match(/handler_name\s*:\s*([^\r\n]+)/)

    streams.push({
      audioIndex,
      streamIndex: Number(indices[2]),
      handlerName: name ? name[1].trim() : null,
      codec: codec ? codec[1] : null,
      sampleRate: sampleRate ? Number(sampleRate[1]) : null,
      channels: channels ? (channels[1] === 'mono' ? 1 : 2) : channelCount ? Number(channelCount[1]) : null,
    })
    audioIndex += 1
  }

  return streams
}

/**
 * Probe a local file for all of its audio streams.
 *
 * Runs FFmpeg with no output file on purpose: it prints the input banner — every
 * stream, with its metadata — and then exits complaining about the missing output.
 * Nothing is decoded, so this costs a process spawn and not a pass over the file.
 */
export async function probeAudioStreams(filePath: string): Promise<AudioStreamInfo[]> {
  return new Promise<AudioStreamInfo[]>((resolve) => {
    let stderr = ''
    try {
      const proc = spawn(getFFmpegPath(), ['-hide_banner', '-i', filePath])
      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })
      proc.on('error', (err) => {
        log.warn('[AudioInfo] Could not run ffmpeg to probe streams:', err)
        resolve([])
      })
      // A non-zero exit is the expected outcome here, so the code is ignored.
      proc.on('close', () => resolve(parseAudioStreams(stderr)))
    } catch (err) {
      log.warn('[AudioInfo] Probing streams threw:', err)
      resolve([])
    }
  })
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
