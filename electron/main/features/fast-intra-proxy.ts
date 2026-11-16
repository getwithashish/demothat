import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import log from 'electron-log/main'
import { getFFmpegPath } from '../lib/utils'

export interface FastIntraProxyOptions {
  sourcePath: string
  sessionDir: string
  label?: string
  ffmpegPath?: string
}

function resolveFFmpegPath(customPath?: string): string {
  if (customPath) return customPath
  try {
    return getFFmpegPath()
  } catch {
    return 'ffmpeg'
  }
}

/**
 * Generates an all-intra (keyint=1) temporary proxy video using the bundled FFmpeg.
 *
 * In long-GOP videos (standard H.264/HEVC), seeking in Chromium (`video.currentTime = t`)
 * forces the browser decoder to flush its pipeline and decode all intermediate P/B frames
 * forward from the prior keyframe (taking 40-200ms per frame).
 *
 * By transcoding the source to an all-intra proxy with ultrafast preset:
 * - Every frame is an IDR keyframe (keyint=1).
 * - Chromium seeks to any frame in <7ms without decoder pipeline stalls.
 * - Transcoding runs at 10-15x realtime speed (taking ~2.5s for a 30s video).
 *
 * If the source file cannot be read or FFmpeg fails, this function gracefully falls
 * back to returning the original source path so exports never fail.
 */
export async function generateFastIntraProxy(options: FastIntraProxyOptions): Promise<string> {
  const { sourcePath, sessionDir, label = 'video' } = options
  const ffmpegPath = resolveFFmpegPath(options.ffmpegPath)

  if (!sourcePath || !fs.existsSync(sourcePath)) {
    log.warn(`[FastIntraProxy] Source path does not exist (${sourcePath}); returning original.`)
    return sourcePath
  }

  const outputPath = path.join(sessionDir, `intra_${label}_${Date.now()}.mp4`)

  log.info(`[FastIntraProxy] Generating all-intra proxy for ${label} (${sourcePath}) -> ${outputPath}...`)
  const startTime = Date.now()

  return new Promise((resolve) => {
    const args = [
      '-y',
      '-i',
      sourcePath,
      '-c:v',
      'libx264',
      '-g',
      '1',
      '-preset',
      'ultrafast',
      '-crf',
      '18',
      '-an',
      outputPath,
    ]

    const proc = spawn(ffmpegPath, args)

    let stderr = ''
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    proc.on('error', (err) => {
      log.error(`[FastIntraProxy] Failed to spawn FFmpeg for intra proxy (${label}):`, err)
      resolve(sourcePath)
    })

    proc.on('close', (code) => {
      const elapsedMs = Date.now() - startTime
      if (code === 0 && fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath)
        log.info(
          `[FastIntraProxy] All-intra proxy generated successfully in ${elapsedMs}ms (${(stats.size / 1024 / 1024).toFixed(2)} MB).`,
        )
        resolve(outputPath)
      } else {
        log.warn(
          `[FastIntraProxy] FFmpeg exited with code ${code} for intra proxy (${label}). Falling back to original source. Stderr: ${stderr.slice(-300)}`,
        )
        resolve(sourcePath)
      }
    })
  })
}
