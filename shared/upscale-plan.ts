// Choosing the cloud model's scale factor, and the final FFmpeg scale that
// reaches the exact target size.
//
// Pure and shared: the client uses it to show what will happen and to predict
// the price, and the server uses the same shape (it re-derives `need` from the
// uploaded file with ffprobe and never trusts client-reported dimensions).

/** Scale factors the Real-ESRGAN anime/video model supports. */
export const ANIMEVIDEO_SCALES = [2, 3, 4]

/** Every other Real-ESRGAN model is 4x only. */
export const FOUR_X_ONLY_SCALES = [4]

/**
 * Screen recordings are mostly flat UI and text, so the anime/video model is the
 * default; the server advertises alternatives through /v1/capabilities.
 */
export const DEFAULT_UPSCALE_MODEL = 'realesr-animevideov3'

export interface ModelCapabilities {
  id: string
  label?: string
  /** Supported scale factors, ascending. */
  scales: number[]
}

/**
 * How far below `need` a factor may be and still be chosen.
 *
 * Relative, not absolute: a factor that is a fraction of a percent short only
 * hands a ~1.01x Lanczos pass to FFmpeg, while jumping to the next factor runs
 * the model on far more pixels for no visible gain — and costs the user credits.
 */
const NEED_TOLERANCE_RATIO = 0.01

/** Guards against floating-point noise on an exactly-equal need. */
const NEED_EPSILON = 1e-6

export interface UpscalePlanInput {
  sourceWidth: number
  sourceHeight: number
  targetWidth: number
  targetHeight: number
  /** Factors the chosen model supports; defaults to the anime/video set. */
  modelScales?: number[]
}

export interface UpscalePlan {
  /** Output pixels per source pixel the target requires. */
  need: number
  /** The model factor to run at, or null when no model work is needed. */
  modelScale: number | null
  /** Size the model's own output will have. */
  modelWidth: number
  modelHeight: number
  /** The exact target the final Lanczos scale must reach. */
  targetWidth: number
  targetHeight: number
  /** True when the model output is below the target, so Lanczos scales up. */
  finishesWithUpscale: boolean
  /** True when the model output is above the target, so Lanczos scales down. */
  finishesWithDownscale: boolean
}

function usable(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/**
 * Plans one cloud upscale.
 *
 * `need = max(targetW/srcW, targetH/srcH)`; the smallest supported factor that
 * is at least `need` is chosen, and FFmpeg's Lanczos then lands on the exact
 * target. When no factor is big enough (720p to 8K needs 6x, and 4x is the
 * maximum), the largest factor is used and Lanczos finishes the remaining
 * factor — which for that case is an upscale, not a downscale.
 */
export function planUpscale(input: UpscalePlanInput): UpscalePlan {
  const { sourceWidth, sourceHeight, targetWidth, targetHeight } = input
  const scales = (input.modelScales?.length ? [...input.modelScales] : [...FOUR_X_ONLY_SCALES])
    .filter(usable)
    .sort((a, b) => a - b)

  const unusable = !usable(sourceWidth) || !usable(sourceHeight) || !usable(targetWidth) || !usable(targetHeight)
  if (unusable || scales.length === 0) {
    return {
      need: 0,
      modelScale: null,
      modelWidth: Math.max(0, Math.round(sourceWidth)),
      modelHeight: Math.max(0, Math.round(sourceHeight)),
      targetWidth: Math.max(0, Math.round(targetWidth)),
      targetHeight: Math.max(0, Math.round(targetHeight)),
      finishesWithUpscale: false,
      finishesWithDownscale: false,
    }
  }

  const need = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
  const exact = scales.find((scale) => scale >= need * (1 - NEED_TOLERANCE_RATIO) - NEED_EPSILON)

  // No model work when the target is at or below the source: FFmpeg alone does it.
  if (need <= 1 + NEED_EPSILON) {
    return {
      need,
      modelScale: null,
      modelWidth: Math.round(sourceWidth),
      modelHeight: Math.round(sourceHeight),
      targetWidth: Math.round(targetWidth),
      targetHeight: Math.round(targetHeight),
      finishesWithUpscale: false,
      finishesWithDownscale: need < 1 - NEED_EPSILON,
    }
  }

  const modelScale = exact ?? scales[scales.length - 1]
  const modelWidth = Math.round(sourceWidth * modelScale)
  const modelHeight = Math.round(sourceHeight * modelScale)

  return {
    need,
    modelScale,
    modelWidth,
    modelHeight,
    targetWidth: Math.round(targetWidth),
    targetHeight: Math.round(targetHeight),
    finishesWithUpscale: modelWidth < targetWidth || modelHeight < targetHeight,
    finishesWithDownscale: modelWidth > targetWidth || modelHeight > targetHeight,
  }
}

/** The FFmpeg filter that takes the model's output to the exact target. */
export function planFinalScaleFilter(plan: UpscalePlan): string | null {
  if (plan.modelScale === null) {
    return plan.targetWidth > 0 && plan.targetHeight > 0
      ? `scale=${plan.targetWidth}:${plan.targetHeight}:flags=lanczos`
      : null
  }
  if (plan.modelWidth === plan.targetWidth && plan.modelHeight === plan.targetHeight) return null
  return `scale=${plan.targetWidth}:${plan.targetHeight}:flags=lanczos`
}
