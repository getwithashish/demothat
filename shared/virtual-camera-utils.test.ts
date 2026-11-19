import { describe, expect, it } from 'vitest'
import { rgbaToI420, flipI420Horizontal, createStandbySlateI420 } from './virtual-camera-utils'

describe('virtual-camera-utils', () => {
  it('converts RGBA to I420 accurately for known color values', () => {
    const width = 4
    const height = 4
    const rgba = new Uint8Array(width * height * 4)
    // Fill with pure white: RGBA(255, 255, 255, 255)
    rgba.fill(255)

    const out = new Uint8Array(width * height * 1.5)
    rgbaToI420(rgba, width, height, out)

    // Y plane should be close to 235 (studio white)
    for (let i = 0; i < width * height; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(230)
      expect(out[i]).toBeLessThanOrEqual(240)
    }

    // U and V should be around 128 (neutral chroma for monochrome)
    for (let i = width * height; i < out.length; i++) {
      expect(out[i]).toBeCloseTo(128, -1)
    }
  })

  it('handles black pixels correctly', () => {
    const width = 2
    const height = 2
    const rgba = new Uint8Array(width * height * 4) // All zeros
    const out = new Uint8Array(width * height * 1.5)
    rgbaToI420(rgba, width, height, out)

    // Y plane for black should be around 16
    for (let i = 0; i < width * height; i++) {
      expect(out[i]).toBe(16)
    }
    // U and V for black should be 128
    for (let i = width * height; i < out.length; i++) {
      expect(out[i]).toBe(128)
    }
  })

  it('handles invalid or zero dimensions without crashing', () => {
    const rgba = new Uint8Array(16)
    const out = new Uint8Array(6)
    expect(() => rgbaToI420(rgba, 0, 0, out)).not.toThrow()
    expect(() => flipI420Horizontal(out, 0, 0)).not.toThrow()
  })

  it('flips I420 horizontally in-place', () => {
    const width = 4
    const height = 2
    const out = new Uint8Array(width * height * 1.5)

    // Fill row 0 with [1, 2, 3, 4] and row 1 with [5, 6, 7, 8]
    out[0] = 1
    out[1] = 2
    out[2] = 3
    out[3] = 4
    out[4] = 5
    out[5] = 6
    out[6] = 7
    out[7] = 8

    // UV plane (2x1 for U, 2x1 for V)
    const ySize = width * height
    out[ySize] = 10
    out[ySize + 1] = 20
    out[ySize + 2] = 30
    out[ySize + 3] = 40

    flipI420Horizontal(out, width, height)

    // Flipped row 0: [4, 3, 2, 1]
    expect(out[0]).toBe(4)
    expect(out[1]).toBe(3)
    expect(out[2]).toBe(2)
    expect(out[3]).toBe(1)

    // Flipped row 1: [8, 7, 6, 5]
    expect(out[4]).toBe(8)
    expect(out[5]).toBe(7)
    expect(out[6]).toBe(6)
    expect(out[7]).toBe(5)

    // Flipped U: [20, 10]
    expect(out[ySize]).toBe(20)
    expect(out[ySize + 1]).toBe(10)

    // Flipped V: [40, 30]
    expect(out[ySize + 2]).toBe(40)
    expect(out[ySize + 3]).toBe(30)
  })

  it('generates standby slate with correct size and neutral chroma', () => {
    const slate = createStandbySlateI420(1920, 1080)
    expect(slate.length).toBe(1920 * 1080 * 1.5)
    expect(slate[0]).toBe(24) // Y
    expect(slate[1920 * 1080]).toBe(128) // U
    expect(slate[1920 * 1080 + 960 * 540]).toBe(128) // V
  })
})
