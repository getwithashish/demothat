// Subtitles: the cues, and the sidecar files they become.
//
// The two things that matter and cannot be checked by eye: the timestamps have to be
// in the format each player accepts (SRT uses a comma before the milliseconds, VTT a
// dot, and both are strict about the digit counts), and the cue list has to be
// something a player can render — sorted, non-overlapping, and long enough on screen
// to read.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_CHARS_PER_LINE,
  cuesFromTranscript,
  formatSrtTimestamp,
  formatSubtitles,
  formatVttTimestamp,
  normalizeCues,
  toSrt,
  toVtt,
  wrapCueText,
  type SubtitleCue,
} from './subtitles'
import type { TranscriptDocument } from './transcript'

const cue = (id: string, start: number, end: number, text: string): SubtitleCue => ({ id, start, end, text })

describe('timestamps', () => {
  it('formats SRT with a comma before the milliseconds', () => {
    expect(formatSrtTimestamp(0)).toBe('00:00:00,000')
    expect(formatSrtTimestamp(1.5)).toBe('00:00:01,500')
    expect(formatSrtTimestamp(61.25)).toBe('00:01:01,250')
    expect(formatSrtTimestamp(3661.007)).toBe('01:01:01,007')
  })

  it('formats VTT with a dot', () => {
    expect(formatVttTimestamp(0)).toBe('00:00:00.000')
    expect(formatVttTimestamp(61.25)).toBe('00:01:01.250')
  })

  it('does not roll over when rounding would reach the next second', () => {
    // 59.9996 rounds to 60000ms. Rounding the fraction instead of the whole value
    // would print 00:00:59,1000 — which no parser accepts.
    expect(formatSrtTimestamp(59.9996)).toBe('00:01:00,000')
    expect(formatSrtTimestamp(3599.9996)).toBe('01:00:00,000')
  })

  it('pads every field, so the columns line up in a text editor', () => {
    expect(formatSrtTimestamp(5.005)).toBe('00:00:05,005')
    expect(formatSrtTimestamp(5.05)).toBe('00:00:05,050')
    expect(formatSrtTimestamp(5.5)).toBe('00:00:05,500')
  })

  it('never produces a negative timestamp', () => {
    expect(formatSrtTimestamp(-1)).toBe('00:00:00,000')
  })
})

describe('wrapCueText', () => {
  it('breaks at word boundaries, not mid-word', () => {
    // Text that fits inside the allowed lines: every line respects the width, and
    // none of them was split through a word.
    const wrapped = wrapCueText('The quick brown fox jumps over', 20, 2)

    expect(wrapped.split('\n')).toHaveLength(2)
    for (const line of wrapped.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(20)
      expect(line).not.toMatch(/^\s|\s$/)
    }
    // The break is at a space, so no word was cut in half.
    expect(wrapped.split('\n').every((line) => line.split(' ').every((word) => word.length > 0))).toBe(true)
  })

  it('leaves a word longer than the line whole rather than splitting it', () => {
    // Splitting it would be the worse of the two.
    expect(wrapCueText('supercalifragilisticexpialidocious', 10, 2)).toBe('supercalifragilisticexpialidocious')
  })

  it('keeps the words when there are more lines than the convention allows', () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve'
    const wrapped = wrapCueText(text, 12, 2)

    expect(wrapped.split('\n')).toHaveLength(2)
    // Nothing is dropped: the last line takes the remainder.
    expect(wrapped.replace(/\n/g, ' ')).toBe(text)
  })

  it('is empty for empty text', () => {
    expect(wrapCueText('   ')).toBe('')
  })

  it('does not wrap text that already fits', () => {
    expect(wrapCueText('Short line.', DEFAULT_MAX_CHARS_PER_LINE, 2)).toBe('Short line.')
  })
})

