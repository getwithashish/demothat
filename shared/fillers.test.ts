import { describe, expect, it } from 'vitest'
import { isFiller, removeFillers } from './fillers'
import type { TranscriptDocument } from './transcript'

/** A transcript with word timings, which is the case the app actually produces. */
const withWords: TranscriptDocument = {
  version: 1,
  language: 'en',
  model: 'large-v3',
  durationSec: 12,
  segments: [
    {
      start: 0,
      end: 4,
      text: 'So um this is the um dashboard',
      words: [
        { start: 0, end: 0.3, text: 'So' },
        { start: 0.3, end: 0.6, text: ' um' },
        { start: 0.6, end: 0.9, text: ' this' },
        { start: 0.9, end: 1.2, text: ' is' },
        { start: 1.2, end: 1.5, text: ' the' },
        { start: 1.5, end: 1.8, text: ' um' },
        { start: 1.8, end: 2.4, text: ' dashboard' },
      ],
    },
    {
      start: 5,
      end: 6,
      text: 'Uh',
      words: [{ start: 5, end: 6, text: 'Uh' }],
    },
    {
      start: 7,
      end: 11,
      text: 'Then we export it',
      words: [
        { start: 7, end: 7.4, text: 'Then' },
        { start: 7.4, end: 7.8, text: ' we' },
        { start: 7.8, end: 8.4, text: ' export' },
        { start: 8.4, end: 8.8, text: ' it' },
        { start: 8.8, end: 9.1, text: '.' },
      ],
    },
  ],
}

describe('isFiller', () => {
  it('knows the hesitation sounds, however they are spelt', () => {
    for (const word of ['um', 'Um,', 'uhh', 'Ummm', 'erm', 'hmm', 'mm', 'Mhm']) {
      expect(isFiller(word)).toBe(true)
    }
  })

  it('does not touch a word that carries meaning in some sentences', () => {
    // The whole reason the list is short: these are filler sometimes and content
    // other times, and a caption that drops "like" changes what was said.
    for (const word of ['like', 'so', 'right', 'actually', 'basically', 'obviously']) {
      expect(isFiller(word)).toBe(false)
    }
  })

  it('takes extra words from the caller', () => {
    expect(isFiller('y\'know')).toBe(false)
    expect(isFiller("y'know", ["y'know"])).toBe(true)
  })

  it('ignores punctuation and empty tokens', () => {
    expect(isFiller('...')).toBe(false)
    expect(isFiller('')).toBe(false)
  })
})

describe('removeFillers', () => {
  it('drops the fillers and keeps the words around them', () => {
    const result = removeFillers(withWords)
    expect(result.transcript.segments[0]?.text).toBe('So this is the dashboard')
    expect(result.removedCount).toBe(3)
  })

  it('drops a segment that was nothing but a hesitation', () => {
    const result = removeFillers(withWords)
    // "Uh" on its own was a whole cue; leaving an empty cue would put a blank strip
    // on the timeline over silence.
    expect(result.transcript.segments.map((segment) => segment.text)).toEqual([
      'So this is the dashboard',
      'Then we export it.',
    ])
  })

  it('keeps every surviving word its own timing', () => {
    const result = removeFillers(withWords)
    const words = result.transcript.segments[0]?.words ?? []
    expect(words.map((word) => word.text)).toEqual(['So', ' this', ' is', ' the', ' dashboard'])
    expect(words[0]?.start).toBe(0)
    expect(words[words.length - 1]?.end).toBe(2.4)
  })

  it('reports what it removed, so the app can say so and the user can undo it', () => {
    const result = removeFillers(withWords)
    expect(result.removed.map((entry) => entry.text)).toEqual(['um', 'um', 'Uh'])
    expect(result.removed[0]).toEqual({ text: 'um', start: 0.3, end: 0.6 })
  })

  it('never mutates the transcript it was given', () => {
    const before = JSON.stringify(withWords)
    removeFillers(withWords)
    expect(JSON.stringify(withWords)).toBe(before)
  })

  it('leaves the timings of the segments alone', () => {
    const result = removeFillers(withWords)
    expect(result.transcript.segments.map((segment) => [segment.start, segment.end])).toEqual([
      [0, 4],
      [7, 11],
    ])
  })

  it('keeps stutters unless asked, and drops them when asked', () => {
    const stutter: TranscriptDocument = {
      version: 1,
      language: null,
      model: 'large-v3',
      durationSec: 4,
      segments: [
        {
          start: 0,
          end: 4,
          text: 'I I think the the file',
          words: [
            { start: 0, end: 0.4, text: 'I' },
            { start: 0.4, end: 0.8, text: ' I' },
            { start: 0.8, end: 1.4, text: ' think' },
            { start: 1.4, end: 1.8, text: ' the' },
            { start: 1.8, end: 2.2, text: ' the' },
            { start: 2.2, end: 2.8, text: ' file' },
          ],
        },
      ],
    }

    expect(removeFillers(stutter).transcript.segments[0]?.text).toBe('I I think the the file')
    expect(
      removeFillers(stutter, { dropStutters: true }).transcript.segments[0]?.text,
    ).toBe('I think the file')
  })

  it('falls back to a text pass when the transcript has no word timings', () => {
    const noWords: TranscriptDocument = {
      version: 1,
      language: null,
      model: 'large-v3',
      durationSec: 6,
      segments: [
        { start: 0, end: 3, text: 'Um, so the point is , uh, that it works' },
        { start: 3, end: 4, text: 'Hmm' },
        { start: 4, end: 6, text: 'and that is it' },
      ],
    }

    const result = removeFillers(noWords)
    expect(result.transcript.segments.map((segment) => segment.text)).toEqual([
      'so the point is, that it works',
      'and that is it',
    ])
    // "Um,", "uh," and the "Hmm" segment: three, and the segment that was only a
    // hesitation is gone rather than left blank.
    expect(result.removedCount).toBe(3)
  })

  it('is a no-op on a transcript with nothing to remove', () => {
    const clean: TranscriptDocument = {
      version: 1,
      language: null,
      model: 'large-v3',
      durationSec: 3,
      segments: [{ start: 0, end: 3, text: 'Nothing to see here' }],
    }
    const result = removeFillers(clean)
    expect(result.removedCount).toBe(0)
    expect(result.transcript.segments[0]?.text).toBe('Nothing to see here')
  })

  it('reports zero rather than an error for a transcript with no segments', () => {
    const empty: TranscriptDocument = {
      version: 1,
      language: null,
      model: 'large-v3',
      durationSec: 0,
      segments: [],
    }
    expect(removeFillers(empty).removedCount).toBe(0)
  })
})
