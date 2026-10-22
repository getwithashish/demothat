// Which lanes the timeline has, and in what order.
//
// Pulled out of the component so it can be tested: the row list is what decides
// whether a lane exists at all, and a lane that silently does not appear is
// indistinguishable from a feature that was never built.
//
// The recording's audio is the part that is not fixed. It used to be one
// placeholder row; it is now one row per source, because each source has its own
// volume and mute and a lane is how the editor says so.

export interface TimelineRow {
  key: string
  label: string
  height: number
}

/** The row that stands in for the recording's audio, replaced by the real tracks. */
export const RECORDED_AUDIO_ROW_KEY = 'recorded-audio'

export interface BuildTrackRowsOptions {
  /** Imported video clips, already ordered top-first. */
  videoClipIds: string[]
  /** The recording's audio sources. Empty means the recording has no audio. */
  audioTracks: { id: string; label: string }[]
  /** The lanes that always exist, in order. */
  fixedRows: TimelineRow[]
  rowHeight: number
}

/**
 * The timeline's rows, top to bottom.
 *
 * A recording with no audio gets no audio lane at all — not an empty one. An empty
 * lane is a promise of audio that is not there, and it would sit in the timeline
 * forever, because nothing would ever remove it.
 */
export function buildTrackRows(options: BuildTrackRowsOptions): TimelineRow[] {
  const { videoClipIds, audioTracks, fixedRows, rowHeight } = options

  const videoRows: TimelineRow[] = videoClipIds.map((id) => ({ key: id, label: 'Video', height: rowHeight }))
  const audioRows: TimelineRow[] = audioTracks.map((track) => ({
    key: track.id,
    label: track.label,
    height: rowHeight,
  }))

  const fixed = fixedRows.flatMap((row) =>
    row.key === RECORDED_AUDIO_ROW_KEY ? audioRows : [row],
  )

  return [...videoRows, ...fixed]
}
