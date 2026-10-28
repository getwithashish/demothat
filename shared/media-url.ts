/**
 * The renderer reaches local media files through the `media://` custom protocol
 * (registered in the main process). The file path MUST be percent-encoded the
 * same way everywhere — a path with a space, `#` or `?` in it would otherwise
 * not resolve. Keep every construction of a `media://` URL behind this helper so
 * the two processes cannot drift.
 */
export function mediaUrl(filePath: string): string {
  return `media://${encodeURI(filePath).replace(/#/g, '%23').replace(/\?/g, '%3F')}`
}
