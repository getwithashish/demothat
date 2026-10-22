// The audio tracks of a recording, and what each one is.
//
// A recording has up to two audio sources — the microphone and the system audio —
// and the mux keeps them as separate, named streams (see `build-mux-args.ts`).
// This module turns the file's streams into the list the editor works with, and
// decides what an unnamed stream is.
//
// The answer to "what is this stream?" is the name the mux wrote, not the stream
// index. An index is only meaningful relative to the sources that existed at the
// time: a recording made with a mic and no system audio has one stream, at index
// 0, and it is the microphone — the same index a system-audio-only recording uses
// for the system audio. Reading the index alone would label one of them wrong.

import type { AudioStreamInfo } from '../lib/audio-info'
import { probeAudioStreams } from '../lib/audio-info'

/** What an audio stream is. `mixed` is a recording from before the split. */
export type AudioTrackKind = 'mic' | 'system' | 'mixed'

export interface AudioTrackManifestEntry {
  /** The stream's position among the audio streams: `a:0`, `a:1`. `-map` uses this. */
  index: number
  kind: AudioTrackKind
  /** The name as it stands in the file, or null when it has none. */
  name: string | null
  codec: string | null
  channels: number | null
  sampleRate: number | null
}

/** The names the recorder's mux writes into a track. */
export const TRACK_NAME_MIC = 'mic'
export const TRACK_NAME_SYSTEM = 'system'

/**
 * What a stream is, from the name in the file.
 *
 * An unnamed stream is `mixed`, not `mic`: a recording made before the sources
 * were separated has one stream carrying both, and calling it the microphone would
 * claim a separation that does not exist. The distinction matters downstream — the
 * editor labels a mixed track differently and does not offer to mute a source it
 * cannot isolate.
 */
export function trackKindFromName(name: string | null | undefined): AudioTrackKind {
  const normalized = (name ?? '').trim().toLowerCase()
  if (normalized === TRACK_NAME_MIC) return 'mic'
  if (normalized === TRACK_NAME_SYSTEM) return 'system'
  return 'mixed'
}

/** The manifest entries for a file's audio streams, in file order. */
export function toTrackManifest(streams: AudioStreamInfo[]): AudioTrackManifestEntry[] {
  return streams.map((stream) => ({
    index: stream.audioIndex,
    kind: trackKindFromName(stream.handlerName),
    name: stream.handlerName,
    codec: stream.codec,
    channels: stream.channels,
    sampleRate: stream.sampleRate,
  }))
}

/**
 * Probe a finished recording for its audio tracks.
 *
 * Never rejects: a file FFmpeg cannot read yields an empty list, which the editor
 * treats as "no audio" — the same outcome as a recording made without any.
 */
export async function probeAudioTracks(filePath: string): Promise<AudioTrackManifestEntry[]> {
  return toTrackManifest(await probeAudioStreams(filePath))
}

/** A short human label for a track, for the timeline lane. */
export function trackLabel(kind: AudioTrackKind): string {
  if (kind === 'mic') return 'Microphone'
  if (kind === 'system') return 'System audio'
  return 'Audio'
}
