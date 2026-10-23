// How much the screen was changing, second by second.
//
// There is no keyboard telemetry to read — the recorder tracks the mouse — so "the
// user was typing, or waiting on a spinner" has to be measured from the picture. What
// the detector wants is not what is on screen but *how much of it moved*, and FFmpeg
// can be asked that directly:
//
//   fps=1            one sample per second, which is the resolution a speed region
//                    needs and a fortieth of the work of doing it per frame
//   scale=64:36      a thumbnail, because a character appearing is a few pixels and
//                    the difference is what matters, not where it was
//   format=gray      one channel, since colour does not change the answer
//   tblend           each frame minus the one before it — the difference frame
//   signalstats      and its average luma, which is how much of it moved
//
// The result is 0-255 of average difference, normalized here to 0-1. Zero is a
// still screen; typing is a fraction of a percent; a video playing is percent
// several. That is what makes it useful: a spinner, a progress bar and typing all
// land in the same low band, and all three are time the viewer is waiting.

import { spawn } from 'node:child_process'
import log from 'electron-log/main'
import { getFFmpegPath } from '../lib/utils'

/** One second of the recording, and how much the picture changed during it. */
export interface ActivitySample {
  /** Seconds into the recording. */
  time: number
  /** 0 (nothing moved) to 1 (the whole frame changed). */
  activity: number
}

/** The luma range `signalstats` reports in, and so the divisor for normalizing. */
const LUMA_MAX = 255

/**
 * The FFmpeg arguments that produce the samples.
 *
 * `-f null -` because nothing is being written: the measurement comes out on stderr.
 */
export function buildActivityArgs(filePath: string): string[] {
  return [
    '-hide_banner',
    '-i',
    filePath,
    '-vf',
    'fps=1,scale=64:36,format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG',
    '-f',
    'null',
    '-',
  ]
}

/**
 * The samples FFmpeg printed.
 *
 * `metadata=print` writes a `pts_time` line and then the value on the next line, so
 * the pairs are matched in order rather than by position: a run that stops early
 * (a decode error, a file that ends mid-second) yields the samples it managed, not a
 * misaligned list.
 */
export function parseActivitySamples(stderr: string): ActivitySample[] {
  const samples: ActivitySample[] = []
  let pendingTime: number | null = null

  for (const line of stderr.split('\n')) {
    const time = line.match(/pts_time:([0-9.]+)/)
    if (time) {
      const parsed = Number(time[1])
      pendingTime = Number.isFinite(parsed) ? parsed : null
      continue
    }

    const value = line.match(/signalstats\.YAVG=([0-9.]+)/)
    if (value && pendingTime !== null) {
      const luma = Number(value[1])
      samples.push({
        time: pendingTime,
        // Clamped: a difference cannot exceed the range, and a corrupt reading should
        // not be able to claim the whole screen changed.
        activity: Number.isFinite(luma) ? Math.min(1, Math.max(0, luma / LUMA_MAX)) : 0,
      })
      pendingTime = null
    }
  }

  return samples
}

/**
 * Measure how much the recording's picture changed, second by second.
 *
 * Never rejects. A file FFmpeg cannot read yields no samples, and the caller falls
 * back to the audio — which is the half of the detector that needs no guessing.
 */
export async function probeActivity(filePath: string): Promise<ActivitySample[]> {
  return new Promise<ActivitySample[]>((resolve) => {
    let stderr = ''
    try {
      const proc = spawn(getFFmpegPath(), buildActivityArgs(filePath))
      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })
      proc.on('error', (err) => {
        log.warn('[Activity] Could not run ffmpeg to measure the picture:', err)
        resolve([])
      })
      proc.on('close', () => resolve(parseActivitySamples(stderr)))
    } catch (err) {
      log.warn('[Activity] Measuring threw:', err)
      resolve([])
    }
  })
}
