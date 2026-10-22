// Extract a recording's audio track for cloud transcription.
//
// Two decisions, both about the upload rather than the audio:
//
// * **16 kHz mono AAC.** Whisper resamples to 16 kHz mono internally, so sending
//   anything else is bytes for nothing: a ten-minute recording is ~14 MB of 192 kbps
//   stereo, and ~4 MB this way.
// * **M4A, not WAV.** It is AAC in an MP4 container, which is exactly what the
//   worker's audio-mode probe accepts (m4a is in the MP4 family it validates), and
//   it keeps the presigned upload small.
//
// The video is never touched: `-vn` means the extraction cannot accidentally
// re-encode or resize the recording.

import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import log from 'electron-log/main'
import { getFFmpegPath } from '../lib/utils'

/** The sample rate Whisper wants, and the one we upload. */
export const TRANSCRIBE_SAMPLE_RATE = 16_000

/** Mono, 48 kbps: speech at 16 kHz does not need more, and it halves the upload. */
export const TRANSCRIBE_BITRATE = '48k'

export interface AudioExtractArgsInput {
  sourcePath: string
  outputPath: string
}

/**
 * The FFmpeg argv for the extraction. Pure, so the test can assert the shape of the
 * command without spawning anything.
 */
export function buildAudioExtractArgs({ sourcePath, outputPath }: AudioExtractArgsInput): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    // Recording output paths survive failed attempts; never wait for a prompt.
    '-y',
    '-i',
    sourcePath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    String(TRANSCRIBE_SAMPLE_RATE),
    '-c:a',
    'aac',
    '-b:a',
    TRANSCRIBE_BITRATE,
    '-movflags',
    '+faststart',
    // Progress on stdout, machine-readable, so the dialog can show something real.
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath,
  ]
}

export interface ExtractAudioOptions extends AudioExtractArgsInput {
  /** Percent complete, when the duration is known. */
  onProgress?: (percent: number) => void
  /** Length of the source, used only to turn FFmpeg's clock into a percentage. */
  durationSec?: number | null
  signal?: AbortSignal
}

export interface ExtractedAudio {
  path: string
  bytes: number
}

/** Read FFmpeg's `-progress` stream for `out_time_us` and report a percentage. */
export function progressPercentFromOutTime(chunk: string, durationSec: number | null | undefined): number | null {
  if (!durationSec || durationSec <= 0) return null
  // The progress stream is a block of `key=value` lines per interval, so the most
  // recent clock is the *last* `out_time_us` in what has arrived — not the last line,
  // which is usually some other key.
  const matches = [...chunk.matchAll(/out_time_us=(\d+)/g)]
  const last = matches[matches.length - 1]
  if (!last) return null
  const seconds = Number(last[1]) / 1_000_000
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return Math.max(0, Math.min(100, Math.round((seconds / durationSec) * 100)))
}

/**
 * Extract the audio track to `outputPath`.
 *
 * Rejects with a plain message on failure: the caller shows it to the user, and the
 * interesting part is FFmpeg's own last words, not a stack trace.
 */
export async function extractAudioForTranscription(options: ExtractAudioOptions): Promise<ExtractedAudio> {
  const { outputPath, durationSec, onProgress, signal } = options

  return new Promise<ExtractedAudio>((resolve, reject) => {
    const proc = spawn(getFFmpegPath(), buildAudioExtractArgs(options))
    let stderr = ''
    let stdout = ''
    let settled = false

    const finish = (error: Error | null, result?: ExtractedAudio) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else if (result) resolve(result)
    }

    signal?.addEventListener('abort', () => {
      proc.kill('SIGKILL')
      finish(new Error('Audio extraction cancelled'))
    })

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
      // The progress stream arrives in small blocks; the parser takes the most
      // recent clock it can see, so a partial trailing line is harmless.
      const percent = progressPercentFromOutTime(stdout, durationSec)
      if (percent !== null) onProgress?.(percent)
    })
    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })
    proc.on('error', (err) => {
      log.error('[AudioExtract] Could not run ffmpeg:', err)
      finish(new Error('Could not run the bundled FFmpeg to extract audio.'))
    })
    proc.on('close', (code) => {
      if (code !== 0) {
        log.error(`[AudioExtract] ffmpeg exited ${code}: ${stderr.slice(-500)}`)
        finish(new Error(`Could not extract the audio track: ${stderr.trim().split('\n').slice(-1)[0] ?? `exit ${code}`}`))
        return
      }
      void fsp
        .stat(outputPath)
        .then((stat) => finish(null, { path: outputPath, bytes: stat.size }))
        .catch(() => finish(new Error('Audio extraction produced no file.')))
    })
  })
}
