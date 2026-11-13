// Pure mapping from the export quality setting to H.264/H.265 encoder arguments.
// Dependency-free so the resulting argv can be unit tested.

import type { ExportVideoCodec } from '../../../shared/export-codec'

export type ExportQuality = 'low' | 'medium' | 'high'

/**
 * CRF and preset per quality level for serial exports.
 *
 * `medium` reproduces the pre-quality-setting behaviour exactly: libx264 with
 * `-preset medium` and no explicit CRF (its default is 23).
 */
const QUALITY_SETTINGS: Record<ExportQuality, { crf: number; preset: string }> = {
  low: { crf: 28, preset: 'medium' },
  medium: { crf: 23, preset: 'medium' },
  high: { crf: 18, preset: 'slow' },
}

/**
 * Optimized fast presets for software libx264 parallel chunk export.
 * Significantly faster frame processing per worker process with tuned CRF
 * to preserve crisp visual clarity.
 */
const FAST_X264_SETTINGS: Record<ExportQuality, { crf: number; preset: string }> = {
  low: { crf: 28, preset: 'veryfast' },
  medium: { crf: 23, preset: 'faster' },
  high: { crf: 19, preset: 'fast' },
}

/**
 * Hardware encoder quality settings.
 */
const NVENC_SETTINGS: Record<ExportQuality, { cq: number; preset: string }> = {
  low: { cq: 28, preset: 'p2' },
  medium: { cq: 23, preset: 'p4' },
  high: { cq: 18, preset: 'p5' },
}

const VIDEOTOOLBOX_SETTINGS: Record<ExportQuality, { q: number }> = {
  low: { q: 50 },
  medium: { q: 65 },
  high: { q: 80 },
}

const QSV_SETTINGS: Record<ExportQuality, { globalQuality: number; preset: string }> = {
  low: { globalQuality: 28, preset: 'veryfast' },
  medium: { globalQuality: 23, preset: 'faster' },
  high: { globalQuality: 19, preset: 'fast' },
}

const VAAPI_SETTINGS: Record<ExportQuality, { qp: number }> = {
  low: { qp: 28 },
  medium: { qp: 23 },
  high: { qp: 18 },
}

export function qualityToX264Args(quality: ExportQuality | string | undefined | null): string[] {
  const resolved = QUALITY_SETTINGS[quality as ExportQuality] ?? QUALITY_SETTINGS.medium
  return ['-c:v', 'libx264', '-preset', resolved.preset, '-crf', String(resolved.crf), '-pix_fmt', 'yuv420p']
}

export function fastX264Args(quality: ExportQuality | string | undefined | null): string[] {
  const resolved = FAST_X264_SETTINGS[quality as ExportQuality] ?? FAST_X264_SETTINGS.medium
  return ['-c:v', 'libx264', '-preset', resolved.preset, '-crf', String(resolved.crf), '-pix_fmt', 'yuv420p']
}

/**
 * Arguments for hardware or fast software H.264 encoders.
 */
export function encoderToH264Args(
  encoder: string | undefined | null,
  quality: ExportQuality | string | undefined | null,
): string[] {
  const q = (quality as ExportQuality) in FAST_X264_SETTINGS ? (quality as ExportQuality) : 'medium'

  switch (encoder) {
    case 'h264_nvenc': {
      const s = NVENC_SETTINGS[q]
      return ['-c:v', 'h264_nvenc', '-preset', s.preset, '-cq', String(s.cq), '-pix_fmt', 'yuv420p']
    }
    case 'h264_videotoolbox': {
      const s = VIDEOTOOLBOX_SETTINGS[q]
      return ['-c:v', 'h264_videotoolbox', '-q:v', String(s.q), '-pix_fmt', 'yuv420p']
    }
    case 'h264_qsv': {
      const s = QSV_SETTINGS[q]
      return ['-c:v', 'h264_qsv', '-global_quality', String(s.globalQuality), '-preset', s.preset, '-pix_fmt', 'nv12']
    }
    case 'h264_vaapi': {
      const s = VAAPI_SETTINGS[q]
      return ['-c:v', 'h264_vaapi', '-qp', String(s.qp)]
    }
    case 'libx264':
    default:
      return fastX264Args(q)
  }
}

/**
 * HEVC args for targets above 4K. `-tag:v hvc1` is what makes an HEVC MP4 play
 * in QuickTime, Safari, VLC and browsers; without it the track is tagged
 * `hev1` and many players refuse it.
 */
export function qualityToX265Args(quality: ExportQuality | string | undefined | null): string[] {
  const resolved = QUALITY_SETTINGS[quality as ExportQuality] ?? QUALITY_SETTINGS.medium
  return [
    '-c:v',
    'libx265',
    '-preset',
    resolved.preset,
    '-crf',
    String(resolved.crf),
    '-tag:v',
    'hvc1',
    '-pix_fmt',
    'yuv420p',
  ]
}

/** Encoder args for the codec an export needs. */
export function videoEncodeArgs(codec: ExportVideoCodec, quality: ExportQuality | string | undefined | null): string[] {
  return codec === 'hevc' ? qualityToX265Args(quality) : qualityToX264Args(quality)
}
