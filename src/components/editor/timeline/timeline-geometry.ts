// Timeline geometry (DESIGN_SPEC §8): 34px rows, 26px clips, 22px ruler, 108px track header.
export const ROW_HEIGHT = 34
export const CLIP_HEIGHT = 26
export const LANE_INSET = (ROW_HEIGHT - CLIP_HEIGHT) / 2 // 4px above and below each clip
export const RULER_HEIGHT = 22
export const TRACK_HEADER_WIDTH = 108
export const RESIZE_HANDLE_HEIGHT = 16 // h-4 separator height
export const TIMELINE_SCROLLBAR_GUTTER = 8 // 8px horizontal scrollbar clearance
export const MIN_TIMELINE_HEIGHT = 180
export const MAX_TIMELINE_HEIGHT = 760

/**
 * Calculates the default timeline height such that all track rows (down to the
 * bottom masking effects row) fit completely without empty space or row clipping.
 */
export function calculateFittedTimelineHeight(trackLayoutHeight: number): number {
  return RESIZE_HANDLE_HEIGHT + RULER_HEIGHT + trackLayoutHeight + TIMELINE_SCROLLBAR_GUTTER
}
