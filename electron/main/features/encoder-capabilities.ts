// Probes the bundled FFmpeg once for the encoders the export pipeline needs.
//
// The 8K export path hardcodes libx265, so "can we do 8K?" is exactly "does
// this FFmpeg have libx265?". Hardware HEVC encoders (nvenc, videotoolbox,
// v4l2m2m) are reported but not used: their availability and quality vary too
// much to select blindly.

import { spawn } from 'node:child_process'
import log from 'electron-log/main'
import { getFFmpegPath } from '../lib/utils'
import { parseEncoderCapabilities, type EncoderCapabilities } from '../lib/encoder-capabilities'

const FFMPEG_PATH = getFFmpegPath()

let cached: Promise<EncoderCapabilities> | null = null

export function getEncoderCapabilities(): Promise<EncoderCapabilities> {
  cached ??= probe()
  return cached
}

function probe(): Promise<EncoderCapabilities> {
  return new Promise((resolve) => {
    log.info('[EncoderCapabilities] Probing the bundled FFmpeg for encoders.')
    let stdout = ''
    const proc = spawn(FFMPEG_PATH, ['-hide_banner', '-encoders'])

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    proc.on('error', (error) => {
      log.error('[EncoderCapabilities] Could not run FFmpeg:', error)
      resolve({ libx265: false, hevcEncoders: [] })
    })
    proc.on('close', () => {
      const capabilities = parseEncoderCapabilities(stdout)
      log.info('[EncoderCapabilities] Detected:', capabilities)
      resolve(capabilities)
    })
  })
}
