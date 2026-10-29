import { describe, expect, it } from 'vitest'
import type { MetaDataItem } from '../types'
import {
  CURSOR_IDLE_HIDE_SEC,
  MAX_SMOOTHING_WINDOW_SEC,
  cursorVelocity,
  estimateEventInterval,
  findEventIndex,
  interpolateCursorPosition,
  sampleCursorPath,
} from './cursor-path'

/** Samples at a fixed rate, position from the callback. */
function path(durationSec: number, hz: number, at: (t: number) => { x: number; y: number }): MetaDataItem[] {
  const items: MetaDataItem[] = []
  const step = 1 / hz
  for (let t = 0; t <= durationSec + 1e-9; t += step) {
    const { x, y } = at(t)
    items.push({ timestamp: Number(t.toFixed(6)), x, y, type: 'move', cursorImageKey: 'arrow' })
  }
  return items
}

const straight = () => path(1, 60, (t) => ({ x: 100 + 600 * t, y: 200 }))
/** A straight path with a ±40px alternating wiggle on top — an unsteady hand. */
const jittery = () =>
  path(1, 60, (t) => {
    const index = Math.round(t * 60)
    return { x: 100 + 600 * t, y: 200 + (index % 2 === 0 ? 40 : -40) }
  })

const ON = { enabled: true, smoothing: 0.45 }
const OFF = { enabled: false, smoothing: 0 }

describe('findEventIndex', () => {
  it('finds the last sample at or before a time', () => {
    const metadata = path(1, 10, (t) => ({ x: t, y: 0 }))
    expect(findEventIndex(metadata, -1)).toBe(-1)
    expect(findEventIndex(metadata, 0)).toBe(0)
    expect(findEventIndex(metadata, 0.25)).toBe(2)
    expect(findEventIndex(metadata, 99)).toBe(metadata.length - 1)
  })
})

describe('interpolateCursorPosition', () => {
  it('sits between the two surrounding samples', () => {
    const metadata = path(1, 10, (t) => ({ x: 100 * t, y: 50 }))
    const mid = interpolateCursorPosition(metadata, 0.15)
    expect(mid?.x).toBeCloseTo(15, 6)
    expect(mid?.y).toBe(50)
  })

  it('clamps outside the recording', () => {
    const metadata = path(1, 10, (t) => ({ x: 100 * t, y: 0 }))
    expect(interpolateCursorPosition(metadata, -5)?.x).toBe(0)
    expect(interpolateCursorPosition(metadata, 5)?.x).toBeCloseTo(100, 6)
  })

  it('has nothing to interpolate from an empty recording', () => {
    expect(interpolateCursorPosition([], 1)).toBeNull()
  })
})

