// Selectable cursor icon styles, sourced from the bundled cursor theme packs.
//
// The theme packs (binaries/<platform>/cursor-themes/*.theme) ship the same
// named cursors on every platform, so the icon picker uses those exact glyphs
// on Linux too (previously Windows/macOS only). `prepareCursorIcons` builds the
// selected icons from a parsed theme and returns them in the same
// Map<string, CursorImageBitmap> shape the captured-cursor path uses, so the
// renderer swaps one source for the other without touching its draw loop.
//
// A glyph that is missing from the theme degrades silently to the captured cursor.

import type { CursorFrame, CursorImageBitmap, CursorTheme } from '../types'

/** The cursor icon the user chose. `recorded` = use the OS cursor as captured. */
export type CursorIconStyle = 'recorded' | 'arrow' | 'text' | 'hand' | 'crosshair' | 'pointer'

/** Which named cursor each style maps to inside a theme pack. */
export const STYLE_TO_CURSOR_NAME: Record<Exclude<CursorIconStyle, 'recorded'>, string> = {
  arrow: 'arrow',
  text: 'IBeam',
  hand: 'openHand',
  crosshair: 'crosshair',
  pointer: 'pointingHand',
}

export const CURSOR_ICON_STYLES: ReadonlyArray<{ value: CursorIconStyle; label: string }> = [
  { value: 'arrow', label: 'Arrow' },
  { value: 'text', label: 'Text (I-beam)' },
  { value: 'hand', label: 'Hand' },
  { value: 'crosshair', label: 'Crosshair' },
  { value: 'pointer', label: 'Pointer' },
]

/**
 * Build the selectable cursor icons from a parsed theme pack, one per style,
 * at the requested scale. Mirrors prepareMacOSCursorBitmaps: each style takes
 * the first frame of its named cursor and turns it into an ImageBitmap.
 */
export async function prepareCursorIcons(
  theme: CursorTheme | null,
  scale = 1,
): Promise<Map<string, CursorImageBitmap>> {
  const map = new Map<string, CursorImageBitmap>()
  if (!theme) return map

  const cursorSet = theme[scale] || theme[Object.keys(theme)[0] as unknown as number] || {}
  for (const { value } of CURSOR_ICON_STYLES) {
    if (value === 'recorded') continue
    const frames = (cursorSet as Record<string, CursorFrame[]>)[STYLE_TO_CURSOR_NAME[value]]
    const frame = frames?.[0]
    if (!frame || !('rgba' in frame) || !frame.width || !frame.height) continue
    try {
      const buffer = new Uint8ClampedArray(Object.values(frame.rgba))
      const imageData = new ImageData(buffer, frame.width, frame.height)
      const imageBitmap = await createImageBitmap(imageData)
      map.set(value, { ...frame, imageBitmap })
    } catch {
      // Fall back to the captured cursor for this style.
    }
  }
  return map
}
