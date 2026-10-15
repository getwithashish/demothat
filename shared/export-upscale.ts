// Pure upscale detection.
//
// Shared so the renderer (Pro badges) and the main process (export gate) always
// compute the same answer from the same inputs.
//
// The content-size maths mirrors src/lib/renderer.ts: the output is inset by
// the frame padding, the video is fitted into that box by aspect ratio, and the
// camera scale multiplies the result.

export interface FrameContentSizeInput {
  targetWidth: number
  targetHeight: number
  /** frameStyles.padding, in percent (0-30). */
  paddingPercent: number
  videoWidth: number
  videoHeight: number
  /** Optional camera-motion scale; 1 when there is no camera motion. */
  cameraScale?: number
}

export interface FrameContentSize {
  width: number
  height: number
}

export function computeFrameContentSize(input: FrameContentSizeInput): FrameContentSize {
  const { targetWidth, targetHeight, paddingPercent, videoWidth, videoHeight } = input
  const cameraScale = input.cameraScale && input.cameraScale > 0 ? input.cameraScale : 1
  if (
    !Number.isFinite(targetWidth) ||
    !Number.isFinite(targetHeight) ||
    !Number.isFinite(videoWidth) ||
    !Number.isFinite(videoHeight) ||
    targetWidth <= 0 ||
    targetHeight <= 0 ||
    videoWidth <= 0 ||
    videoHeight <= 0
  ) {
    return { width: 0, height: 0 }
  }

  const inset = Math.max(0, Math.min(0.45, (Number(paddingPercent) || 0) / 100))
  const availableWidth = targetWidth * (1 - 2 * inset)
  const availableHeight = targetHeight * (1 - 2 * inset)
  const videoAspectRatio = videoWidth / videoHeight

  let width: number
  let height: number
  if (availableWidth / availableHeight > videoAspectRatio) {
    height = availableHeight
    width = height * videoAspectRatio
  } else {
    width = availableWidth
    height = width / videoAspectRatio
  }

  return { width: width * cameraScale, height: height * cameraScale }
}

/** A small tolerance so rounding never nags the user with a Pro badge. */
export const UPSCALE_TOLERANCE = 1.05

export interface UpscaleInput extends FrameContentSizeInput {
  /** Largest zoom-region level (1 = no zoom). */
  maxZoom?: number
}

export interface UpscaleResult {
  contentWidth: number
  contentHeight: number
  /** Output pixels per source pixel for the drawn content. */
  requiredScale: number
  isUpscale: boolean
}

/**
 * How many output pixels the screen content fills compared with the source.
 * An export is an upscale when the content is stretched by more than the
 * tolerance; padding means a 1080p source at 1080p output is a slight
 * downscale, never an upscale.
 */
export function detectUpscale(input: UpscaleInput): UpscaleResult {
  const maxZoom = input.maxZoom && input.maxZoom > 0 ? input.maxZoom : 1
  const content = computeFrameContentSize(input)
  if (content.width <= 0) {
    return { contentWidth: 0, contentHeight: 0, requiredScale: 0, isUpscale: false }
  }
  const requiredScale = (content.width * maxZoom) / input.videoWidth
  return {
    contentWidth: content.width,
    contentHeight: content.height,
    requiredScale,
    isUpscale: requiredScale > UPSCALE_TOLERANCE,
  }
}

/** Largest zoom level among the timeline zoom regions. */
export function maxZoomLevel(zoomRegions: Record<string, { zoomLevel?: number }> | undefined): number {
  let max = 1
  for (const region of Object.values(zoomRegions ?? {})) {
    const level = Number(region?.zoomLevel)
    if (Number.isFinite(level) && level > max) max = level
  }
  return max
}

/** Largest scale among the 3D camera tracks. */
export function maxCameraScale(
  cameraMotions: Array<{ from?: { scale?: number }; to?: { scale?: number } }> | undefined,
): number {
  let max = 1
  for (const track of cameraMotions ?? []) {
    for (const pose of [track?.from, track?.to]) {
      const scale = Number(pose?.scale)
      if (Number.isFinite(scale) && scale > max) max = scale
    }
  }
  return max
}
