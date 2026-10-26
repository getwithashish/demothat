// The timeline's lane list.
//
// The interesting cases are the ones where a lane is *missing*: a recording with no
// audio must not get an empty lane, and a recording made before the microphone and
// the system audio were separated must get exactly one — not two, and not none.

import { describe, expect, it } from 'vitest'
import { buildTrackRows, RECORDED_AUDIO_ROW_KEY, SUBTITLE_ROW_KEY, type TimelineRow } from './track-rows'

const ROW_HEIGHT = 34

const FIXED: TimelineRow[] = [
  { key: 'screen', label: 'Screen', height: ROW_HEIGHT },
  { key: RECORDED_AUDIO_ROW_KEY, label: 'Recorded audio', height: ROW_HEIGHT },
  { key: SUBTITLE_ROW_KEY, label: 'Subtitles', height: ROW_HEIGHT },
  { key: 'music', label: 'Music', height: ROW_HEIGHT },
  { key: 'clicks', label: 'Click sounds', height: ROW_HEIGHT },
]

const MIC = { id: 'audio-mic-0', label: 'Microphone' }
const SYSTEM = { id: 'audio-system-1', label: 'System audio' }

const build = (
  audioTracks: { id: string; label: string }[],
  videoClipIds: string[] = [],
  subtitleCueIds: string[] = [],
) => buildTrackRows({ videoClipIds, audioTracks, subtitleCueIds, fixedRows: FIXED, rowHeight: ROW_HEIGHT })

describe('buildTrackRows', () => {
  it('gives each audio source its own lane, in order, with its own label', () => {
    const rows = build([MIC, SYSTEM])

    expect(rows.map((row) => row.key)).toEqual(['screen', 'audio-mic-0', 'audio-system-1', 'music', 'clicks'])
    expect(rows.map((row) => row.label)).toEqual(['Screen', 'Microphone', 'System audio', 'Music', 'Click sounds'])
  })

  it('replaces the placeholder row rather than adding to it', () => {
    const rows = build([MIC])

    expect(rows.map((row) => row.key)).not.toContain(RECORDED_AUDIO_ROW_KEY)
    expect(rows.filter((row) => row.key === 'audio-mic-0')).toHaveLength(1)
  })

  it('gives a pre-split recording exactly one lane, labelled for what it is', () => {
    // The migration hands this in as a single `mixed` track. One lane, and not the
    // microphone's: the file does not say which source it is.
    const rows = build([{ id: 'audio-mixed-0', label: 'Audio' }])

    expect(rows.map((row) => row.key)).toEqual(['screen', 'audio-mixed-0', 'music', 'clicks'])
    expect(rows[1]?.label).toBe('Audio')
  })

  it('gives a silent recording no audio lane at all', () => {
    const rows = build([])

    // An empty lane would promise audio that is not there, and nothing would ever
    // remove it.
    expect(rows.map((row) => row.key)).toEqual(['screen', 'music', 'clicks'])
  })

  it('keeps the audio lanes where the placeholder was, between screen and music', () => {
    const rows = build([MIC, SYSTEM])

    const indexOf = (key: string) => rows.findIndex((row) => row.key === key)
    expect(indexOf('screen')).toBeLessThan(indexOf('audio-mic-0'))
    expect(indexOf('audio-system-1')).toBeLessThan(indexOf('music'))
  })

  it('puts imported video clips above every fixed lane', () => {
    const rows = build([MIC], ['clip-a', 'clip-b'])

    expect(rows.map((row) => row.key)).toEqual(['clip-a', 'clip-b', 'screen', 'audio-mic-0', 'music', 'clicks'])
    // The screen lane stays underneath every clip.
    expect(rows.findIndex((row) => row.key === 'screen')).toBeGreaterThan(rows.findIndex((row) => row.key === 'clip-b'))
  })

  it('gives every row the row height, so the lanes cannot drift out of alignment', () => {
    const rows = build([MIC, SYSTEM], ['clip-a'])

    expect(rows.every((row) => row.height === ROW_HEIGHT)).toBe(true)
  })

  it('preserves the order of the fixed lanes it does not touch', () => {
    const rows = build([MIC])

    expect(rows.map((row) => row.key)).toEqual(['screen', 'audio-mic-0', 'music', 'clicks'])
  })
})

describe('the subtitle lane', () => {
  it('appears when there are captions, where the placeholder is', () => {
    const rows = build([MIC], [], ['cue-1', 'cue-2'])

    // Between the audio lanes and the music, which is where it sits in the row list.
    expect(rows.map((row) => row.key)).toEqual(['screen', 'audio-mic-0', SUBTITLE_ROW_KEY, 'music', 'clicks'])
    expect(rows.find((row) => row.key === SUBTITLE_ROW_KEY)?.label).toBe('Subtitles')
  })

  it('is absent when there are no captions', () => {
    // An empty lane would promise captions that are not there, and nothing would ever
    // remove it.
    expect(build([MIC]).map((row) => row.key)).not.toContain(SUBTITLE_ROW_KEY)
  })

  it('is absent for a recording with no audio and no captions', () => {
    expect(build([]).map((row) => row.key)).toEqual(['screen', 'music', 'clicks'])
  })

  it('appears even when the recording has no audio of its own', () => {
    // Captions can come from a transcript of a recording whose audio was all cut, and
    // the lane is about the captions, not about the audio.
    const rows = build([], [], ['cue-1'])

    expect(rows.map((row) => row.key)).toEqual(['screen', SUBTITLE_ROW_KEY, 'music', 'clicks'])
  })
})
