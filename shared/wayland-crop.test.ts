import { describe, expect, it } from 'vitest'
import { computeCrop } from './wayland-crop'

const selection = { x: 100, y: 50, width: 800, height: 450 }
const overlay = { width: 1920, height: 1080 }

describe('computeCrop', () => {
  it('maps a selection 1:1 when the video matches the overlay', () => {
    expect(computeCrop({ selection, overlay, video: { width: 1920, height: 1080 } })).toEqual({
      x: 100,
      y: 50,
      width: 800,
      height: 450,
    })
  })

  it('scales by 2 on a Retina-ish monitor', () => {
    // 1920 logical on a monitor the portal hands over at 3840 physical.
    expect(computeCrop({ selection, overlay, video: { width: 3840, height: 2160 } })).toEqual({
      x: 200,
      y: 100,
      width: 1600,
      height: 900,
    })
  })

  it('scales fractional HiDPI (125%) without drifting', () => {
    const crop = computeCrop({
      selection: { x: 400, y: 200, width: 400, height: 225 },
      overlay: { width: 1920, height: 1080 },
      video: { width: 2400, height: 1350 },
    })
    // 225 * 1.25 = 281.25 → 281 → even → 280.
    expect(crop).toEqual({ x: 500, y: 250, width: 500, height: 280 })
  })

  it('keeps the crop even-sized for H.264', () => {
    const crop = computeCrop({
      selection: { x: 11, y: 13, width: 401, height: 233 },
      overlay,
      video: { width: 1920, height: 1080 },
    })
    expect(crop).not.toBeNull()
    expect(crop!.width % 2).toBe(0)
    expect(crop!.height % 2).toBe(0)
    expect(crop!.x % 2).toBe(0)
    expect(crop!.y % 2).toBe(0)
  })

  it('clamps a selection that runs off the edge', () => {
    const crop = computeCrop({
      selection: { x: 1900, y: 1060, width: 400, height: 400 },
      overlay,
      video: { width: 1920, height: 1080 },
    })
    expect(crop).toEqual({ x: 1900, y: 1060, width: 20, height: 20 })
  })

  it('refuses a monitor of a different shape, where a proportional crop would be wrong', () => {
    // The user drew on a 16:9 display; the portal captured an ultrawide (21:9).
    expect(computeCrop({ selection, overlay, video: { width: 3440, height: 1440 } })).toBeNull()
  })

  it('refuses when the selection covers the whole frame anyway', () => {
    expect(computeCrop({ selection: { x: 0, y: 0, width: 1920, height: 1080 }, overlay, video: overlay })).toBeNull()
  })

  it('refuses a stray click', () => {
    expect(
      computeCrop({ selection: { x: 10, y: 10, width: 4, height: 3 }, overlay, video: { width: 1920, height: 1080 } }),
    ).toBeNull()
  })

  it('refuses degenerate and missing input rather than producing a bad filter', () => {
    const video = { width: 1920, height: 1080 }
    expect(computeCrop({ selection: { x: 0, y: 0, width: 0, height: 0 }, overlay, video })).toBeNull()
    expect(computeCrop({ selection, overlay: { width: 0, height: 0 }, video })).toBeNull()
    expect(computeCrop({ selection, overlay, video: { width: 0, height: 0 } })).toBeNull()
    expect(computeCrop({ selection, overlay, video: { width: NaN, height: 1080 } as never })).toBeNull()
  })

  it('tolerates a tiny aspect difference from rounding', () => {
    // 1920x1080 vs 1919x1080 is a rounding difference, not a different monitor.
    expect(computeCrop({ selection, overlay, video: { width: 1919, height: 1080 } })).not.toBeNull()
  })
})
