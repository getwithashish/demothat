import { describe, expect, it } from 'vitest'
import type { MetaDataItem } from '../types'
import {
  DEFAULT_MAX_SMEAR_PX,
  MAX_MOTION_BLUR_SAMPLES,
  MOTION_BLUR_MIN_SPEED_PX_PER_SEC,
  motionBlurGhosts,
  motionBlurVelocityAt,
  type MotionBlurSettings,
} from './cursor-blur'

const SETTINGS: MotionBlurSettings = {
  enabled: true,
  shutterAngle: 180,
  samples: 4,
  strength: 1,
}

const fast = { vx: 1200, vy: 0, speed: 1200 }
const moving = { vx: 600, vy: -300, speed: Math.hypot(600, -300) }
const still = { vx: 0, vy: 0, speed: 0 }
const slow = { vx: 100, vy: 0, speed: 100 }

const FRAME = 1 / 60

/** Samples the cursor every 1/60s along a straight 1200px/s run. */
function movingMetadata(): MetaDataItem[] {
  const items: MetaDataItem[] = []
  for (let i = 0; i <= 60; i++) {
    const t = i / 60
    items.push({ timestamp: t, x: 100 + 1200 * t, y: 400, type: 'move' })
  }
  return items
}

describe('motionBlurGhosts', () => {
  it('draws a single sharp cursor when it is off', () => {
    expect(motionBlurGhosts(fast, FRAME, { ...SETTINGS, enabled: false })).toEqual([
      { dx: 0, dy: 0, alpha: 1, blurPx: 0 },
    ])
  })

  it('leaves a stationary cursor alone', () => {
    expect(motionBlurGhosts(still, FRAME, SETTINGS)).toHaveLength(1)
  })

  it('leaves a slow cursor alone: a shutter would not smear it either', () => {
    expect(motionBlurGhosts(slow, FRAME, SETTINGS)).toHaveLength(1)
    expect(slow.speed).toBeLessThan(MOTION_BLUR_MIN_SPEED_PX_PER_SEC)
  })

  it('smears a fast cursor back along its path', () => {
    const ghosts = motionBlurGhosts(fast, FRAME, SETTINGS)
    expect(ghosts).toHaveLength(4)

    // The first ghost is the true position, sharp and the brightest.
    expect(ghosts[0]).toMatchObject({ dx: 0, dy: 0, blurPx: 0 })
    expect(ghosts[0].alpha).toBeGreaterThan(ghosts[ghosts.length - 1].alpha)

    // The rest trail behind the motion (negative x for a cursor moving in +x).
    for (const ghost of ghosts.slice(1)) {
      expect(ghost.dx).toBeLessThan(0)
      expect(ghost.blurPx).toBeGreaterThan(0)
    }

    // Distances increase monotonically, and the alphas sum to about 1, so the
    // trail fades rather than darkening the cursor.
    const distances = ghosts.map((ghost) => Math.abs(ghost.dx))
    expect(distances).toEqual([...distances].sort((a, b) => a - b))
    expect(ghosts.reduce((sum, ghost) => sum + ghost.alpha, 0)).toBeCloseTo(1, 6)
  })

  it('smears 1200px/s a sixth of a frame, i.e. ~17px at a 180° shutter', () => {
    const ghosts = motionBlurGhosts(fast, FRAME, SETTINGS)
    // 1200px/s * (1/60)s * 180/360 = 10px of travel.
    expect(Math.abs(ghosts[ghosts.length - 1].dx)).toBeCloseTo(10, 1)
  })

  it('follows the direction of travel, including diagonally', () => {
    const ghosts = motionBlurGhosts(moving, FRAME, SETTINGS)
    const last = ghosts[ghosts.length - 1]
    expect(last.dx).toBeLessThan(0)
    expect(last.dy).toBeGreaterThan(0) // vy is negative, so the trail is +y
    // The trail is parallel to the velocity.
    expect(last.dx / last.dy).toBeCloseTo(moving.vx / moving.vy, 3)
  })

  it('scales the smear with the shutter angle and the strength', () => {
    const long = motionBlurGhosts(fast, FRAME, { ...SETTINGS, shutterAngle: 360 })
    const short = motionBlurGhosts(fast, FRAME, { ...SETTINGS, shutterAngle: 90 })
    const half = motionBlurGhosts(fast, FRAME, { ...SETTINGS, strength: 0.5 })
    const spanOf = (ghosts: { dx: number }[]) => Math.abs(ghosts[ghosts.length - 1].dx)

    expect(spanOf(long)).toBeCloseTo(spanOf(short) * 4, 1)
    expect(spanOf(half)).toBeCloseTo(spanOf(motionBlurGhosts(fast, FRAME, SETTINGS)) / 2, 1)
  })

  it('draws a single cursor at a closed shutter or zero strength', () => {
    expect(motionBlurGhosts(fast, FRAME, { ...SETTINGS, shutterAngle: 0 })).toHaveLength(1)
    expect(motionBlurGhosts(fast, FRAME, { ...SETTINGS, strength: 0 })).toHaveLength(1)
  })

  it('caps the smear so nothing is ever smeared across the screen', () => {
    const veryFast = { vx: 100_000, vy: 0, speed: 100_000 }
    const ghosts = motionBlurGhosts(veryFast, FRAME, SETTINGS)
    expect(Math.abs(ghosts[ghosts.length - 1].dx)).toBeCloseTo(DEFAULT_MAX_SMEAR_PX, 6)
    const tighter = motionBlurGhosts(veryFast, FRAME, { ...SETTINGS, maxSmearPx: 5 })
    expect(Math.abs(tighter[tighter.length - 1].dx)).toBeCloseTo(5, 6)
  })

  it('never draws more ghosts than the per-frame cap', () => {
    const ghosts = motionBlurGhosts(fast, FRAME, { ...SETTINGS, samples: 500 })
    expect(ghosts).toHaveLength(MAX_MOTION_BLUR_SAMPLES)
  })

  it('asks for one ghost when a single sample is requested', () => {
    expect(motionBlurGhosts(fast, FRAME, { ...SETTINGS, samples: 1 })).toHaveLength(1)
  })

  it('does nothing without a frame interval', () => {
    expect(motionBlurGhosts(fast, 0, SETTINGS)).toHaveLength(1)
  })
})

describe('motionBlurVelocityAt', () => {
  it('reads a moving cursor from the recording', () => {
    const velocity = motionBlurVelocityAt(movingMetadata(), 0.5, { enabled: true, smoothing: 0.45 })
    expect(velocity.vx).toBeGreaterThan(1000)
    expect(Math.abs(velocity.vy)).toBeLessThan(1)
    // Fast enough for the ghosts to actually appear.
    expect(velocity.speed).toBeGreaterThan(MOTION_BLUR_MIN_SPEED_PX_PER_SEC)
  })
})
