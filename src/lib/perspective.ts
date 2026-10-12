// Pure math for the perspective tilt effect. No DOM or canvas access here so it can be unit tested.
//
// The recorded frame is treated as a flat plane that sits at depth 0 and is rotated about the
// center of the output canvas, then projected onto the screen with a simple pinhole camera.
//
// Sign convention (matches CSS):
//   tiltX > 0  -> the top edge moves away from the viewer
//   tiltY > 0  -> the right edge moves away from the viewer

export interface TiltParams {
  /** Rotation about the horizontal axis, in degrees. */
  tiltX: number
  /** Rotation about the vertical axis, in degrees. */
  tiltY: number
  /** Perspective strength, 0 (almost orthographic) to 100 (strong foreshortening). */
  perspective: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A projected point. `q` is the perspective scale (1 at the pivot depth, <1 farther away). */
export interface ProjectedPoint {
  x: number
  y: number
  q: number
}

export type Quad = [ProjectedPoint, ProjectedPoint, ProjectedPoint, ProjectedPoint]

const TILT_EPSILON = 0.01
const DEG_TO_RAD = Math.PI / 180

/** How far beyond the output canvas the tilted layer is rendered, as a fraction of the output size. */
export const TILT_LAYER_MARGIN = 0.25

export function isTiltActive(params: Partial<TiltParams> | undefined | null): boolean {
  if (!params) return false
  return Math.abs(params.tiltX ?? 0) > TILT_EPSILON || Math.abs(params.tiltY ?? 0) > TILT_EPSILON
}

/**
 * Camera distance in pixels for a given perspective strength.
 * Strength 0 puts the camera far away (nearly flat), strength 100 puts it close (dramatic).
 */
export function cameraDistance(perspective: number, outputWidth: number): number {
  const strength = Math.min(1, Math.max(0, (perspective ?? 50) / 100))
  return outputWidth * (4.5 - 3.7 * strength)
}

function rotatePoint(relX: number, relY: number, tiltX: number, tiltY: number) {
  const a = tiltX * DEG_TO_RAD
  const b = tiltY * DEG_TO_RAD

  // Rotate about the X axis (top recedes for positive angles).
  const x1 = relX
  const y1 = relY * Math.cos(a)
  const z1 = -relY * Math.sin(a)

  // Rotate about the Y axis (right side recedes for positive angles).
  const x2 = x1 * Math.cos(b) - z1 * Math.sin(b)
  const z2 = z1 * Math.cos(b) + x1 * Math.sin(b)

  return { x: x2, y: y1, z: z2 }
}

function layerCorners(layerRect: Rect): Array<[number, number]> {
  return [
    [layerRect.x, layerRect.y],
    [layerRect.x + layerRect.width, layerRect.y],
    [layerRect.x + layerRect.width, layerRect.y + layerRect.height],
    [layerRect.x, layerRect.y + layerRect.height],
  ]
}

/**
 * Camera distance used for a given tilt and layer. It is the configured distance, pushed out if
 * needed so that no corner of the layer can end up at or behind the camera.
 */
export function resolveCameraDistance(
  params: TiltParams,
  layerRect: Rect,
  outputWidth: number,
  outputHeight: number,
): number {
  const cx = outputWidth / 2
  const cy = outputHeight / 2
  const maxDepth = Math.max(
    ...layerCorners(layerRect).map(([x, y]) =>
      Math.abs(rotatePoint(x - cx, y - cy, params.tiltX ?? 0, params.tiltY ?? 0).z),
    ),
  )
  return Math.max(cameraDistance(params.perspective, outputWidth), maxDepth * 1.25 + 1)
}

/** Projects one point of the plane (output-canvas coordinates) using a resolved camera distance. */
export function projectPoint(
  params: TiltParams,
  distance: number,
  outputWidth: number,
  outputHeight: number,
  x: number,
  y: number,
): ProjectedPoint {
  const cx = outputWidth / 2
  const cy = outputHeight / 2
  const p = rotatePoint(x - cx, y - cy, params.tiltX ?? 0, params.tiltY ?? 0)
  const q = distance / (distance + p.z)
  return { x: cx + p.x * q, y: cy + p.y * q, q }
}

/**
 * Projects the corners of `layerRect` (given in output-canvas coordinates) after tilting the plane
 * about the center of the output canvas. Corner order: top-left, top-right, bottom-right, bottom-left.
 */
export function projectLayerQuad(params: TiltParams, layerRect: Rect, outputWidth: number, outputHeight: number): Quad {
  const distance = resolveCameraDistance(params, layerRect, outputWidth, outputHeight)
  return layerCorners(layerRect).map(([x, y]) =>
    projectPoint(params, distance, outputWidth, outputHeight, x, y),
  ) as Quad
}

/**
 * Solves the 2D affine transform that maps three source points onto three destination points.
 * Returns [a, b, c, d, e, f] in the order expected by CanvasRenderingContext2D.transform().
 */
export function solveAffine(
  src: [[number, number], [number, number], [number, number]],
  dst: [[number, number], [number, number], [number, number]],
): [number, number, number, number, number, number] | null {
  const [[x0, y0], [x1, y1], [x2, y2]] = src
  const [[X0, Y0], [X1, Y1], [X2, Y2]] = dst

  const den = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1)
  if (Math.abs(den) < 1e-9) return null

  const a = (X0 * (y1 - y2) + X1 * (y2 - y0) + X2 * (y0 - y1)) / den
  const b = (Y0 * (y1 - y2) + Y1 * (y2 - y0) + Y2 * (y0 - y1)) / den
  const c = (X0 * (x2 - x1) + X1 * (x0 - x2) + X2 * (x1 - x0)) / den
  const d = (Y0 * (x2 - x1) + Y1 * (x0 - x2) + Y2 * (x1 - x0)) / den
  const e = (X0 * (x1 * y2 - x2 * y1) + X1 * (x2 * y0 - x0 * y2) + X2 * (x0 * y1 - x1 * y0)) / den
  const f = (Y0 * (x1 * y2 - x2 * y1) + Y1 * (x2 * y0 - x0 * y2) + Y2 * (x0 * y1 - x1 * y0)) / den

  return [a, b, c, d, e, f]
}
