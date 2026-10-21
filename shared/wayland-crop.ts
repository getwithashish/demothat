// Wayland area recording: turning a drawn rectangle into a crop of the capture.
//
// The portal cannot record a user-drawn region — it hands over a whole monitor
// (or a window). So on Wayland the recorder captures the monitor and crops the
// selection out of it in the same FFmpeg pass that already transcodes the
// renderer's WebM. That makes this file the one place the geometry is worked
// out, and it is pure so it can be tested without a compositor.
//
// Two coordinate systems have to be reconciled:
//   - the selection overlay reports CSS pixels of its own fullscreen window,
//   - the captured video is in the monitor's physical pixels.
// The ratio between them is the whole job (a 125%-scaled 1920-wide monitor can
// produce a 2400-wide video, and cropping by the raw selection would cut the
// wrong part of the frame).

export interface CaptureRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CropInputs {
  /** What the user drew, in CSS pixels of the overlay. */
  selection: CaptureRect
  /** The overlay's own size in CSS pixels — the reference the selection is measured against. */
  overlay: { width: number; height: number }
  /** The captured file's real pixel size, probed from the video itself. */
  video: { width: number; height: number }
}

/**
 * A different monitor of a different shape means the portal gave us something
 * other than the display the user drew on, and a proportional crop would land in
 * the wrong place. Refuse rather than guess.
 */
const ASPECT_TOLERANCE = 0.02

/** Below this, a crop is more likely to be a stray click than a selection. */
const MIN_CROP_PX = 16

const round = (value: number): number => Math.round(value)
const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high)
/** H.264 wants even dimensions. */
const evenFloor = (value: number): number => Math.max(0, Math.floor(value / 2) * 2)

const isPositive = (value: number | undefined): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/**
 * The rectangle to crop the captured video to, in video pixels, or null when
 * there is nothing sensible to crop — a full-frame selection, a mismatch, or
 * degenerate input. Callers treat null as "keep the whole frame".
 */
export function computeCrop({ selection, overlay, video }: CropInputs): CaptureRect | null {
  if (!selection || !overlay || !video) return null
  if (!isPositive(overlay.width) || !isPositive(overlay.height)) return null
  if (!isPositive(video.width) || !isPositive(video.height)) return null
  if (!isPositive(selection.width) || !isPositive(selection.height)) return null

  const overlayAspect = overlay.width / overlay.height
  const videoAspect = video.width / video.height
  if (Math.abs(videoAspect - overlayAspect) / overlayAspect > ASPECT_TOLERANCE) return null

  const scaleX = video.width / overlay.width
  const scaleY = video.height / overlay.height

  // Judge the drawn size before clamping up, so a stray click stays a stray
  // click rather than becoming a 16x16 crop.
  const drawnWidth = round(selection.width * scaleX)
  const drawnHeight = round(selection.height * scaleY)
  if (drawnWidth < MIN_CROP_PX || drawnHeight < MIN_CROP_PX) return null

  // Keep the drawn origin and truncate at the frame edge rather than sliding the
  // rectangle inwards, which would silently capture something the user did not
  // draw. (The overlay already clamps its own selection, so this is a guard.)
  const originX = evenFloor(clamp(round(selection.x * scaleX), 0, video.width))
  const originY = evenFloor(clamp(round(selection.y * scaleY), 0, video.height))
  const width = evenFloor(clamp(drawnWidth, MIN_CROP_PX, video.width - originX))
  const height = evenFloor(clamp(drawnHeight, MIN_CROP_PX, video.height - originY))
  if (width < MIN_CROP_PX || height < MIN_CROP_PX) return null

  const x = originX
  const y = originY

  // A selection covering the whole frame is not a crop; skip the filter.
  if (width >= video.width && height >= video.height) return null

  return { x, y, width, height }
}
