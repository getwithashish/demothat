// Single source of truth for export resolutions.
//
// Imported by BOTH the Electron main process and the renderer, so this file
// must stay free of runtime dependencies (no Electron, no DOM, no Node APIs).

export type ResolutionKey = '720p' | '1080p' | '2k' | '4k' | '8k'

export const RESOLUTIONS: Record<ResolutionKey, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '2k': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
  '8k': { width: 7680, height: 4320 },
}

/** Ordered options for the export modal; `label` is what the user sees. */
export const RESOLUTION_OPTIONS: ReadonlyArray<{ key: ResolutionKey; label: string }> = [
  { key: '720p', label: 'HD (720p)' },
  { key: '1080p', label: 'Full HD (1080p)' },
  { key: '2k', label: '2K (1440p)' },
  { key: '4k', label: '4K (2160p)' },
  { key: '8k', label: '8K (4320p)' },
]

export function isResolutionKey(value: unknown): value is ResolutionKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(RESOLUTIONS, value)
}

/**
 * Output size for a resolution key. The height is the anchor; the width is
 * derived from the project aspect ratio (so 9:16 and 1:1 work), rounded up to
 * an even number for the encoders.
 */
export function exportDimensions(resolution: ResolutionKey, aspectRatio: string): { width: number; height: number } {
  const height = RESOLUTIONS[resolution].height
  const [ratioWidth, ratioHeight] = aspectRatio.split(':').map(Number)
  const width = Math.round(height * (ratioWidth / ratioHeight))
  return { width: width % 2 === 0 ? width : width + 1, height }
}
