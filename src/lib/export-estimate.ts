// Pure helpers for the "estimated render time" figures in the export modal.
//
// Nothing here talks to Electron or the store; the modal feeds in the samples
// the main process recorded and these functions do the arithmetic.

import type { ExportVideoCodec } from '../../shared/export-codec'
import type { ResolutionKey } from '../../shared/export-resolutions'

/** One measured export, recorded by the main process after it completes. */
export interface ExportPerfSample {
  resolution: ResolutionKey
  codec: ExportVideoCodec
  /** The frame-rate setting the export ran at. */
  settingFps: number
  width: number
  height: number
  /** Measured frames per second for the whole render + encode pipeline. */
  throughput: number
}

/**
 * Stand-in used when nothing has been measured yet: a conservative software
 * H.264 figure at 1080p. It is scaled by output pixels like a real sample, is
 * only ever shown as a wide "rough" range, and is replaced by a real
 * measurement after the first completed export.
 *
 * This is a local CPU placeholder, not a GPU benchmark.
 */
export const ROUGH_BASELINE_THROUGHPUT_AT_1080P = 20
const PIXELS_AT_1080P = 1920 * 1080

/** How wide the "rough" range is before any real measurement exists. */
export const ROUGH_RANGE_RATIO = 0.5

export function framesFor(durationSec: number, fps: number): number {
  if (!(durationSec > 0) || !(fps > 0)) return 0
  return Math.floor(durationSec * fps)
}

/** Scales a measured throughput between output sizes by their pixel ratio. */
export function scaleThroughputByPixelRatio(throughput: number, fromPixels: number, toPixels: number): number {
  if (!(throughput > 0) || !(fromPixels > 0) || !(toPixels > 0)) return 0
  return throughput * (fromPixels / toPixels)
}

export interface RenderEstimate {
  seconds: number
  /** True when no measurement for this exact configuration exists. */
  rough: boolean
  /** True when a real measured sample (possibly from another size) was used. */
  fromSample: boolean
}

/**
 * Estimated local render time for one configuration: frames ÷ throughput.
 * Uses an exact sample when one exists, otherwise the closest measured sample
 * scaled by output pixels, otherwise the documented rough baseline.
 */
export function estimateLocalSeconds(options: {
  frames: number
  targetWidth: number
  targetHeight: number
  resolution: ResolutionKey
  codec: ExportVideoCodec
  settingFps: number
  samples: ExportPerfSample[]
}): RenderEstimate {
  const { frames, targetWidth, targetHeight, resolution, codec, settingFps, samples } = options
  if (frames <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return { seconds: 0, rough: false, fromSample: false }
  }
  const targetPixels = targetWidth * targetHeight

  const exact = samples.find(
    (sample) => sample.resolution === resolution && sample.codec === codec && sample.settingFps === settingFps,
  )
  const fallback = exact ?? samples.find((sample) => sample.codec === codec) ?? samples[0]

  if (fallback) {
    const scaled = scaleThroughputByPixelRatio(fallback.throughput, fallback.width * fallback.height, targetPixels)
    if (scaled > 0) return { seconds: frames / scaled, rough: !exact, fromSample: true }
  }

  const baseline = scaleThroughputByPixelRatio(ROUGH_BASELINE_THROUGHPUT_AT_1080P, PIXELS_AT_1080P, targetPixels)
  if (!(baseline > 0)) return { seconds: 0, rough: true, fromSample: false }
  return { seconds: frames / baseline, rough: true, fromSample: false }
}

/** The ± range shown for a rough estimate. */
export function roughRange(seconds: number, ratio: number = ROUGH_RANGE_RATIO): { min: number; max: number } {
  const safe = seconds > 0 ? seconds : 0
  return { min: Math.max(0, safe * (1 - ratio)), max: safe * (1 + ratio) }
}

/**
 * Remaining seconds for a running export, derived from elapsed / progress.
 * Returns null while progress is still 0 (nothing to extrapolate from).
 */
export function estimateRemainingSeconds(elapsedSeconds: number, progressPercent: number): number | null {
  if (!(elapsedSeconds > 0)) return null
  if (!(progressPercent > 0) || progressPercent >= 100) return null
  const total = elapsedSeconds / (progressPercent / 100)
  return Math.max(0, total - elapsedSeconds)
}

export interface CloudCapabilities {
  /** Seconds the server needs to start a worker. */
  startupSeconds: number
  /** Frames per second the upscaler processes at the selected target size. */
  upscaleFps: number
}

export interface CloudEstimateInput extends CloudCapabilities {
  frames: number
  /** Size of the rendered intermediate that gets uploaded. */
  fileMB: number
  /** Size of the upscaled result that gets downloaded. */
  outputMB: number
  uplinkMbps: number
  downlinkMbps: number
}

export interface CloudEstimate {
  uploadSeconds: number
  startupSeconds: number
  computeSeconds: number
  downloadSeconds: number
  totalSeconds: number
}

/**
 * Upload + startup + upscale + download. Upload usually dominates on a slow
 * connection, which is why the breakdown is shown rather than just a total.
 */
export function estimateCloudSeconds(input: CloudEstimateInput): CloudEstimate {
  const uploadSeconds = input.uplinkMbps > 0 ? (input.fileMB * 8) / input.uplinkMbps : 0
  const downloadSeconds = input.downlinkMbps > 0 ? (input.outputMB * 8) / input.downlinkMbps : 0
  const computeSeconds = input.upscaleFps > 0 ? input.frames / input.upscaleFps : 0
  const startupSeconds = Math.max(0, input.startupSeconds)
  return {
    uploadSeconds,
    startupSeconds,
    computeSeconds,
    downloadSeconds,
    totalSeconds: uploadSeconds + startupSeconds + computeSeconds + downloadSeconds,
  }
}

/** Which of two estimates is faster (null when they are effectively equal). */
export function fasterMethod(localSeconds: number, cloudSeconds: number): 'local' | 'cloud' | null {
  if (!(localSeconds > 0) || !(cloudSeconds > 0)) return null
  const ratio = cloudSeconds / localSeconds
  if (ratio > 0.95 && ratio < 1.05) return null
  return cloudSeconds < localSeconds ? 'cloud' : 'local'
}

/** Megabyte estimate for a video of a given duration/size (for cloud uploads). */
export function estimateFileMB(durationSeconds: number, bitrateMbps: number): number {
  if (!(durationSeconds > 0) || !(bitrateMbps > 0)) return 0
  return (durationSeconds * bitrateMbps) / 8
}

/**
 * Rough output bitrate per quality setting. Only used to size the file a cloud
 * export would upload and download, so the breakdown is visible before a single
 * byte moves. These are documented estimates, not measurements.
 */
export const ASSUMED_BITRATE_MBPS: Record<'low' | 'medium' | 'high', number> = {
  low: 4,
  medium: 8,
  high: 16,
}
