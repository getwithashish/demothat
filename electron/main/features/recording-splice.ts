// Splicing screen recordings, webcam videos, and merging cursor metadata.
//
// When a user records a clip into an active editor timeline, this service splices
// the new footage into the master recording at insertTime:
//   Part 1: [0 .. insertTime] from original
//   Part 2: [0 .. newDuration] from new
//   Part 3: [insertTime .. end] from original (if insertTime < original duration)
//
// Concat parts into a single seamless output file, ensuring matching sample rates
// and timestamps, and merges cursor metadata JSON with shifted timestamps.

import { spawn } from 'node:child_process'
import path from 'node:path'
import fsPromises from 'node:fs/promises'
import log from 'electron-log/main'
import { getFFmpegPath } from '../lib/utils'
import { parseDuration } from '../lib/audio-info'
import { probeAudioTracks } from './audio-tracks'

export interface MouseEventItem {
  timestamp: number
  x?: number
  y?: number
  type?: string
  button?: string
  pressed?: boolean
  cursorImageKey?: string
  [key: string]: unknown
}

export interface RecordingMetadata {
  platform?: string
  screenSize?: { width: number; height: number }
  geometry?: { x: number; y: number; width: number; height: number }
  syncOffset?: number
  avSyncOffsetMs?: number
  cursorImages?: Record<string, unknown>
  events?: MouseEventItem[]
  audioTracks?: unknown[]
  [key: string]: unknown
}

export interface SpliceRecordingOptions {
  originalVideoPath: string
  originalMetadataPath: string
  originalWebcamPath?: string
  newVideoPath: string
  newMetadataPath: string
  newWebcamPath?: string
  insertTime: number
}

export interface SpliceRecordingResult {
  screenVideoPath: string
  metadataPath: string
  webcamVideoPath?: string
  addedDuration: number
}

/** The screen file's length in seconds, from the FFmpeg banner, or null. */
export async function probeVideoDurationSec(videoPath: string): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    let stderr = ''
    try {
      const proc = spawn(getFFmpegPath(), ['-hide_banner', '-i', videoPath])
      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })
      proc.on('error', () => resolve(null))
      proc.on('close', () => resolve(parseDuration(stderr)))
    } catch {
      resolve(null)
    }
  })
}