describe('normalizeCues', () => {
  it('sorts by start time', () => {
    const cues = normalizeCues([cue('b', 5, 6, 'second'), cue('a', 1, 2, 'first')])

    expect(cues.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('drops empty text rather than writing a blank caption', () => {
    expect(normalizeCues([cue('a', 0, 1, '   '), cue('b', 1, 2, 'kept')]).map((entry) => entry.id)).toEqual(['b'])
  })

  it('drops a cue that ends before it starts', () => {
    expect(normalizeCues([cue('a', 2, 1, 'backwards')])).toEqual([])
  })

  it('extends a cue that is too short to read, into the gap after it', () => {
    const cues = normalizeCues([cue('a', 0, 0.2, 'quick'), cue('b', 2, 3, 'later')])

    expect(cues[0]?.end).toBeCloseTo(0.6, 6)
    expect(cues[1]?.start).toBe(2)
  })

  it('does not extend a cue into the one after it', () => {
    // The gap is smaller than the minimum reading time.
    const cues = normalizeCues([cue('a', 0, 0.2, 'quick'), cue('b', 0.3, 1, 'next')])

    expect(cues[0]?.end).toBeCloseTo(0.3, 6)
  })

  it('trims an overlap to where the next cue starts', () => {
    const cues = normalizeCues([cue('a', 0, 2, 'long one'), cue('b', 1, 3, 'the next')])

    expect(cues[0]?.end).toBeCloseTo(1, 6)
    expect(cues[1]?.start).toBe(1)
    // And they do not overlap.
    expect(cues[0]!.end).toBeLessThanOrEqual(cues[1]!.start)
  })

  it('drops a cue with no room at all, rather than writing a zero-length one', () => {
    // Two cues at the same instant: the first has nowhere to go.
    const cues = normalizeCues([cue('a', 1, 2, 'first'), cue('b', 1, 2, 'second')])

    expect(cues).toHaveLength(1)
    expect(cues[0]?.id).toBe('b')
  })

  it('extends the last cue, which has nothing to collide with', () => {
    const cues = normalizeCues([cue('a', 5, 5.1, 'last words')])

    expect(cues[0]?.end).toBeCloseTo(5.6, 6)
  })

  it('clamps a negative start', () => {
    expect(normalizeCues([cue('a', -1, 1, 'text')])[0]?.start).toBe(0)
  })

  it('wraps the text of every cue it keeps', () => {
    const long = 'a'.repeat(60) + ' ' + 'b'.repeat(60)
    const cues = normalizeCues([cue('a', 0, 3, long)], { maxCharsPerLine: 20, maxLines: 3 })

    expect(cues[0]!.text.split('\n').length).toBeLessThanOrEqual(3)
  })

  it('leaves a list that is already fine alone', () => {
    const input = [cue('a', 0, 2, 'one'), cue('b', 3, 5, 'two')]

    expect(normalizeCues(input)).toEqual(input)
  })
})

describe('toSrt', () => {
  it('numbers the cues from one and separates them with a blank line', () => {
    const srt = toSrt([cue('a', 0, 1.5, 'First line.'), cue('b', 2, 3, 'Second line.')])

    expect(srt).toBe(
      '1\n00:00:00,000 --> 00:00:01,500\nFirst line.\n' + '\n' + '2\n00:00:02,000 --> 00:00:03,000\nSecond line.\n',
    )
  })

  it('is empty for no cues', () => {
    expect(toSrt([])).toBe('')
  })
})

describe('toVtt', () => {
  it('starts with the header the format requires', () => {
    const vtt = toVtt([cue('a', 0, 1, 'Hello.')])

    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true)
    expect(vtt).toContain('00:00:00.000 --> 00:00:01.000\nHello.')
  })

  it('still has the header when there are no cues', () => {
    // A file with no cues is valid; one without the header is not.
    expect(toVtt([])).toBe('WEBVTT\n\n')
  })
})

describe('formatSubtitles', () => {
  const cues = [cue('a', 0, 1, 'Hello.')]

  it('picks the format it was asked for', () => {
    expect(formatSubtitles(cues, 'srt')).toContain('00:00:00,000')
    expect(formatSubtitles(cues, 'vtt')).toContain('00:00:00.000')
    expect(formatSubtitles(cues, 'vtt').startsWith('WEBVTT')).toBe(true)
  })
})

describe('cuesFromTranscript', () => {
  const transcript: TranscriptDocument = {
    version: 1,
    language: 'en',
    model: 'large-v3',
    durationSec: 6,
    segments: [
      { start: 0, end: 2, text: 'Opening the settings panel.' },
      { start: 2.5, end: 4, text: 'Choosing a background colour.' },
      { start: 5, end: 6, text: 'And saving it.' },
    ],
  }

  it('turns each segment into a cue on the export timeline', () => {
    const cues = cuesFromTranscript(transcript, (time) => time)

    expect(cues.map((entry) => entry.text)).toEqual([
      'Opening the settings panel.',
      'Choosing a background colour.',
      'And saving it.',
    ])
    expect(cues[1]?.start).toBeCloseTo(2.5, 6)
  })

  it('moves the cues with the material when the timeline is cut', () => {
    // A cut of one second of source at 3-4s: everything after it happens a second
    // earlier in the exported video, and the caption has to be there to meet it.
    const cues = cuesFromTranscript(transcript, (time) => (time >= 4 ? time - 1 : time))

    expect(cues.map((entry) => entry.text)).toEqual([
      'Opening the settings panel.',
      'Choosing a background colour.',
      'And saving it.',
    ])
    // Was at 5s in the recording; the second the cut removed puts it at 4s.
    expect(cues[2]?.start).toBeCloseTo(4, 6)
    // The middle cue maps to 2.5-3, which is half a second — shorter than the minimum
    // reading time, and there is room before the next cue at 4, so it is extended.
    expect(cues[1]?.end).toBeCloseTo(3.1, 6)
  })

  it('drops a segment that was cut out entirely', () => {
    // A segment whose whole span maps to nothing: the words are not in the video, and
    // a caption over material that is not there would be worse than none.
    const cues = cuesFromTranscript(transcript, (time) => (time >= 2 && time <= 4 ? 2 : time))

    expect(cues.map((entry) => entry.text)).toEqual(['Opening the settings panel.', 'And saving it.'])
  })

  it('gives each cue an id that depends on where it came from', () => {
    const cues = cuesFromTranscript(transcript, (time) => time)

    expect(new Set(cues.map((entry) => entry.id)).size).toBe(cues.length)
    expect(cues[0]?.id).toContain('cue-0-')
  })

  it('has nothing for a transcript with no speech', () => {
    expect(cuesFromTranscript({ ...transcript, segments: [] }, (time) => time)).toEqual([])
  })
})
