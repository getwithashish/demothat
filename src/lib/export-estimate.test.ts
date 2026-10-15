import { describe, expect, it } from 'vitest'
import {
  ROUGH_BASELINE_THROUGHPUT_AT_1080P,
  type ExportPerfSample,
  estimateCloudSeconds,
  estimateLocalSeconds,
  estimateRemainingSeconds,
  fasterMethod,
  framesFor,
  roughRange,
  scaleThroughputByPixelRatio,
} from './export-estimate'

const SAMPLE_1080P: ExportPerfSample = {
  resolution: '1080p',
  codec: 'h264',
  settingFps: 30,
  width: 1920,
  height: 1080,
  throughput: 60,
}

describe('framesFor', () => {
  it('multiplies clip length by frame rate', () => {
    expect(framesFor(10, 30)).toBe(300)
    expect(framesFor(4.5, 60)).toBe(270)
  })

  it('is zero for degenerate input', () => {
    expect(framesFor(0, 30)).toBe(0)
    expect(framesFor(10, 0)).toBe(0)
  })
})

describe('scaleThroughputByPixelRatio', () => {
  it('scales a measured throughput by output pixels', () => {
    // Four times the pixels at the same rate => a quarter of the throughput.
    const scaled = scaleThroughputByPixelRatio(60, 1920 * 1080, 3840 * 2160)
    expect(scaled).toBeCloseTo(15, 6)
  })

  it('is a no-op when the sizes match', () => {
    expect(scaleThroughputByPixelRatio(60, 1000, 1000)).toBeCloseTo(60, 6)
  })

  it('returns 0 for unusable input', () => {
    expect(scaleThroughputByPixelRatio(0, 1000, 2000)).toBe(0)
    expect(scaleThroughputByPixelRatio(60, 0, 2000)).toBe(0)
    expect(scaleThroughputByPixelRatio(60, 1000, 0)).toBe(0)
  })
})

describe('estimateLocalSeconds', () => {
  it('uses an exact measurement when one exists', () => {
    const estimate = estimateLocalSeconds({
      frames: 300,
      targetWidth: 1920,
      targetHeight: 1080,
      resolution: '1080p',
      codec: 'h264',
      settingFps: 30,
      samples: [SAMPLE_1080P],
    })
    expect(estimate.fromSample).toBe(true)
    expect(estimate.rough).toBe(false)
    expect(estimate.seconds).toBeCloseTo(5, 6)
  })

  it('scales a measurement from another resolution and marks it rough', () => {
    const estimate = estimateLocalSeconds({
      frames: 300,
      targetWidth: 3840,
      targetHeight: 2160,
      resolution: '4k',
      codec: 'h264',
      settingFps: 30,
      samples: [SAMPLE_1080P],
    })
    // 60 fps at 1080p becomes 15 fps at 4K, so 300 frames take 20 s.
    expect(estimate.fromSample).toBe(true)
    expect(estimate.rough).toBe(true)
    expect(estimate.seconds).toBeCloseTo(20, 6)
  })

  it('falls back to the documented baseline when nothing has been measured', () => {
    const estimate = estimateLocalSeconds({
      frames: 300,
      targetWidth: 1920,
      targetHeight: 1080,
      resolution: '1080p',
      codec: 'h264',
      settingFps: 30,
      samples: [],
    })
    expect(estimate.fromSample).toBe(false)
    expect(estimate.rough).toBe(true)
    expect(estimate.seconds).toBeCloseTo(300 / ROUGH_BASELINE_THROUGHPUT_AT_1080P, 6)
  })

  it('scales a different codec as a fallback', () => {
    const estimate = estimateLocalSeconds({
      frames: 300,
      targetWidth: 1920,
      targetHeight: 1080,
      resolution: '1080p',
      codec: 'hevc',
      settingFps: 30,
      samples: [SAMPLE_1080P],
    })
    // The h264 sample is the closest thing available, so it is used, flagged rough.
    expect(estimate.fromSample).toBe(true)
    expect(estimate.rough).toBe(true)
  })

  it('reports no work for zero frames', () => {
    const estimate = estimateLocalSeconds({
      frames: 0,
      targetWidth: 1920,
      targetHeight: 1080,
      resolution: '1080p',
      codec: 'h264',
      settingFps: 30,
      samples: [SAMPLE_1080P],
    })
    expect(estimate).toEqual({ seconds: 0, rough: false, fromSample: false })
  })
})

describe('roughRange', () => {
  it('is +/- 50% by default', () => {
    expect(roughRange(20)).toEqual({ min: 10, max: 30 })
  })

  it('never goes negative', () => {
    expect(roughRange(1, 2)).toEqual({ min: 0, max: 3 })
  })
})

describe('estimateRemainingSeconds', () => {
  it('extrapolates from elapsed time and progress', () => {
    expect(estimateRemainingSeconds(10, 25)).toBeCloseTo(30, 6)
    expect(estimateRemainingSeconds(30, 50)).toBeCloseTo(30, 6)
  })

  it('returns null when there is nothing to extrapolate from', () => {
    expect(estimateRemainingSeconds(0, 50)).toBeNull()
    expect(estimateRemainingSeconds(10, 0)).toBeNull()
    expect(estimateRemainingSeconds(10, 100)).toBeNull()
  })
})

describe('estimateCloudSeconds', () => {
  it('breaks the total down into upload, startup, compute and download', () => {
    const estimate = estimateCloudSeconds({
      frames: 900,
      fileMB: 100,
      outputMB: 400,
      uplinkMbps: 20,
      downlinkMbps: 100,
      startupSeconds: 5,
      upscaleFps: 30,
    })
    expect(estimate.uploadSeconds).toBeCloseTo(40, 6)
    expect(estimate.startupSeconds).toBeCloseTo(5, 6)
    expect(estimate.computeSeconds).toBeCloseTo(30, 6)
    expect(estimate.downloadSeconds).toBeCloseTo(32, 6)
    expect(estimate.totalSeconds).toBeCloseTo(107, 6)
  })

  it('ignores unusable transfer rates instead of returning infinity', () => {
    const estimate = estimateCloudSeconds({
      frames: 300,
      fileMB: 100,
      outputMB: 400,
      uplinkMbps: 0,
      downlinkMbps: 0,
      startupSeconds: 2,
      upscaleFps: 30,
    })
    expect(estimate.uploadSeconds).toBe(0)
    expect(estimate.downloadSeconds).toBe(0)
    expect(estimate.totalSeconds).toBeCloseTo(12, 6)
  })
})

describe('fasterMethod', () => {
  it('picks the faster option', () => {
    expect(fasterMethod(100, 40)).toBe('cloud')
    expect(fasterMethod(40, 100)).toBe('local')
  })

  it('returns null when they are within 5%', () => {
    expect(fasterMethod(100, 100)).toBeNull()
    expect(fasterMethod(100, 103)).toBeNull()
  })

  it('returns null when an estimate is missing', () => {
    expect(fasterMethod(0, 40)).toBeNull()
    expect(fasterMethod(100, 0)).toBeNull()
  })
})
