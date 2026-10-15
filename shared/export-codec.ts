// Which video codec an export needs, based on the target height.
//
// H.264 for 4K and below; HEVC above that (8K). The renderer, the export modal
// and the argument builder all read this so they cannot disagree.

export type ExportVideoCodec = 'h264' | 'hevc'

/** Above this height the export switches to HEVC. */
export const HEVC_TARGET_HEIGHT_THRESHOLD = 2160

export function selectExportCodec(targetHeight: number): ExportVideoCodec {
  return targetHeight > HEVC_TARGET_HEIGHT_THRESHOLD ? 'hevc' : 'h264'
}

/** Allowed formats for a given target height (GIF is limited to 2K). */
export const GIF_MAX_HEIGHT = 1440

export function isFormatAllowed(format: string, targetHeight: number): boolean {
  if (format === 'gif') return targetHeight <= GIF_MAX_HEIGHT
  return true
}
