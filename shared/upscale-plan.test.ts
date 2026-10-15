import { describe, expect, it } from 'vitest'
import {
  ANIMEVIDEO_SCALES,
  DEFAULT_UPSCALE_MODEL,
  FOUR_X_ONLY_SCALES,
  planFinalScaleFilter,
  planUpscale,
} from './upscale-plan'

const H1080 = { sourceWidth: 1920, sourceHeight: 1080 }
const H720 = { sourceWidth: 1280, sourceHeight: 720 }
const QHD1440 = { sourceWidth: 2560, sourceHeight: 1440 }
const UHD4K = { sourceWidth: 3840, sourceHeight: 2160 }
const UHD8K = { targetWidth: 7680, targetHeight: 4320 }

describe('planUpscale', () => {
  it('acceptance: 1080p to 8K is exactly 4x', () => {
    const plan = planUpscale({ ...H1080, ...UHD8K, modelScales: ANIMEVIDEO_SCALES })
    expect(plan.need).toBeCloseTo(4, 6)
    expect(plan.modelScale).toBe(4)
    expect([plan.modelWidth, plan.modelHeight]).toEqual([7680, 4320])
    expect(plan.finishesWithUpscale).toBe(false)
    expect(plan.finishesWithDownscale).toBe(false)
  })

  it('acceptance: 1440p to 8K is 3x', () => {
    const plan = planUpscale({ ...QHD1440, ...UHD8K, modelScales: ANIMEVIDEO_SCALES })
    expect(plan.need).toBeCloseTo(3, 6)
    expect(plan.modelScale).toBe(3)
    expect([plan.modelWidth, plan.modelHeight]).toEqual([7680, 4320])
  })

  it('acceptance: 720p to 8K is 4x, and Lanczos then scales UP to the target', () => {
    // The brief calls this "4x followed by a downscale"; 4x of 720p is
    // 5120x2880, which is below 7680x4320, so it is an upscale.
    const plan = planUpscale({ ...H720, ...UHD8K, modelScales: ANIMEVIDEO_SCALES })
    expect(plan.need).toBeCloseTo(6, 6)
    expect(plan.modelScale).toBe(4)
    expect([plan.modelWidth, plan.modelHeight]).toEqual([5120, 2880])
    expect(plan.finishesWithUpscale).toBe(true)
    expect(plan.finishesWithDownscale).toBe(false)
  })

  it('picks 2x for 1080p to 4K', () => {
    const plan = planUpscale({ ...H1080, targetWidth: 3840, targetHeight: 2160, modelScales: ANIMEVIDEO_SCALES })
    expect(plan.need).toBeCloseTo(2, 6)
    expect(plan.modelScale).toBe(2)
  })

  it('picks 2x for 4K to 8K', () => {
    const plan = planUpscale({ ...UHD4K, ...UHD8K, modelScales: ANIMEVIDEO_SCALES })
    expect(plan.modelScale).toBe(2)
    expect([plan.modelWidth, plan.modelHeight]).toEqual([7680, 4320])
  })

  it('uses 4x and downscales when the model has no 2x or 3x', () => {
    const plan = planUpscale({ ...UHD4K, ...UHD8K, modelScales: FOUR_X_ONLY_SCALES })
    expect(plan.need).toBeCloseTo(2, 6)
    expect(plan.modelScale).toBe(4)
    expect([plan.modelWidth, plan.modelHeight]).toEqual([15360, 8640])
    expect(plan.finishesWithDownscale).toBe(true)
  })

  it('treats a need a fraction of a percent over exact as the exact factor', () => {
    // 1919x1079 to 3840x2160 needs 2.0019x. Jumping to 3x would run the model on
    // 2.25x the pixels; 2x plus a 1.001x Lanczos is indistinguishable.
    const plan = planUpscale({
      sourceWidth: 1919,
      sourceHeight: 1079,
      targetWidth: 3840,
      targetHeight: 2160,
      modelScales: ANIMEVIDEO_SCALES,
    })
    expect(plan.need).toBeGreaterThan(2)
    expect(plan.modelScale).toBe(2)
    expect(plan.finishesWithUpscale).toBe(true)
  })

  it('still picks the larger factor when the shortfall is real', () => {
    // 2.5x needs 3x: a 2x model output would leave Lanczos with 1.25x to invent.
    const plan = planUpscale({
      sourceWidth: 1920,
      sourceHeight: 1080,
      targetWidth: 4800,
      targetHeight: 2700,
      modelScales: ANIMEVIDEO_SCALES,
    })
    expect(plan.need).toBeCloseTo(2.5, 6)
    expect(plan.modelScale).toBe(3)
    expect(plan.finishesWithDownscale).toBe(true)
  })

  it('does no model work when the target is not an upscale', () => {
    const plan = planUpscale({ ...UHD4K, targetWidth: 1920, targetHeight: 1080, modelScales: ANIMEVIDEO_SCALES })
    expect(plan.need).toBeCloseTo(0.5, 6)
    expect(plan.modelScale).toBeNull()
    expect(plan.finishesWithDownscale).toBe(true)
  })

  it('handles portrait sources', () => {
    const plan = planUpscale({
      sourceWidth: 1080,
      sourceHeight: 1920,
      targetWidth: 2160,
      targetHeight: 3840,
      modelScales: ANIMEVIDEO_SCALES,
    })
    expect(plan.need).toBeCloseTo(2, 6)
    expect(plan.modelScale).toBe(2)
    expect([plan.modelWidth, plan.modelHeight]).toEqual([2160, 3840])
  })

  it('defaults to the 4x-only set when no model scales are given', () => {
    const plan = planUpscale({ ...H1080, ...UHD8K })
    expect(plan.modelScale).toBe(4)
  })

  it('is inert for degenerate input', () => {
    const plan = planUpscale({ sourceWidth: 0, sourceHeight: 0, targetWidth: 7680, targetHeight: 4320 })
    expect(plan.modelScale).toBeNull()
    expect(plan.need).toBe(0)
  })
})

describe('planFinalScaleFilter', () => {
  it('is null when the model already lands on the target', () => {
    const plan = planUpscale({ ...H1080, ...UHD8K, modelScales: ANIMEVIDEO_SCALES })
    expect(planFinalScaleFilter(plan)).toBeNull()
  })

  it('scales Lanczos from the model output when they differ', () => {
    const plan = planUpscale({ ...H720, ...UHD8K, modelScales: ANIMEVIDEO_SCALES })
    expect(planFinalScaleFilter(plan)).toBe('scale=7680:4320:flags=lanczos')
  })

  it('scales to the target when no model runs', () => {
    const plan = planUpscale({ ...UHD4K, targetWidth: 1920, targetHeight: 1080 })
    expect(planFinalScaleFilter(plan)).toBe('scale=1920:1080:flags=lanczos')
  })
})

describe('model constants', () => {
  it('documents the default model and its factors', () => {
    expect(DEFAULT_UPSCALE_MODEL).toBe('realesr-animevideov3')
    expect(ANIMEVIDEO_SCALES).toEqual([2, 3, 4])
    expect(FOUR_X_ONLY_SCALES).toEqual([4])
  })
})
