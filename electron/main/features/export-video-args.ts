// Pure mapping from the export quality setting to H.264/H.265 encoder arguments.
// Dependency-free so the resulting argv can be unit tested.

import type { ExportVideoCodec } from '../../../shared/export-codec'

export type ExportQuality = 'low' | 'medium' | 'high'

/**
 * CRF and preset per quality level.
 *
 * `medium` reproduces the pre-quality-setting behaviour exactly: libx264 with
 * `-preset medium` and no explicit CRF (its default is 23).
 */
const QUALITY_SETTINGS: Record<ExportQuality, { crf: number; preset: string }> = {
  low: { crf: 28, preset: 'medium' },
  medium: { crf: 23, preset: 'medium' },
  high: { crf: 18, preset: 'slow' },
}

export function qualityToX264Args(quality: ExportQuality | string | undefined | null): string[] {
  const resolved = QUALITY_SETTINGS[quality as ExportQuality] ?? QUALITY_SETTINGS.medium
  return ['-c:v', 'libx264', '-preset', resolved.preset, '-crf', String(resolved.crf), '-pix_fmt', 'yuv420p']
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
