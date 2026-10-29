// Render cap for exports.
//
// The editor never allocates a canvas at the full output size: an 8K canvas
// would be 132 MB per frame and stall the renderer. It draws at this cap and
// FFmpeg scales up to the exact target with Lanczos. One constant, shared so
// the main process and the renderer agree on the size.

export interface RenderCap {
  /** Maximum length of the longest side. */
  longestSide: number
  /** Maximum height. */
  maxHeight: number
}

export const EXPORT_RENDER_CAP: RenderCap = {
  longestSide: 3840,
  maxHeight: 2160,
}

function toEven(value: number): number {
  return value % 2 === 0 ? value : value + 1
}

/**
 * Scales target dimensions down to fit the cap, preserving aspect ratio and
 * keeping both sides even. Sizes already inside the cap are returned as-is.
 */
export function applyRenderCap(
  width: number,
  height: number,
  cap: RenderCap = EXPORT_RENDER_CAP,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width, height }

  const scale = Math.min(1, cap.longestSide / Math.max(width, height), cap.maxHeight / height)
  return { width: toEven(Math.round(width * scale)), height: toEven(Math.round(height * scale)) }
}

/** True when FFmpeg has to scale the rendered frame up to the target size. */
export function needsUpscale(
  renderWidth: number,
  renderHeight: number,
  targetWidth: number,
  targetHeight: number,
): boolean {
  return renderWidth !== targetWidth || renderHeight !== targetHeight
}

/**
 * The size a cloud AI job renders its intermediate at: the source video's own
 * resolution, never above the target.
 *
 * The AI model performs the enlargement, so an intermediate that already
 * matches the target would only re-encode it — the worker treats it as a
 * passthrough plan and loads no model, while the export still charged AI
 * prices. Rendering at the source's native size keeps every pixel the source
 * has (none is thrown away, none is invented) and gives the model real work up
 * to the exact target.
 */
export function cloudIntermediateSize(
  targetWidth: number,
  targetHeight: number,
  videoWidth: number,
  videoHeight: number,
): { width: number; height: number } {
  return applyRenderCap(targetWidth, targetHeight, { longestSide: videoWidth, maxHeight: videoHeight })
}
