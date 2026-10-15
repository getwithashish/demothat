// Single source of truth for export resolutions.
//
// Imported by BOTH the Electron main process and the renderer, so this file
// must stay free of runtime dependencies (no Electron, no DOM, no Node APIs).

export type ResolutionKey = '720p' | '1080p' | '2k' | '4k'

export const RESOLUTIONS: Record<ResolutionKey, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '2k': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
}

/** Ordered options for the export modal; `label` is what the user sees. */
export const RESOLUTION_OPTIONS: ReadonlyArray<{ key: ResolutionKey; label: string }> = [
  { key: '720p', label: 'HD (720p)' },
  { key: '1080p', label: 'Full HD (1080p)' },
  { key: '2k', label: '2K (1440p)' },
  { key: '4k', label: '4K (2160p)' },
]

export function isResolutionKey(value: unknown): value is ResolutionKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(RESOLUTIONS, value)
}
