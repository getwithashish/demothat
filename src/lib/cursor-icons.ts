// Selectable cursor icon styles, drawn on an offscreen canvas.
//
// The theme packs the Windows/macOS builds use are OS cursor formats; the
// portable way to offer a choice of pointer icons (for every platform) is to
// draw a small set of cursor glyphs ourselves. `prepareCursorIcons` rasterises
// each style at the post-processing scale and returns them in the same
// Map<string, CursorImageBitmap> shape the captured-cursor path uses, so the
// renderer swaps one source for the other without touching its draw loop.
//
// Pure canvas — no DOM tree, no binary assets — so it runs in the editor
// preview and in the export worker identically.

import type { CursorImageBitmap } from '../types'

/** The cursor icon the user chose. `recorded` = use the OS cursor as captured. */
export type CursorIconStyle = 'recorded' | 'arrow' | 'text' | 'hand' | 'crosshair' | 'pointer'

export const CURSOR_ICON_STYLES: ReadonlyArray<{ value: CursorIconStyle; label: string }> = [
  { value: 'arrow', label: 'Arrow' },
  { value: 'text', label: 'Text (I-beam)' },
  { value: 'hand', label: 'Hand' },
  { value: 'crosshair', label: 'Crosshair' },
  { value: 'pointer', label: 'Pointer' },
]

/** Base rasterised size (CSS px) before the post-processing scale is applied. */
export const CURSOR_ICON_BASE_SIZE = 24

/**
 * Draw one cursor glyph in the base (unscaled) coordinate space. The caller sets
 * the fill/stroke style; this only emits the shape paths. Exported so the Cursor
 * settings thumbnails render the identical glyph the preview and export use.
 */
export function drawCursorGlyph(ctx: CanvasRenderingContext2D, style: Exclude<CursorIconStyle, 'recorded'>): void {
  switch (style) {
    case 'arrow': {
      // Classic diagonal arrow, tip at (8, 8).
      ctx.beginPath()
      ctx.moveTo(8, 8)
      ctx.lineTo(8, 20)
      ctx.lineTo(11, 16)
      ctx.lineTo(14, 19)
      ctx.lineTo(16, 17)
      ctx.lineTo(13, 14)
      ctx.lineTo(16.5, 13.5)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      break
    }
    case 'text': {
      // Vertical I-beam with top and bottom serifs.
      ctx.beginPath()
      ctx.moveTo(10, 5)
      ctx.lineTo(14, 5)
      ctx.lineTo(14, 7)
      ctx.lineTo(12.5, 7)
      ctx.lineTo(12.5, 17)
      ctx.lineTo(14, 17)
      ctx.lineTo(14, 19)
      ctx.lineTo(10, 19)
      ctx.lineTo(10, 17)
      ctx.lineTo(11.5, 17)
      ctx.lineTo(11.5, 7)
      ctx.lineTo(10, 7)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      break
    }
    case 'hand': {
      // Open palm: a rounded body plus a thumb and two fingers, hotspot at the
      // top of the palm (the "hover" point).
      ctx.beginPath()
      ctx.roundRect(7, 9, 7, 10, 3)
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.roundRect(12, 5, 3.5, 7, 1.5)
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.roundRect(15, 6, 3, 8, 1.5)
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.roundRect(4, 12, 3.5, 6, 1.5)
      ctx.fill()
      ctx.stroke()
      break
    }
    case 'crosshair': {
      // Precision crosshair: four crossing lines plus a centre dot.
      ctx.beginPath()
      ctx.moveTo(12, 2)
      ctx.lineTo(12, 6)
      ctx.moveTo(12, 18)
      ctx.lineTo(12, 22)
      ctx.moveTo(2, 12)
      ctx.lineTo(6, 12)
      ctx.moveTo(18, 12)
      ctx.lineTo(22, 12)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(12, 12, 5, Math.PI, 0, true)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(12, 12, 1.2, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'pointer': {
      // Pointing index finger (link hover cursor), tip at (10,4).
      ctx.beginPath()
      ctx.moveTo(6, 19)
      ctx.quadraticCurveTo(4, 9, 9, 4)
      ctx.lineTo(12, 6)
      ctx.lineTo(15, 4)
      ctx.quadraticCurveTo(18, 8, 17, 12)
      ctx.lineTo(14, 11)
      ctx.lineTo(14, 14)
      ctx.lineTo(11, 13)
      ctx.lineTo(11, 17)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      break
    }
  }
}

/** The hotspot (tip / focus point) per glyph, in the base coordinate space. */
function glyphHotspot(style: Exclude<CursorIconStyle, 'recorded'>): { xhot: number; yhot: number } {
  switch (style) {
    case 'arrow':
      return { xhot: 8, yhot: 8 }
    case 'text':
      return { xhot: 12, yhot: 12 }
    case 'hand':
      return { xhot: 11, yhot: 9 }
    case 'crosshair':
      return { xhot: 12, yhot: 12 }
    case 'pointer':
      return { xhot: 10, yhot: 4 }
  }
}

/**
 * Draw a small (24px) thumbnail of one cursor icon into a canvas, for the Cursor
 * settings picker grid. `recorded` draws the arrow as a stand-in for "whatever
 * the OS captured". Returns whether the 2D context was available.
 */
export function renderCursorIconThumb(canvas: HTMLCanvasElement, style: CursorIconStyle): boolean {
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.clearRect(0, 0, CURSOR_ICON_BASE_SIZE, CURSOR_ICON_BASE_SIZE)
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#000'
  ctx.lineWidth = 1.4
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (style === 'recorded') {
    // Stand-in for "whatever the OS captured": the arrow.
    ctx.beginPath()
    ctx.moveTo(5, 5)
    ctx.lineTo(5, 17)
    ctx.lineTo(8, 13.5)
    ctx.lineTo(11, 16.5)
    ctx.lineTo(13, 14.5)
    ctx.lineTo(10, 11.5)
    ctx.lineTo(13.5, 11)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    return true
  }
  drawCursorGlyph(ctx, style)
  return true
}

/**
 * Rasterise the non-recorded cursor icons at the post-processing scale. Returns
 * a map keyed by style name (minus `recorded`), ready for the renderer to pick.
 * An icon that fails to draw degrades silently to the captured cursor.
 */
export async function prepareCursorIcons(scale = 1): Promise<Map<string, CursorImageBitmap>> {
  const map = new Map<string, CursorImageBitmap>()
  const effective = scale > 0 ? scale : 1
  const base = CURSOR_ICON_BASE_SIZE

  for (const { value } of CURSOR_ICON_STYLES) {
    if (value === 'recorded') continue
    const { xhot, yhot } = glyphHotspot(value)
    const width = Math.max(1, Math.round(base * effective))
    const height = Math.max(1, Math.round(base * effective))
    try {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      // Draw in the base coordinate space, scaled up so edges stay crisp.
      ctx.setTransform(effective, 0, 0, effective, 0, 0)
      ctx.clearRect(0, 0, base, base)
      ctx.fillStyle = '#fff'
      ctx.strokeStyle = '#000'
      ctx.lineWidth = 1.4
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      drawCursorGlyph(ctx, value)
      const imageBitmap = await createImageBitmap(canvas)
      map.set(value, {
        width,
        height,
        xhot: xhot * effective,
        yhot: yhot * effective,
        imageBitmap,
        scale: effective,
      })
    } catch {
      // Fall back to the captured cursor for this style.
    }
  }
  return map
}
