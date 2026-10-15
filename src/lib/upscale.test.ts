import { describe, expect, it } from 'vitest'
import { UPSCALE_TOLERANCE, computeFrameContentSize, detectUpscale, maxCameraScale, maxZoomLevel } from './upscale'

// The renderer's default frame padding (see src/store/slices/frameSlice.ts).
const DEFAULT_PADDING = 5
const SOURCE_1080P = { width: 1920, height: 1080 }
const SOURCE_4K = { width: 3840, height: 2160 }
const VIDEO_1080P = { videoWidth: 1920, videoHeight: 1080 }

function detect(options: {
  targetWidth: number
  targetHeight: number
  source: { width: number; height: number }
  paddingPercent?: number
  maxZoom?: number
  cameraScale?: number
}) {
  return detectUpscale({
    targetWidth: options.targetWidth,
    targetHeight: options.targetHeight,
    paddingPercent: options.paddingPercent ?? DEFAULT_PADDING,
    videoWidth: options.source.width,
    videoHeight: options.source.height,
    maxZoom: options.maxZoom,
    cameraScale: options.cameraScale,
  })
}

describe('computeFrameContentSize', () => {
  it('insets the target by the frame padding and fits the video', () => {
    const size = computeFrameContentSize({
      targetWidth: 1920,
      targetHeight: 1080,
      paddingPercent: DEFAULT_PADDING,
      ...VIDEO_1080P,
    })
    expect(size.width).toBeCloseTo(1728, 6)
    expect(size.height).toBeCloseTo(972, 6)
  })

  it('fits a 16:9 video inside a square frame by its height', () => {
    const size = computeFrameContentSize({
      targetWidth: 1080,
      targetHeight: 1080,
      paddingPercent: 0,
      ...VIDEO_1080P,
    })
    expect(size.width).toBeCloseTo(1080, 6)
    expect(size.height).toBeCloseTo(607.5, 6)
  })

  it('applies the camera scale on top of the fitted content', () => {
    const size = computeFrameContentSize({
      targetWidth: 1920,
      targetHeight: 1080,
      paddingPercent: 0,
      cameraScale: 1.5,
      ...VIDEO_1080P,
    })
    expect(size.width).toBeCloseTo(2880, 6)
  })

  it('returns zeroes for degenerate inputs instead of dividing by zero', () => {
    const size = computeFrameContentSize({
      targetWidth: 0,
      targetHeight: 1080,
      paddingPercent: 0,
      ...VIDEO_1080P,
    })
    expect(size).toEqual({ width: 0, height: 0 })
  })

  it('returns zeroes when the source dimensions are missing', () => {
    const size = computeFrameContentSize({
      targetWidth: 1920,
      targetHeight: 1080,
      paddingPercent: 0,
      videoWidth: undefined as unknown as number,
      videoHeight: undefined as unknown as number,
    })
    expect(size).toEqual({ width: 0, height: 0 })
  })
})

describe('detectUpscale', () => {
  it('acceptance: a 1080p recording at 1080p output with default padding is not an upscale', () => {
    const result = detect({ targetWidth: 1920, targetHeight: 1080, source: SOURCE_1080P })
    expect(result.requiredScale).toBeCloseTo(0.9, 6)
    expect(result.isUpscale).toBe(false)
  })

  it('acceptance: the same 1080p recording at 4K is an upscale', () => {
    const result = detect({ targetWidth: 3840, targetHeight: 2160, source: SOURCE_1080P })
    expect(result.requiredScale).toBeCloseTo(1.8, 6)
    expect(result.isUpscale).toBe(true)
  })

  it('acceptance: the same 1080p recording at 8K is an upscale', () => {
    const result = detect({ targetWidth: 7680, targetHeight: 4320, source: SOURCE_1080P })
    expect(result.requiredScale).toBeCloseTo(3.6, 6)
    expect(result.isUpscale).toBe(true)
  })

  it('acceptance: a 4K recording at 4K output is not an upscale', () => {
    const result = detect({ targetWidth: 3840, targetHeight: 2160, source: SOURCE_4K })
    expect(result.requiredScale).toBeCloseTo(0.9, 6)
    expect(result.isUpscale).toBe(false)
  })

  it('a 4K recording at 8K is an upscale', () => {
    const result = detect({ targetWidth: 7680, targetHeight: 4320, source: SOURCE_4K })
    expect(result.requiredScale).toBeCloseTo(1.8, 6)
    expect(result.isUpscale).toBe(true)
  })

  it('does not nag for a slight scale-up within the tolerance', () => {
    // 1920 -> 2000 output is 1.04x: rounding, not an upscale.
    const result = detect({ targetWidth: 2000, targetHeight: 1125, source: SOURCE_1080P, paddingPercent: 0 })
    expect(result.requiredScale).toBeCloseTo(1.0417, 3)
    expect(result.requiredScale).toBeLessThan(UPSCALE_TOLERANCE)
    expect(result.isUpscale).toBe(false)
  })

  it('flags a scale past the tolerance', () => {
    const result = detect({ targetWidth: 2048, targetHeight: 1152, source: SOURCE_1080P, paddingPercent: 0 })
    expect(result.requiredScale).toBeCloseTo(1.0667, 3)
    expect(result.isUpscale).toBe(true)
  })

  it('counts a zoom region towards the upscale', () => {
    // 4K at 4K is fine, but zooming 1.5x into it is not.
    const result = detect({ targetWidth: 3840, targetHeight: 2160, source: SOURCE_4K, maxZoom: 1.5 })
    expect(result.requiredScale).toBeCloseTo(1.35, 6)
    expect(result.isUpscale).toBe(true)
  })

  it('counts camera-motion scale towards the upscale', () => {
    const result = detect({ targetWidth: 3840, targetHeight: 2160, source: SOURCE_4K, cameraScale: 1.2 })
    expect(result.requiredScale).toBeCloseTo(1.08, 6)
    expect(result.isUpscale).toBe(true)
  })

  it('handles portrait sources', () => {
    const result = detect({ targetWidth: 1080, targetHeight: 1920, source: { width: 1080, height: 1920 } })
    expect(result.requiredScale).toBeCloseTo(0.9, 6)
    expect(result.isUpscale).toBe(false)
  })

  it('is not an upscale when the source dimensions are unknown', () => {
    const result = detectUpscale({
      targetWidth: 3840,
      targetHeight: 2160,
      paddingPercent: 0,
      videoWidth: 0,
      videoHeight: 0,
    })
    expect(result.isUpscale).toBe(false)
    expect(result.requiredScale).toBe(0)
  })
})

describe('maxZoomLevel', () => {
  it('is 1 when there are no zoom regions', () => {
    expect(maxZoomLevel(undefined)).toBe(1)
    expect(maxZoomLevel({})).toBe(1)
  })

  it('returns the largest zoom level', () => {
    expect(maxZoomLevel({ a: { zoomLevel: 1.2 }, b: { zoomLevel: 2.5 }, c: { zoomLevel: 1 } })).toBe(2.5)
  })

  it('ignores malformed values', () => {
    expect(maxZoomLevel({ a: { zoomLevel: Number.NaN }, b: {} })).toBe(1)
  })
})

describe('maxCameraScale', () => {
  it('is 1 when there is no camera motion', () => {
    expect(maxCameraScale(undefined)).toBe(1)
  })

  it('returns the largest pose scale', () => {
    expect(maxCameraScale([{ from: { scale: 1 }, to: { scale: 1.4 } }, { from: { scale: 1.1 } }])).toBe(1.4)
  })
})