/** Runs FFmpeg with given args and returns exit code and stderr. */
export async function runFfmpeg(args: string[]): Promise<{ code: number | null; stderr: string }> {
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

/**
 * Builds FFmpeg args to extract and re-encode a video segment to standardized parameters.
 * Guarantees matching codecs, sample rate (48kHz), and pixel format across all stitched parts.
 */
export function buildExtractPartArgs(options: {
  inputPath: string
  startTime?: number
  duration?: number
  outputPath: string
  hasAudio: boolean
}): string[] {
  const { inputPath, startTime, duration, outputPath, hasAudio } = options
  const args = ['-y']
  if (typeof startTime === 'number' && startTime > 0) {
    args.push('-ss', startTime.toFixed(3))
  }
  if (typeof duration === 'number' && duration > 0) {
    args.push('-t', duration.toFixed(3))
  }
  args.push('-i', inputPath)
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p')
  if (hasAudio) {
    args.push('-c:a', 'aac', '-ar', '48000', '-ac', '2')
  } else {
    args.push('-an')
  }
  args.push(outputPath)
  return args
}

/** Builds FFmpeg args to concat pre-encoded video parts using concat demuxer. */
export function buildConcatArgs(concatListPath: string, outputPath: string): string[] {
  return ['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', '-movflags', '+faststart', outputPath]
}

/**
 * Merges cursor metadata JSON from original and new recordings:
 * - Events with timestamp <= insertTime stay as-is.
 * - Events from newMetadataPath have timestamp shifted by +insertTime.
 * - Events with timestamp > insertTime shift by +newDuration.
 * - Geometry, screen size, cursorImages, and audioTracks are merged cleanly.
 */
export function mergeMetadata(
  originalMetadata: RecordingMetadata,
  newMetadata: RecordingMetadata,
  insertTime: number,
  newDuration: number,
): RecordingMetadata {
  const origEvents = Array.isArray(originalMetadata?.events) ? [...originalMetadata.events] : []
  const newEvents = Array.isArray(newMetadata?.events) ? [...newMetadata.events] : []

  // In DemoThat, metadata events store timestamps in milliseconds.
  // If insertTime and newDuration are given in seconds (< 100), but event timestamps are > 100,
  // we scale insertTime and newDuration by 1000 for event math.
  const allTimestamps = [...origEvents, ...newEvents].map((e) =>
    typeof e?.timestamp === 'number' && Number.isFinite(e.timestamp) ? e.timestamp : 0,
  )
  const maxTimestamp = allTimestamps.length > 0 ? Math.max(...allTimestamps) : 0

  let scale = 1
  if (maxTimestamp > 100 && insertTime < 100 && newDuration < 100) {
    scale = 1000
  }

  const effectiveInsertTime = insertTime * scale
  const effectiveNewDuration = newDuration * scale

  // Part 1 events: timestamp <= insertTime from original (stay as-is)
  const part1Events = origEvents
    .filter((e) => typeof e?.timestamp === 'number' && e.timestamp <= effectiveInsertTime)
    .map((e) => ({ ...e }))

  // Part 2 events: events from newMetadataPath have timestamp shifted by +insertTime
  const part2Events = newEvents
    .filter((e) => typeof e?.timestamp === 'number')
    .map((e) => ({
      ...e,
      timestamp: e.timestamp + effectiveInsertTime,
    }))

  // Part 3 events: events with timestamp > insertTime from original shift by +newDuration
  const part3Events = origEvents
    .filter((e) => typeof e?.timestamp === 'number' && e.timestamp > effectiveInsertTime)
    .map((e) => ({
      ...e,
      timestamp: e.timestamp + effectiveNewDuration,
    }))

  const mergedEvents = [...part1Events, ...part2Events, ...part3Events].sort((a, b) => a.timestamp - b.timestamp)

  return {
    platform: originalMetadata?.platform || newMetadata?.platform || process.platform,
    screenSize: originalMetadata?.screenSize || newMetadata?.screenSize,
    geometry: originalMetadata?.geometry || newMetadata?.geometry,
    syncOffset: originalMetadata?.syncOffset ?? newMetadata?.syncOffset ?? 0,
    avSyncOffsetMs: originalMetadata?.avSyncOffsetMs ?? newMetadata?.avSyncOffsetMs ?? 0,
    cursorImages: {
      ...(originalMetadata?.cursorImages || {}),
      ...(newMetadata?.cursorImages || {}),
    },
    events: mergedEvents,
    audioTracks:
      originalMetadata?.audioTracks && originalMetadata.audioTracks.length > 0
        ? originalMetadata.audioTracks
        : newMetadata?.audioTracks || [],
  }
}

/**
 * Splices two video files (original and new) at insertTime using FFmpeg.
 */
export async function spliceVideoFiles(options: {
  originalPath: string
  newPath: string
  insertTime: number
  originalDuration: number
  newDuration: number
  outputPath: string
}): Promise<string> {
  const { originalPath, newPath, insertTime, originalDuration, newDuration, outputPath } = options

  // Probe audio presence
  const origAudioTracks = await probeAudioTracks(originalPath).catch(() => [])
  const newAudioTracks = await probeAudioTracks(newPath).catch(() => [])
  const hasAudio = origAudioTracks.length > 0 || newAudioTracks.length > 0

  const dir = path.dirname(outputPath)
  const prefix = `splice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const partPaths: string[] = []
  const tempFiles: string[] = []

  try {
    if (insertTime <= 0) {
      // Prepend: newPath then originalPath
      const p1 = path.join(dir, `${prefix}_p1.mp4`)
      const p2 = path.join(dir, `${prefix}_p2.mp4`)
      tempFiles.push(p1, p2)

      const res1 = await runFfmpeg(
        buildExtractPartArgs({ inputPath: newPath, duration: newDuration, outputPath: p1, hasAudio }),
      )
      if (res1.code !== 0) throw new Error(`Failed to extract new clip part: ${res1.stderr}`)

      const res2 = await runFfmpeg(buildExtractPartArgs({ inputPath: originalPath, outputPath: p2, hasAudio }))
      if (res2.code !== 0) throw new Error(`Failed to extract original clip part: ${res2.stderr}`)

      partPaths.push(p1, p2)
    } else if (originalDuration > 0 && insertTime >= originalDuration) {
      // Append: originalPath then newPath
      const p1 = path.join(dir, `${prefix}_p1.mp4`)
      const p2 = path.join(dir, `${prefix}_p2.mp4`)
      tempFiles.push(p1, p2)

      const res1 = await runFfmpeg(buildExtractPartArgs({ inputPath: originalPath, outputPath: p1, hasAudio }))
      if (res1.code !== 0) throw new Error(`Failed to extract original clip part: ${res1.stderr}`)

      const res2 = await runFfmpeg(
        buildExtractPartArgs({ inputPath: newPath, duration: newDuration, outputPath: p2, hasAudio }),
      )
      if (res2.code !== 0) throw new Error(`Failed to extract new clip part: ${res2.stderr}`)

      partPaths.push(p1, p2)
    } else {
      // Middle splice:
      // Part 1: [0 .. insertTime] from original
      // Part 2: [0 .. newDuration] from new
      // Part 3: [insertTime .. end] from original
      const p1 = path.join(dir, `${prefix}_p1.mp4`)
      const p2 = path.join(dir, `${prefix}_p2.mp4`)
      const p3 = path.join(dir, `${prefix}_p3.mp4`)
      tempFiles.push(p1, p2, p3)

      const res1 = await runFfmpeg(
        buildExtractPartArgs({ inputPath: originalPath, startTime: 0, duration: insertTime, outputPath: p1, hasAudio }),
      )
      if (res1.code !== 0) throw new Error(`Failed to extract Part 1: ${res1.stderr}`)

      const res2 = await runFfmpeg(
        buildExtractPartArgs({ inputPath: newPath, startTime: 0, duration: newDuration, outputPath: p2, hasAudio }),
      )
      if (res2.code !== 0) throw new Error(`Failed to extract Part 2: ${res2.stderr}`)

      const res3 = await runFfmpeg(
        buildExtractPartArgs({ inputPath: originalPath, startTime: insertTime, outputPath: p3, hasAudio }),
      )
      if (res3.code !== 0) throw new Error(`Failed to extract Part 3: ${res3.stderr}`)

      partPaths.push(p1, p2, p3)
    }

    // Write concat file
    const concatListPath = path.join(dir, `${prefix}_concat.txt`)
    tempFiles.push(concatListPath)
    const concatContent = partPaths.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n')
    await fsPromises.writeFile(concatListPath, concatContent, 'utf8')

    // Concat parts into single seamless output file
    const concatRes = await runFfmpeg(buildConcatArgs(concatListPath, outputPath))
    if (concatRes.code !== 0) throw new Error(`Failed to concat spliced parts: ${concatRes.stderr}`)

    return outputPath
  } finally {
    // Clean up temporary segment and manifest files
    await Promise.all(tempFiles.map((f) => fsPromises.unlink(f).catch(() => {})))
  }
}

/**
 * Splicing service:
 * 1. Splices screen recordings at insertTime via FFmpeg concat.
 * 2. Handles webcam video splicing if webcam was recorded.
 * 3. Merges cursor metadata JSON with shifted timestamps.
 */
export async function spliceRecordingIntoProject(options: SpliceRecordingOptions): Promise<SpliceRecordingResult> {
  const {
    originalVideoPath,
    originalMetadataPath,
    originalWebcamPath,
    newVideoPath,
    newMetadataPath,
    newWebcamPath,
    insertTime,
  } = options

  log.info('[RecordingSplice] Splicing recording into project:', {
    originalVideoPath,
    newVideoPath,
    insertTime,
  })

  // 1. Probe durations
  const originalDuration = (await probeVideoDurationSec(originalVideoPath)) ?? 0
  const newDuration = (await probeVideoDurationSec(newVideoPath)) ?? 0

  log.info(`[RecordingSplice] Durations: original=${originalDuration}s, new=${newDuration}s, insertTime=${insertTime}s`)

  const clampedInsertTime = Math.max(0, originalDuration > 0 ? Math.min(originalDuration, insertTime) : insertTime)
  const addedDuration = newDuration

  const dir = path.dirname(originalVideoPath)
  const timestamp = Date.now()
  const screenVideoPath = path.join(dir, `spliced-${timestamp}-screen.mp4`)
  const metadataPath = path.join(dir, `spliced-${timestamp}.json`)

  // 2. Splice screen video
  await spliceVideoFiles({
    originalPath: originalVideoPath,
    newPath: newVideoPath,
    insertTime: clampedInsertTime,
    originalDuration,
    newDuration,
    outputPath: screenVideoPath,
  })

  // 3. Splice webcam video (if recorded)
  let webcamVideoPath: string | undefined
  if (originalWebcamPath && newWebcamPath) {
    try {
      const origWebcamStat = await fsPromises.stat(originalWebcamPath).catch(() => null)
      const newWebcamStat = await fsPromises.stat(newWebcamPath).catch(() => null)
      if (origWebcamStat && newWebcamStat) {
        const outWebcam = path.join(dir, `spliced-${timestamp}-webcam.mp4`)
        const origWbDuration = (await probeVideoDurationSec(originalWebcamPath)) ?? originalDuration
        const newWbDuration = (await probeVideoDurationSec(newWebcamPath)) ?? newDuration
        await spliceVideoFiles({
          originalPath: originalWebcamPath,
          newPath: newWebcamPath,
          insertTime: clampedInsertTime,
          originalDuration: origWbDuration,
          newDuration: newWbDuration,
          outputPath: outWebcam,
        })
        webcamVideoPath = outWebcam
      }
    } catch (err) {
      log.warn('[RecordingSplice] Webcam splicing failed, skipping webcam:', err)
      webcamVideoPath = originalWebcamPath
    }
  } else if (originalWebcamPath) {
    webcamVideoPath = originalWebcamPath
  } else if (newWebcamPath) {
    webcamVideoPath = newWebcamPath
  }

  // 4. Merge cursor metadata JSON
  let origMeta: RecordingMetadata = {}
  try {
    const raw = await fsPromises.readFile(originalMetadataPath, 'utf8')
    origMeta = JSON.parse(raw)
  } catch (err) {
    log.warn('[RecordingSplice] Failed to read original metadata, using fallback:', err)
  }

  let newMeta: RecordingMetadata = {}
  try {
    const raw = await fsPromises.readFile(newMetadataPath, 'utf8')
    newMeta = JSON.parse(raw)
  } catch (err) {
    log.warn('[RecordingSplice] Failed to read new metadata, using fallback:', err)
  }

  const mergedMetadata = mergeMetadata(origMeta, newMeta, clampedInsertTime, newDuration)
  await fsPromises.writeFile(metadataPath, JSON.stringify(mergedMetadata, null, 2), 'utf8')

  log.info('[RecordingSplice] Splice completed successfully:', {
    screenVideoPath,
    metadataPath,
    webcamVideoPath,
    addedDuration,
  })

  return {
    screenVideoPath,
    metadataPath,
    webcamVideoPath,
    addedDuration,
  }
}
