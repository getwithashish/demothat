// Reading a recording's audio tracks back out of it.
//
// The name in the file is the contract: the mux writes `mic` and `system` (see
// build-mux-args.ts) and this is the other end of it. What is tested here is that
// the reader agrees with the writer, and that it refuses to guess when the file
// does not say — a recording from before the split has one unnamed stream, and
// calling that the microphone would claim a separation that does not exist.

import { describe, expect, it } from 'vitest'
import { parseAudioStreams } from '../lib/audio-info'
import { toTrackManifest, trackKindFromName, trackLabel } from './audio-tracks'

/** A two-track recording, as the bundled FFmpeg prints it. */
const TWO_TRACK_BANNER = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'rec.mp4':
  Metadata:
    major_brand     : isom
    encoder         : Lavf61.1.100
  Duration: 00:02:00.00, start: 0.000000, bitrate: 453 kb/s
  Stream #0:0[0x1](und): Video: h264 (Constrained Baseline) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080, 30 fps
      Metadata:
        handler_name    : VideoHandler
        encoder         : Lavc61.3.100 libx264
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 113 kb/s (default)
      Metadata:
        handler_name    : mic
        vendor_id       : [0][0][0][0]
  Stream #0:2[0x3](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 141 kb/s
      Metadata:
        handler_name    : system
        vendor_id       : [0][0][0][0]
At least one output file must be specified
`

/** One unnamed stream: a recording made before the sources were separated. */
const LEGACY_BANNER = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'old.mp4':
  Duration: 00:00:10.00, start: 0.000000, bitrate: 300 kb/s
  Stream #0:0[0x1](und): Video: h264 (avc1 / 0x31637661), yuv420p, 1280x720, 30 fps
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s
      Metadata:
        handler_name    : SoundHandler
At least one output file must be specified
`

const SILENT_BANNER = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'silent.mp4':
  Duration: 00:00:05.00, start: 0.000000, bitrate: 200 kb/s
  Stream #0:0[0x1](und): Video: h264 (avc1 / 0x31637661), yuv420p, 1280x720, 30 fps
At least one output file must be specified
`

describe('parseAudioStreams', () => {
  it('reads both tracks, in order, with their names', () => {
    const streams = parseAudioStreams(TWO_TRACK_BANNER)

    expect(streams).toHaveLength(2)
    expect(streams.map((s) => s.audioIndex)).toEqual([0, 1])
    expect(streams.map((s) => s.handlerName)).toEqual(['mic', 'system'])
  })

  it('reads the details of each stream, not just the first', () => {
    const streams = parseAudioStreams(TWO_TRACK_BANNER)

    // The two tracks genuinely differ in the fixture, so a parser that reported
    // the first stream twice would be caught here.
    expect(streams[0]?.sampleRate).toBe(44100)
    expect(streams[0]?.channels).toBe(1)
    expect(streams[1]?.sampleRate).toBe(48000)
    expect(streams[1]?.channels).toBe(2)
    expect(streams[0]?.codec).toBe('aac')
  })

  it('ignores the video stream', () => {
    const streams = parseAudioStreams(TWO_TRACK_BANNER)

    expect(streams.every((s) => s.codec === 'aac')).toBe(true)
    // The video's own handler_name must not be mistaken for an audio track name.
    expect(streams.map((s) => s.handlerName)).not.toContain('VideoHandler')
  })

  it('records the container index, which is what -map takes', () => {
    const streams = parseAudioStreams(TWO_TRACK_BANNER)

    expect(streams.map((s) => s.streamIndex)).toEqual([1, 2])
  })

  it('reports an unnamed stream as unnamed rather than inventing a name', () => {
    const streams = parseAudioStreams(LEGACY_BANNER)

    expect(streams).toHaveLength(1)
    // `SoundHandler` is FFmpeg's own default, not a name the recorder wrote.
    expect(trackKindFromName(streams[0]?.handlerName)).toBe('mixed')
  })

  it('finds no audio in a silent recording', () => {
    expect(parseAudioStreams(SILENT_BANNER)).toEqual([])
  })
})

describe('trackKindFromName', () => {
  it('recognises the names the mux writes', () => {
    expect(trackKindFromName('mic')).toBe('mic')
    expect(trackKindFromName('system')).toBe('system')
  })

  it('tolerates case and padding, because the tag is free text', () => {
    expect(trackKindFromName(' MIC ')).toBe('mic')
    expect(trackKindFromName('System')).toBe('system')
  })

  it('treats anything else as mixed, not as the microphone', () => {
    expect(trackKindFromName(null)).toBe('mixed')
    expect(trackKindFromName(undefined)).toBe('mixed')
    expect(trackKindFromName('')).toBe('mixed')
    expect(trackKindFromName('SoundHandler')).toBe('mixed')
    expect(trackKindFromName('mic 2')).toBe('mixed')
  })
})

describe('toTrackManifest', () => {
  it('carries the index, the kind and the details through', () => {
    const manifest = toTrackManifest(parseAudioStreams(TWO_TRACK_BANNER))

    expect(manifest).toEqual([
      { index: 0, kind: 'mic', name: 'mic', codec: 'aac', channels: 1, sampleRate: 44100 },
      { index: 1, kind: 'system', name: 'system', codec: 'aac', channels: 2, sampleRate: 48000 },
    ])
  })

  it('is empty for a recording with no audio', () => {
    expect(toTrackManifest(parseAudioStreams(SILENT_BANNER))).toEqual([])
  })
})

describe('trackLabel', () => {
  it('names each kind the way the lane shows it', () => {
    expect(trackLabel('mic')).toBe('Microphone')
    expect(trackLabel('system')).toBe('System audio')
    // Not "Mixed audio": a pre-split recording is just "Audio", which is all it is.
    expect(trackLabel('mixed')).toBe('Audio')
  })
})
