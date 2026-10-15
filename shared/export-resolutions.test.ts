import { describe, expect, it } from 'vitest'
import { RESOLUTIONS, RESOLUTION_OPTIONS, isResolutionKey } from './export-resolutions'

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

    const heights = RESOLUTION_OPTIONS.map((option) => RESOLUTIONS[option.key].height)
    expect(heights).toEqual([...heights].sort((a, b) => a - b))
  })

  it('recognises only known keys', () => {
    expect(isResolutionKey('1080p')).toBe(true)
    expect(isResolutionKey('8k')).toBe(false)
    expect(isResolutionKey(undefined)).toBe(false)
    expect(isResolutionKey(1080)).toBe(false)
  })
})