describe('sampleCursorPath', () => {
  it('with smoothing off returns the raw last sample, exactly as before', () => {
    const metadata = jittery()
    const time = 0.5
    const expected = metadata[findEventIndex(metadata, time)]
    const sample = sampleCursorPath(metadata, time, OFF)
    expect(sample).toEqual({
      x: expected.x,
      y: expected.y,
      visible: true,
      cursorImageKey: 'arrow',
    })
  })

  it('keeps the cursor visible even when the recording was idle (rests at last point)', () => {
    const metadata = path(1, 60, () => ({ x: 5, y: 5 }))
    expect(sampleCursorPath(metadata, 0.5, OFF)?.visible).toBe(true)
    // Far past the old hide threshold: the cursor is NOT dropped, on or off — it
    // rests at the last recorded position so preview and export show it for the
    // whole clip.
    const idleAt = metadata[metadata.length - 1].timestamp + CURSOR_IDLE_HIDE_SEC + 0.01
    expect(sampleCursorPath(metadata, idleAt, OFF)?.visible).toBe(true)
    expect(sampleCursorPath(metadata, idleAt, OFF)?.x).toBe(5)
    expect(sampleCursorPath(metadata, idleAt, ON)?.visible).toBe(true)
  })

  it('follows a straight, steady path without lagging behind it', () => {
    const metadata = straight()
    for (const time of [0.3, 0.5, 0.7]) {
      const sample = sampleCursorPath(metadata, time, ON)
      const truth = { x: 100 + 600 * time, y: 200 }
      // The window is centred on `time`, so a constant velocity is reproduced
      // exactly rather than trailing by half a window.
      expect(Math.abs(sample!.x - truth.x)).toBeLessThan(1.5)
      expect(Math.abs(sample!.y - truth.y)).toBeLessThan(0.5)
    }
  })

  it('smooths an unsteady hand into a glide', () => {
    const metadata = jittery()
    const rawDeviation: number[] = []
    const smoothedDeviation: number[] = []

    for (let i = 10; i < metadata.length - 10; i++) {
      const time = metadata[i].timestamp
      rawDeviation.push(Math.abs(metadata[i].y - 200))
      smoothedDeviation.push(Math.abs(sampleCursorPath(metadata, time, ON)!.y - 200))
    }

    const maxRaw = Math.max(...rawDeviation)
    const maxSmoothed = Math.max(...smoothedDeviation)
    expect(maxRaw).toBeCloseTo(40, 0)
    // The point of the feature: most of the wobble is gone.
    expect(maxSmoothed).toBeLessThan(maxRaw * 0.5)
  })

  it('never wanders outside the path it was given', () => {
    const metadata = jittery()
    const xs = metadata.map((item) => item.x)
    const ys = metadata.map((item) => item.y)
    for (let i = 0; i < metadata.length; i += 7) {
      const sample = sampleCursorPath(metadata, metadata[i].timestamp, ON)!
      expect(sample.x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-6)
      expect(sample.x).toBeLessThanOrEqual(Math.max(...xs) + 1e-6)
      expect(sample.y).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-6)
      expect(sample.y).toBeLessThanOrEqual(Math.max(...ys) + 1e-6)
    }
  })

  it('moves less than the raw path between neighbouring frames', () => {
    const metadata = jittery()
    const step = 1 / 60
    let rawTravel = 0
    let smoothedTravel = 0
    for (let i = 20; i < 40; i++) {
      const time = metadata[i].timestamp
      const rawBefore = sampleCursorPath(metadata, time, OFF)!
      const rawAfter = sampleCursorPath(metadata, time + step, OFF)!
      const smoothBefore = sampleCursorPath(metadata, time, ON)!
      const smoothAfter = sampleCursorPath(metadata, time + step, ON)!
      rawTravel += Math.hypot(rawAfter.x - rawBefore.x, rawAfter.y - rawBefore.y)
      smoothedTravel += Math.hypot(smoothAfter.x - smoothBefore.x, smoothAfter.y - smoothBefore.y)
    }
    expect(smoothedTravel).toBeLessThan(rawTravel)
  })

  it('has a window that grows with the smoothing amount', () => {
    const metadata = jittery()
    const light = sampleCursorPath(metadata, 0.5, { enabled: true, smoothing: 0.1 })!
    const heavy = sampleCursorPath(metadata, 0.5, { enabled: true, smoothing: 1 })!
    // A heavier setting averages more, so the wobble is smaller still.
    expect(Math.abs(heavy.y - 200)).toBeLessThanOrEqual(Math.abs(light.y - 200) + 0.001)
    expect(MAX_SMOOTHING_WINDOW_SEC).toBeGreaterThan(0)
  })

  it('has nothing to sample before the recording starts', () => {
    const metadata = straight()
    expect(sampleCursorPath(metadata, -1, ON)).toBeNull()
  })
})

describe('estimateEventInterval', () => {
  it('reads the recording cadence', () => {
    expect(estimateEventInterval(straight(), 0.5)).toBeCloseTo(1 / 60, 3)
    const slower = path(2, 30, (t) => ({ x: t, y: 0 }))
    expect(estimateEventInterval(slower, 1)).toBeCloseTo(1 / 30, 3)
  })

  it('falls back to 60Hz at the start, and clamps silly gaps', () => {
    const metadata = straight()
    expect(estimateEventInterval(metadata, 0)).toBeCloseTo(1 / 60, 3)
    const sparse: MetaDataItem[] = [
      { timestamp: 0, x: 0, y: 0, type: 'move' },
      { timestamp: 5, x: 1, y: 1, type: 'move' },
      { timestamp: 10, x: 2, y: 2, type: 'move' },
    ]
    expect(estimateEventInterval(sparse, 10)).toBeCloseTo(1 / 15, 3)
  })
})

describe('cursorVelocity', () => {
  it('reports the speed of a steady motion', () => {
    const metadata = straight()
    const velocity = cursorVelocity(metadata, 0.5, ON)
    expect(velocity.vx).toBeCloseTo(600, -1)
    expect(velocity.speed).toBeCloseTo(600, -1)
    expect(Math.abs(velocity.vy)).toBeLessThan(1)
  })

  it('reports stillness for a stationary cursor', () => {
    const metadata = path(1, 60, () => ({ x: 400, y: 300 }))
    expect(cursorVelocity(metadata, 0.5, ON).speed).toBeCloseTo(0, 1)
  })
})
