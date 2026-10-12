import { describe, expect, it } from 'vitest'
import {
  TILT_LAYER_MARGIN,
  cameraDistance,
  isTiltActive,
  projectLayerQuad,
  projectPoint,
  resolveCameraDistance,
  solveAffine,
  type Rect,
  type TiltParams,
} from './perspective'

const W = 1920
const H = 1080
const outputRect: Rect = { x: 0, y: 0, width: W, height: H }
const flat: TiltParams = { tiltX: 0, tiltY: 0, perspective: 50 }

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

describe('isTiltActive', () => {
  it('is false for missing or zero tilt', () => {
    expect(isTiltActive(undefined)).toBe(false)
    expect(isTiltActive(null)).toBe(false)
    expect(isTiltActive({})).toBe(false)
    expect(isTiltActive(flat)).toBe(false)
    expect(isTiltActive({ tiltX: 0.001, tiltY: 0 })).toBe(false)
  })

  it('is true when either axis is tilted', () => {
    expect(isTiltActive({ tiltX: 10, tiltY: 0 })).toBe(true)
    expect(isTiltActive({ tiltX: 0, tiltY: -10 })).toBe(true)
  })
})

describe('projectLayerQuad', () => {
  it('leaves the plane untouched when there is no tilt', () => {
    const quad = projectLayerQuad(flat, outputRect, W, H)
    expect(quad.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [W, 0],
      [W, H],
      [0, H],
    ])
    quad.forEach((p) => expect(p.q).toBeCloseTo(1, 10))
  })

  it('keeps the pivot (output center) fixed', () => {
    const params: TiltParams = { tiltX: 30, tiltY: -20, perspective: 70 }
    const distance = resolveCameraDistance(params, outputRect, W, H)
    const center = projectPoint(params, distance, W, H, W / 2, H / 2)
    expect(center.x).toBeCloseTo(W / 2, 6)
    expect(center.y).toBeCloseTo(H / 2, 6)
    expect(center.q).toBeCloseTo(1, 6)
  })

  it('makes the top edge shorter when tilting up (positive tiltX)', () => {
    const [tl, tr, br, bl] = projectLayerQuad({ ...flat, tiltX: 30 }, outputRect, W, H)
    expect(dist(tl, tr)).toBeLessThan(dist(bl, br))
    expect(tl.q).toBeLessThan(1)
    expect(bl.q).toBeGreaterThan(1)
  })

  it('makes the right edge shorter when tilting right (positive tiltY)', () => {
    const [tl, tr, br, bl] = projectLayerQuad({ ...flat, tiltY: 30 }, outputRect, W, H)
    expect(dist(tr, br)).toBeLessThan(dist(tl, bl))
    expect(tr.q).toBeLessThan(1)
    expect(tl.q).toBeGreaterThan(1)
  })

  it('mirrors when the tilt angle changes sign', () => {
    const up = projectLayerQuad({ ...flat, tiltX: 25 }, outputRect, W, H)
    const down = projectLayerQuad({ ...flat, tiltX: -25 }, outputRect, W, H)
    // Tilting down is tilting up flipped vertically.
    expect(down[0].x).toBeCloseTo(up[3].x, 6)
    expect(down[0].y).toBeCloseTo(H - up[3].y, 6)
    expect(down[1].x).toBeCloseTo(up[2].x, 6)
    expect(down[1].y).toBeCloseTo(H - up[2].y, 6)
  })

  it('foreshortens more with a stronger perspective setting', () => {
    const ratio = (perspective: number) => {
      const [tl, tr, br, bl] = projectLayerQuad({ tiltX: 30, tiltY: 0, perspective }, outputRect, W, H)
      return dist(tl, tr) / dist(bl, br)
    }
    expect(ratio(100)).toBeLessThan(ratio(50))
    expect(ratio(50)).toBeLessThan(ratio(0))
    expect(ratio(0)).toBeLessThan(1)
  })

  it('stays finite for extreme tilt on the oversized layer', () => {
    const margin = TILT_LAYER_MARGIN
    const layer: Rect = { x: -W * margin, y: -H * margin, width: W * (1 + 2 * margin), height: H * (1 + 2 * margin) }
    const quad = projectLayerQuad({ tiltX: 45, tiltY: 45, perspective: 100 }, layer, W, H)
    quad.forEach((p) => {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
      expect(p.q).toBeGreaterThan(0)
    })
  })

  it('treats missing tilt fields (older projects) as flat', () => {
    const legacy = {} as TiltParams
    const quad = projectLayerQuad(legacy, outputRect, W, H)
    expect(quad[0].x).toBeCloseTo(0, 10)
    expect(quad[2].y).toBeCloseTo(H, 10)
  })

  it('projects straight lines to straight lines with perspective-correct interpolation', () => {
    // The WebGL shader interpolates (u*q, v*q, q) linearly in screen space. That is only correct if
    // the midpoint of an edge in the plane lands where perspective-correct interpolation says it should.
    const params: TiltParams = { tiltX: 35, tiltY: 15, perspective: 80 }
    const distance = resolveCameraDistance(params, outputRect, W, H)
    const a = projectPoint(params, distance, W, H, 0, 0)
    const b = projectPoint(params, distance, W, H, W, 0)
    const mid = projectPoint(params, distance, W, H, W / 2, 0)

    const t = 0.5
    const denom = (1 - t) / a.q + t / b.q
    const expectedX = ((1 - t) * (a.x - W / 2)) / a.q + (t * (b.x - W / 2)) / b.q
    const expectedY = ((1 - t) * (a.y - H / 2)) / a.q + (t * (b.y - H / 2)) / b.q
    expect(mid.x).toBeCloseTo(W / 2 + expectedX / denom, 6)
    expect(mid.y).toBeCloseTo(H / 2 + expectedY / denom, 6)
    expect(mid.q).toBeCloseTo(1 / denom, 10)
  })
})

describe('cameraDistance', () => {
  it('moves the camera closer as perspective increases', () => {
    expect(cameraDistance(100, W)).toBeLessThan(cameraDistance(50, W))
    expect(cameraDistance(50, W)).toBeLessThan(cameraDistance(0, W))
  })

  it('clamps out-of-range values', () => {
    expect(cameraDistance(-50, W)).toBe(cameraDistance(0, W))
    expect(cameraDistance(500, W)).toBe(cameraDistance(100, W))
  })
})

describe('solveAffine', () => {
  it('maps the source triangle onto the destination triangle', () => {
    const src: [[number, number], [number, number], [number, number]] = [
      [0, 0],
      [100, 0],
      [0, 50],
    ]
    const dst: [[number, number], [number, number], [number, number]] = [
      [10, 20],
      [210, 30],
      [5, 120],
    ]
    const m = solveAffine(src, dst)
    expect(m).not.toBeNull()
    const [a, b, c, d, e, f] = m!
    src.forEach(([x, y], i) => {
      expect(a * x + c * y + e).toBeCloseTo(dst[i][0], 8)
      expect(b * x + d * y + f).toBeCloseTo(dst[i][1], 8)
    })
  })

  it('returns null for a degenerate (collinear) source triangle', () => {
    expect(
      solveAffine(
        [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
        [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
      ),
    ).toBeNull()
  })
})
