// The editor's audio tracks, and how a recording's manifest becomes them.
//
// The migration is the interesting part: projects recorded before the microphone
// and the system audio were separated have one mixed stream and a manifest that
// says nothing about sources, so it has to load as one lane rather than as none —
// and it must not be labelled "Microphone", because that is not what it is.

import { describe, expect, it } from 'vitest'
import {
  audioTracksFromManifest,
  legacyTracks,
  trackId,
  trackKindFromName,
  trackLabel,
  tracksFromManifest,
  type AudioTrackManifestEntry,
} from './audio-tracks'

const MIC: AudioTrackManifestEntry = {
  index: 0,
  kind: 'mic',
  name: 'mic',
  codec: 'aac',
  channels: 1,
  sampleRate: 44100,
}
const SYSTEM: AudioTrackManifestEntry = {
  index: 1,
  kind: 'system',
  name: 'system',
  codec: 'aac',
  channels: 2,
  sampleRate: 48000,
}

describe('trackKindFromName', () => {
  it('recognises the names the recorder writes', () => {
    expect(trackKindFromName('mic')).toBe('mic')
    expect(trackKindFromName('system')).toBe('system')
  })

  it('treats anything unrecognised as mixed, never as the microphone', () => {
    // Calling an unnamed stream the microphone would claim a separation the file
    // does not have.
    expect(trackKindFromName(null)).toBe('mixed')
    expect(trackKindFromName(undefined)).toBe('mixed')
    expect(trackKindFromName('')).toBe('mixed')
    expect(trackKindFromName('SoundHandler')).toBe('mixed')
    expect(trackKindFromName('microphone')).toBe('mixed')
  })
})

describe('tracksFromManifest', () => {
  it('starts every track at full volume and unmuted', () => {
    const tracks = tracksFromManifest([MIC, SYSTEM])

    // A recording is not an edit: an untouched track must sound as captured.
    expect(tracks.map((t) => t.volume)).toEqual([1, 1])
    expect(tracks.map((t) => t.muted)).toEqual([false, false])
  })

  it('keeps the index the export maps and labels the lane', () => {
    const tracks = tracksFromManifest([MIC, SYSTEM])

    expect(tracks.map((t) => t.index)).toEqual([0, 1])
    expect(tracks.map((t) => t.label)).toEqual(['Microphone', 'System audio'])
  })

  it('gives a track an id that depends on what it is, not on its position', () => {
    // The id is what per-track settings are stored under, so it has to survive a
    // reload — and a mic and a system track at the same index must not collide.
    expect(tracksFromManifest([MIC])[0]?.id).toBe(trackId(MIC.index, 'mic'))
    expect(tracksFromManifest([SYSTEM])[0]?.id).toBe(trackId(SYSTEM.index, 'system'))
    expect(tracksFromManifest([MIC])[0]?.id).not.toBe(tracksFromManifest([SYSTEM])[0]?.id)
  })

  it('is empty for a recording with no audio', () => {
    expect(tracksFromManifest([])).toEqual([])
  })
})

describe('legacyTracks', () => {
  it('is one mixed track when the recording has audio', () => {
    const tracks = legacyTracks(true)

    expect(tracks).toHaveLength(1)
    expect(tracks[0]?.kind).toBe('mixed')
    expect(tracks[0]?.label).toBe('Audio')
    expect(tracks[0]?.volume).toBe(1)
  })

  it('is nothing at all when the recording is silent', () => {
    expect(legacyTracks(false)).toEqual([])
  })
})

describe('audioTracksFromManifest', () => {
  it('believes a manifest that lists its tracks', () => {
    const tracks = audioTracksFromManifest({ audioTracks: [MIC, SYSTEM] }, true)

    expect(tracks.map((t) => t.kind)).toEqual(['mic', 'system'])
    expect(tracks.map((t) => t.index)).toEqual([0, 1])
  })

  it('takes an empty list as no audio, not as an unknown', () => {
    // A recording made with audio switched off says so, and that is the answer.
    expect(audioTracksFromManifest({ audioTracks: [] }, true)).toEqual([])
  })

  it('falls back to one mixed track for a manifest without the field', () => {
    const tracks = audioTracksFromManifest({ events: [] }, true)

    expect(tracks).toHaveLength(1)
    expect(tracks[0]?.kind).toBe('mixed')
  })

  it('falls back to nothing for a pre-split manifest whose recording is silent', () => {
    expect(audioTracksFromManifest({ events: [] }, false)).toEqual([])
  })

  it('falls back rather than showing nothing when the entries are unusable', () => {
    // The recording has sound; we just cannot tell what it is. Reporting no track
    // would hide audio that is really there.
    const tracks = audioTracksFromManifest({ audioTracks: [{ kind: 'mic' }, null, 'mic'] }, true)

    expect(tracks).toHaveLength(1)
    expect(tracks[0]?.kind).toBe('mixed')
  })

  it('ignores the unusable entries and keeps the good ones', () => {
    const tracks = audioTracksFromManifest({ audioTracks: [MIC, { index: 'zero' }, SYSTEM] }, true)

    expect(tracks.map((t) => t.index)).toEqual([0, 1])
    expect(tracks.map((t) => t.kind)).toEqual(['mic', 'system'])
  })

  it('accepts an unknown kind from a manifest without inventing a label', () => {
    const tracks = audioTracksFromManifest({ audioTracks: [{ index: 0, kind: 'voice' }] }, true)

    // `voice` is not a kind this build knows, so the entry is not usable and the
    // fallback applies — it does not become a track with a made-up label.
    expect(tracks.map((t) => t.kind)).toEqual(['mixed'])
  })

  it('treats a non-array field as absent', () => {
    expect(audioTracksFromManifest({ audioTracks: 'mic' }, true)).toHaveLength(1)
    expect(audioTracksFromManifest({ audioTracks: null }, true)).toHaveLength(1)
  })
})

describe('trackLabel', () => {
  it('names each kind the way the lane shows it', () => {
    expect(trackLabel('mic')).toBe('Microphone')
    expect(trackLabel('system')).toBe('System audio')
    expect(trackLabel('mixed')).toBe('Audio')
  })
})
