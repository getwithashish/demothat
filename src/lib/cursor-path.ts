// Cursor path smoothing.
//
// The raw recording is a list of sampled positions; drawing the cursor at the
// latest one makes every handshake of the physical mouse visible as a zig-zag.
// This module turns that path into a smooth glide:
//
//   1. `interpolateCursorPosition` evaluates the path *between* samples, so the
//      cursor moves continuously instead of snapping from event to event.
//   2. `sampleCursorPath` averages that path over a short window, which is what
//      removes the jitter. The window is centred on the requested time (the whole
//      recording is in memory, so looking slightly ahead is free) — a one-sided
//      window would leave the cursor visibly lagging behind the motion.
//
// A weighted average of points on the path can never leave their convex hull, so
// smoothing cannot overshoot into a region the recording never visited.
//
// Pure and free of DOM/Electron, so it is unit tested directly and can be used by
// both the preview and the export renderer (they share drawScene).

import type { MetaDataItem } from '../types'

/** The cursor is hidden once the recording has been idle this long (unchanged). */
export const CURSOR_IDLE_HIDE_SEC = 0.1

/** Longest averaging window, at smoothing = 1. */
export const MAX_SMOOTHING_WINDOW_SEC = 0.24

/** How many points the window is sampled at. */
const SMOOTHING_STEPS = 9

/** Inter-event gaps are clamped into this range when estimating the cadence. */
const MIN_EVENT_SEC = 1 / 240
const MAX_EVENT_SEC = 1 / 15

export interface CursorPathOptions {
  /** False reproduces the historical behaviour: the last recorded sample. */
  enabled: boolean
  /** 0..1; scales the averaging window. */
  smoothing: number
  /** Overrides the derived window ceiling (seconds). */
  windowSec?: number
}

export interface CursorSample {
  x: number
  y: number
  /** False when the recording has been idle past `CURSOR_IDLE_HIDE_SEC`. */
  visible: boolean
  /** The bitmap to draw (the most recent event's cursor shape). */
  cursorImageKey?: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Index of the last event at or before `time` (binary search). */
export function findEventIndex(metadata: MetaDataItem[], time: number): number {
  let low = 0
  let high = metadata.length - 1
  let result = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (metadata[mid].timestamp <= time) {
      result = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return result
}

/**
 * The position on the path at `time`, interpolated between the two surrounding
 * events. Null when there is nothing to interpolate from.
 */
export function interpolateCursorPosition(metadata: MetaDataItem[], time: number): { x: number; y: number } | null {
  if (metadata.length === 0) return null
  const index = findEventIndex(metadata, time)
  if (index < 0) return { x: metadata[0].x, y: metadata[0].y }

  const current = metadata[index]
  const next = metadata[index + 1]
  if (!next) return { x: current.x, y: current.y }

  const span = next.timestamp - current.timestamp
  if (!(span > 0)) return { x: next.x, y: next.y }
  const progress = clamp((time - current.timestamp) / span, 0, 1)
  return { x: current.x + (next.x - current.x) * progress, y: current.y + (next.y - current.y) * progress }
}

/**
 * The cursor at `time`.
 *
 * With smoothing off this is exactly the historical result: the last recorded
 * event, hidden once the recording has been idle for `CURSOR_IDLE_HIDE_SEC`.
 */
export function sampleCursorPath(
  metadata: MetaDataItem[],
  time: number,
  options: CursorPathOptions,
): CursorSample | null {
  const index = findEventIndex(metadata, time)
  if (index < 0) return null
  const last = metadata[index]
  const visible = time - last.timestamp < CURSOR_IDLE_HIDE_SEC

  if (!options.enabled) {
    return { x: last.x, y: last.y, visible, cursorImageKey: last.cursorImageKey }
  }

  const ceiling = options.windowSec ?? MAX_SMOOTHING_WINDOW_SEC
  const window = clamp(options.smoothing, 0, 1) * ceiling
  const current = interpolateCursorPosition(metadata, time)
  if (!current) return null
  if (window <= 0) {
    return { x: current.x, y: current.y, visible, cursorImageKey: last.cursorImageKey }
  }

  // A raised-cosine kernel centred on `time`: the newest and oldest ends of the
  // window contribute least, so the result reads as one continuous glide.
  let totalWeight = 0
  let sumX = 0
  let sumY = 0
  for (let step = 0; step < SMOOTHING_STEPS; step++) {
    const offset = (step / (SMOOTHING_STEPS - 1) - 0.5) * window
    const point = interpolateCursorPosition(metadata, time + offset)
    if (!point) continue
    const weight = Math.cos((offset / window) * Math.PI) + 1
    totalWeight += weight
    sumX += point.x * weight
    sumY += point.y * weight
  }

  if (totalWeight === 0) {
    return { x: current.x, y: current.y, visible, cursorImageKey: last.cursorImageKey }
  }
  return { x: sumX / totalWeight, y: sumY / totalWeight, visible, cursorImageKey: last.cursorImageKey }
}

/**
 * The recording's own cursor cadence around `time`, in seconds between samples.
 *
 * Recordings sample the pointer as fast as the platform reports it (often far
 * faster than the frame rate), so this is the honest basis for a shutter
 * interval — and it needs no frame-rate plumbing through the renderer.
 */
export function estimateEventInterval(metadata: MetaDataItem[], time: number): number {
  const index = findEventIndex(metadata, time)
  if (index <= 0) return 1 / 60

  const gaps: number[] = []
  for (let i = index; i > 0 && gaps.length < 8; i--) {
    const gap = metadata[i].timestamp - metadata[i - 1].timestamp
    if (gap > 0) gaps.push(gap)
  }
  if (gaps.length === 0) return 1 / 60

  gaps.sort((a, b) => a - b)
  const median = gaps[gaps.length >> 1]
  return clamp(median, MIN_EVENT_SEC, MAX_EVENT_SEC)
}

/** Velocity of the (optionally smoothed) path at `time`, in content pixels/s. */
export function cursorVelocity(
  metadata: MetaDataItem[],
  time: number,
  options: CursorPathOptions,
): { vx: number; vy: number; speed: number } {
  const halfStep = Math.max(estimateEventInterval(metadata, time), 1 / 240)
  const before = sampleCursorPath(metadata, time - halfStep, options)
  const after = sampleCursorPath(metadata, time + halfStep, options)
  if (!before || !after) return { vx: 0, vy: 0, speed: 0 }

  const vx = (after.x - before.x) / (2 * halfStep)
  const vy = (after.y - before.y) / (2 * halfStep)
  return { vx, vy, speed: Math.hypot(vx, vy) }
}
