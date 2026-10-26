// Reading a cloud transcription's document: the shape, and how it survives a
// payload that came back over the network.
//
// The reader is deliberately forgiving — a bad segment costs a caption, not the
// transcript — but it is not credulous: it will not invent timings, and it will not
// hand back a document whose duration it cannot trust.

import { describe, expect, it } from 'vitest'
import { TRANSCRIPT_VERSION, parseTranscript, parseTranscriptJson, transcriptText } from '../../../shared/transcript'

const DOCUMENT = {
  version: 1,
  language: 'en',
  model: 'large-v3',
  durationSec: 312.4,
  segments: [
    {
      start: 0,
      end: 3.2,
      text: "Let's open the settings panel.",
      words: [
        { start: 0, end: 0.32, text: "Let's" },
        { start: 0.32, end: 0.9, text: 'open' },
      ],
    },
    { start: 3.4, end: 6.1, text: 'Choose a background colour.' },
  ],
}

describe('parseTranscript', () => {
  it('reads a document the worker actually produces', () => {
    const parsed = parseTranscript(DOCUMENT)

    expect(parsed).not.toBeNull()
    expect(parsed?.language).toBe('en')
    expect(parsed?.model).toBe('large-v3')
    expect(parsed?.durationSec).toBe(312.4)
    expect(parsed?.segments).toHaveLength(2)
    expect(parsed?.segments[0]?.words).toHaveLength(2)
  })

  it('keeps a segment without word timings, and drops the empty array', () => {
    const parsed = parseTranscript(DOCUMENT)

    expect(parsed?.segments[1]?.text).toBe('Choose a background colour.')
    // Absent, not an empty array: "no timings" and "timings that failed to parse"
    // are the same thing to every caller.
    expect(parsed?.segments[1]?.words).toBeUndefined()
  })

  it('sorts segments by start time', () => {
    const parsed = parseTranscript({
      ...DOCUMENT,
      segments: [DOCUMENT.segments[1], DOCUMENT.segments[0]],
    })

    expect(parsed?.segments.map((segment) => segment.start)).toEqual([0, 3.4])
  })

  it('drops a malformed segment and keeps the rest', () => {
    const parsed = parseTranscript({
      ...DOCUMENT,
      segments: [DOCUMENT.segments[0], { start: 'zero', end: 1, text: 'nope' }, DOCUMENT.segments[1]],
    })

    expect(parsed?.segments).toHaveLength(2)
    expect(parsed?.segments.map((segment) => segment.text)).toEqual([
      "Let's open the settings panel.",
      'Choose a background colour.',
    ])
  })

  it('drops malformed words but keeps the segment', () => {
    const parsed = parseTranscript({
      ...DOCUMENT,
      segments: [
        {
          start: 0,
          end: 1,
          text: 'hello there',
          words: [
            { start: 0, end: 0.5, text: 'hello' },
            { start: null, end: 1, text: 'there' },
          ],
        },
      ],
    })

    expect(parsed?.segments[0]?.words).toHaveLength(1)
    expect(parsed?.segments[0]?.words?.[0]?.text).toBe('hello')
  })

  it('accepts a transcript of pure silence', () => {
    // A quiet recording legitimately produces no segments; that is not an error.
    const parsed = parseTranscript({ ...DOCUMENT, segments: [] })

    expect(parsed).not.toBeNull()
    expect(parsed?.segments).toEqual([])
  })

  it('refuses a document it cannot trust', () => {
    expect(parseTranscript(null)).toBeNull()
    expect(parseTranscript('a string')).toBeNull()
    expect(parseTranscript({ segments: [] })).toBeNull() // no duration
    expect(parseTranscript({ durationSec: 10 })).toBeNull() // no segments array
  })

  it('fills in a missing version and model rather than failing', () => {
    const parsed = parseTranscript({ durationSec: 1, segments: [] })

    expect(parsed?.version).toBe(TRANSCRIPT_VERSION)
    expect(parsed?.model).toBe('unknown')
    expect(parsed?.language).toBeNull()
  })
})

describe('parseTranscriptJson', () => {
  it('parses the bytes of a downloaded transcript', () => {
    expect(parseTranscriptJson(JSON.stringify(DOCUMENT))?.segments).toHaveLength(2)
  })

  it('returns null for bytes that are not a transcript', () => {
    // A truncated download or an error page: the caller reports it, not throws.
    expect(parseTranscriptJson('{"segments":')).toBeNull()
    expect(parseTranscriptJson('<html>502</html>')).toBeNull()
  })
})

describe('transcriptText', () => {
  it('joins the segments into readable prose', () => {
    expect(transcriptText(parseTranscript(DOCUMENT)!)).toBe(
      "Let's open the settings panel. Choose a background colour.",
    )
  })

  it('ignores empty segments', () => {
    const parsed = parseTranscript({
      durationSec: 2,
      segments: [
        { start: 0, end: 1, text: '   ' },
        { start: 1, end: 2, text: 'kept' },
      ],
    })

    expect(transcriptText(parsed!)).toBe('kept')
  })
})
