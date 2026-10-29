import { describe, expect, it } from 'vitest'
import { EXPORT_RENDER_CAP, applyRenderCap, cloudIntermediateSize, needsUpscale } from './export-render-cap'
import { exportDimensions } from './export-resolutions'

describe('applyRenderCap', () => {
  it('leaves 4K and smaller untouched', () => {
    expect(applyRenderCap(3840, 2160)).toEqual({ width: 3840, height: 2160 })
    expect(applyRenderCap(1920, 1080)).toEqual({ width: 1920, height: 1080 })
    expect(applyRenderCap(1280, 720)).toEqual({ width: 1280, height: 720 })
  })

  it('caps a 16:9 8K target down to the render size', () => {
    const target = exportDimensions('8k', '16:9')
    expect(target).toEqual({ width: 7680, height: 4320 })
    expect(applyRenderCap(target.width, target.height)).toEqual({ width: 3840, height: 2160 })
  })

  it('caps a vertical 8K target by height', () => {
    const target = exportDimensions('8k', '9:16')
    // 2430x4320 scaled by 0.5 => 1215x2160, rounded up to an even width.
    expect(applyRenderCap(target.width, target.height)).toEqual({ width: 1216, height: 2160 })
  })

  it('caps a square 8K target by height', () => {
    const target = exportDimensions('8k', '1:1')
    expect(applyRenderCap(target.width, target.height)).toEqual({ width: 2160, height: 2160 })
  })

  it('always returns even dimensions', () => {
    const capped = applyRenderCap(7679, 4319)
    expect(capped.width % 2).toBe(0)
    expect(capped.height % 2).toBe(0)
  })

  it('passes degenerate sizes through', () => {
    expect(applyRenderCap(0, 0)).toEqual({ width: 0, height: 0 })
  })

  it('exposes the documented default cap', () => {
    expect(EXPORT_RENDER_CAP).toEqual({ longestSide: 3840, maxHeight: 2160 })
  })
})

describe('needsUpscale', () => {
  it('is true only when the render size differs from the target', () => {
    expect(needsUpscale(3840, 2160, 7680, 4320)).toBe(true)
    expect(needsUpscale(3840, 2160, 3840, 2160)).toBe(false)
  })
})

describe('cloudIntermediateSize', () => {
  it('renders a 1080p source for a 1440p target, so the model has work', () => {
    expect(cloudIntermediateSize(2560, 1440, 1920, 1080)).toEqual({ width: 1920, height: 1080 })
  })

  it('renders a 720p source for a 4K target at the source size', () => {
    expect(cloudIntermediateSize(3840, 2160, 1280, 720)).toEqual({ width: 1280, height: 720 })
  })

  it('never exceeds the target', () => {
    // A 4K source exporting to 1440p (zoom upscale) stays at the target.
    expect(cloudIntermediateSize(2560, 1440, 3840, 2160)).toEqual({ width: 2560, height: 1440 })
  })

  it('keeps the target aspect on non-16:9 crops', () => {
    const target = exportDimensions('8k', '9:16')
    // 2430x4320 scaled by 0.25 (1080/4320) => 608x1080, even and inside the cap.
    expect(cloudIntermediateSize(target.width, target.height, 1920, 1080)).toEqual({ width: 608, height: 1080 })
  })

  it('returns even dimensions', () => {
    const size = cloudIntermediateSize(3840, 2160, 1919, 1079)
    expect(size.width % 2).toBe(0)
    expect(size.height % 2).toBe(0)
  })
})
