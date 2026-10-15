// Pure mapping from the export quality setting to H.264 encoder arguments.
// Dependency-free so the resulting argv can be unit tested.

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
