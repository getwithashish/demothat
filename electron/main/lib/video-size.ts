// Reading a video's pixel size without ffprobe.
//
// The bundled FFmpeg has no ffprobe next to it, so the size is parsed out of the
// `ffmpeg -i` banner ("Stream #0:0: Video: vp9, yuv420p, 1920x1080, 30 fps").
// Used to reconcile a Wayland area selection with the resolution the portal
// actually captured, which is not knowable in advance.

import { spawn } from 'node:child_process'
import log from 'electron-log/main'
import { getFFmpegPath } from './utils'

export interface VideoSize {
  width: number
  height: number
}

/**
 * Pulls the first video stream's dimensions out of FFmpeg's stderr banner.
 * Returns null when there is no such stream or it is not a plain WxH.
 */
export function parseVideoSize(stderr: string): VideoSize | null {
  const videoLine = stderr.split('\n').find((line) => line.includes('Stream #') && line.includes('Video:'))
  if (!videoLine) return null

  // Match the dimensions that follow the pixel format, e.g. "yuv420p, 1280x720".
  // Anchoring on "Video:" keeps us clear of any resolution mentioned elsewhere
  // in the banner (an attached cover art, a metadata line, a display matrix).
  const match = videoLine.match(/Video:.*?(\d{2,5})x(\d{2,5})/)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

/** The size of a video file, or null if FFmpeg cannot tell us. */
export async function probeVideoSize(videoPath: string): Promise<VideoSize | null> {
  return new Promise<VideoSize | null>((resolve) => {
    let stderr = ''
    let settled = false
    const finish = (size: VideoSize | null) => {
      if (settled) return
      settled = true
      resolve(size)
    }

    try {
      // No output file: FFmpeg prints the banners and exits non-zero, which is
      // the expected outcome here — the exit code carries no information.
      const proc = spawn(getFFmpegPath(), ['-hide_banner', '-i', videoPath, '-f', 'null', '-'])
      proc.stderr.on('data', (data) => {
        stderr += data.toString()
        // The stream banner arrives early; stop as soon as we can read it.
        const size = parseVideoSize(stderr)
        if (size) {
          proc.kill('SIGKILL')
          finish(size)
        }
      })
      proc.on('error', (err) => {
        log.warn('[VideoSize] Could not run ffmpeg to probe the video size:', err)
        finish(null)
      })
      proc.on('close', () => finish(parseVideoSize(stderr)))
    } catch (err) {
      log.warn('[VideoSize] Probing threw:', err)
      finish(null)
    }
  })
}
