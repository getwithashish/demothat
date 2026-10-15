import { describe, expect, it } from 'vitest'
import { RESOLUTIONS, RESOLUTION_OPTIONS, exportDimensions, isResolutionKey } from './export-resolutions'

describe('export resolutions', () => {
  it('exposes a size for every option and a label for each', () => {
    const keys = Object.keys(RESOLUTIONS).sort()
    expect(keys.length).toBeGreaterThan(0)
    expect(RESOLUTION_OPTIONS.map((option) => option.key).sort()).toEqual(keys)
    for (const option of RESOLUTION_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0)
      expect(RESOLUTIONS[option.key].width).toBeGreaterThan(0)
      expect(RESOLUTIONS[option.key].height).toBeGreaterThan(0)
    }
  })

  it('keeps the 16:9 sizes, increasing down the list', () => {
    expect(RESOLUTIONS['720p']).toEqual({ width: 1280, height: 720 })
    expect(RESOLUTIONS['1080p']).toEqual({ width: 1920, height: 1080 })
    expect(RESOLUTIONS['2k']).toEqual({ width: 2560, height: 1440 })
    expect(RESOLUTIONS['4k']).toEqual({ width: 3840, height: 2160 })
    expect(RESOLUTIONS['8k']).toEqual({ width: 7680, height: 4320 })

    const heights = RESOLUTION_OPTIONS.map((option) => RESOLUTIONS[option.key].height)
    expect(heights).toEqual([...heights].sort((a, b) => a - b))
  })

  it('recognises only known keys', () => {
    expect(isResolutionKey('1080p')).toBe(true)
    expect(isResolutionKey('8k')).toBe(true)
    expect(isResolutionKey('16k')).toBe(false)
    expect(isResolutionKey(undefined)).toBe(false)
    expect(isResolutionKey(1080)).toBe(false)
  })
})

describe('exportDimensions', () => {
  it('anchors on the height and derives the width from the aspect ratio', () => {
    expect(exportDimensions('1080p', '16:9')).toEqual({ width: 1920, height: 1080 })
    expect(exportDimensions('8k', '16:9')).toEqual({ width: 7680, height: 4320 })
    expect(exportDimensions('8k', '9:16')).toEqual({ width: 2430, height: 4320 })
    expect(exportDimensions('8k', '1:1')).toEqual({ width: 4320, height: 4320 })
  })

  it('rounds non-16:9 widths up to an even number', () => {
    for (const ratio of ['16:9', '9:16', '4:3', '3:4', '1:1']) {
      const { width, height } = exportDimensions('4k', ratio)
      expect(width % 2).toBe(0)
      expect(height % 2).toBe(0)
    }
  })
})
