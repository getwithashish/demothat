// Optics-based motion blur for the cursor.
//
// A real camera integrates the light that arrives during its shutter, so a fast
// object over a long exposure is smeared along the path it travelled. This module
// does the same thing in software: over one frame's shutter interval it samples
// the cursor's motion and returns a short run of "ghosts" — each offset backwards
// along the velocity vector, dimmed, and slightly blurred to hide banding.
//
// The smear length therefore comes from the cursor's actual speed and the shutter
// angle, not from a magic constant: a slow or stationary cursor produces a single
// sharp draw, exactly as a real camera would.
//
// Pure and DOM-free, so it is unit tested directly.

import type { MetaDataItem } from '../types'
import { cursorVelocity, type CursorPathOptions } from './cursor-path'

export interface MotionBlurSettings {
  enabled: boolean
  /** Shutter angle in degrees: 360 exposes the whole frame interval. */
  shutterAngle: number
  /** How many ghosts to draw in total, including the sharp one. */
  samples: number
  /** Scales the smear length (1 = physically derived). */
  strength: number
  /** Hard cap on the smear, in content pixels. */
  maxSmearPx?: number
}

/** Below this speed nothing is smeared: a real shutter would not either. */
export const MOTION_BLUR_MIN_SPEED_PX_PER_SEC = 320

/** How far the smear may reach, in content pixels, whatever the speed. */
export const DEFAULT_MAX_SMEAR_PX = 28

/** Most ghosts we will ever draw in one frame (this runs per frame at up to 8K). */
export const MAX_MOTION_BLUR_SAMPLES = 8

export interface MotionBlurGhost {
  /** Offset from the true cursor position, in content pixels. */
  dx: number
  dy: number
  /** 0..1; the run sums to about 1 so total ink stays constant. */
  alpha: number
  /** Blur radius for this ghost, in content pixels. */
  blurPx: number
}

export interface MotionBlurVelocity {
  vx: number
  vy: number
  speed: number
}

/**
 * The ghosts for one frame. Returns a single sharp ghost when blur is off, when
 * the cursor is too slow to smear, or when the settings ask for one sample.
 */
export function motionBlurGhosts(
  velocity: MotionBlurVelocity,
  frameIntervalSec: number,
  settings: MotionBlurSettings,
): MotionBlurGhost[] {
  const single: MotionBlurGhost = { dx: 0, dy: 0, alpha: 1, blurPx: 0 }
  const count = Math.min(MAX_MOTION_BLUR_SAMPLES, Math.max(1, Math.round(settings.samples)))
  if (!settings.enabled || count <= 1) return [single]
  if (!(frameIntervalSec > 0)) return [single]

  const shutterSec = (frameIntervalSec * Math.max(0, Math.min(360, settings.shutterAngle))) / 360
  const travelX = velocity.vx * shutterSec * Math.max(0, settings.strength)
  const travelY = velocity.vy * shutterSec * Math.max(0, settings.strength)
  const travel = Math.hypot(travelX, travelY)
  if (!(travel > 0)) return [single]

  // A real shutter smears only what actually moved while it was open.
  if (velocity.speed < MOTION_BLUR_MIN_SPEED_PX_PER_SEC) return [single]

  const cap = settings.maxSmearPx ?? DEFAULT_MAX_SMEAR_PX
  const scale = travel > cap ? cap / travel : 1
  const smearX = travelX * scale
  const smearY = travelY * scale

  // Weights favour the sharp endpoint, so the cursor stays legible while the
  // trail fades out behind it; raising them to the power keeps the falloff
  // smooth rather than stepped.
  const weights: number[] = []
  let total = 0
  for (let i = 0; i < count; i++) {
    const back = i / (count - 1)
    const weight = Math.pow(1 - back, 1.6)
    weights.push(weight)
    total += weight
  }

  const spacing = Math.hypot(smearX, smearY) / (count - 1)
  const blurPx = Math.min(3, spacing * 0.35)

  return weights.map((weight, i) => {
    const back = i / (count - 1)
    // `|| 0` keeps the sharp ghost at exactly 0 rather than a negative zero.
    const dx = -smearX * back || 0
    const dy = -smearY * back || 0
    return {
      dx,
      dy,
      alpha: weight / total,
      // The newest ghost stays sharp; the tail is softened just enough to blur
      // the gaps between samples.
      blurPx: i === 0 ? 0 : blurPx,
    }
  })
}

/** Velocity of the cursor at `time`, from the (optionally smoothed) path. */
export function motionBlurVelocityAt(
  metadata: MetaDataItem[],
  time: number,
  pathOptions: CursorPathOptions,
): MotionBlurVelocity {
  return cursorVelocity(metadata, time, pathOptions)
}
