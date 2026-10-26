// The audio tracks of a recording, and what each one is.
//
// A recording has up to two audio sources — the microphone and the system audio —
// and the mux keeps them as separate, named streams (see `build-mux-args.ts`).
// This module probes a finished file for those streams and turns them into the
// manifest entries the editor builds its lanes from.
//
// The vocabulary lives in `shared/audio-tracks.ts`, because the editor needs the
// same kind and label logic the recorder does, and two copies of it would drift.

import type { AudioStreamInfo } from '../lib/audio-info'
import { probeAudioStreams } from '../lib/audio-info'
import { trackKindFromName, type AudioTrackKind, type AudioTrackManifestEntry } from '../../../shared/audio-tracks'

export { TRACK_NAME_MIC, TRACK_NAME_SYSTEM, trackKindFromName, trackLabel } from '../../../shared/audio-tracks'
export type { AudioTrack, AudioTrackKind, AudioTrackManifestEntry } from '../../../shared/audio-tracks'

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

/** The kinds a recording can hold, for exhaustiveness checks. */
export const AUDIO_TRACK_KINDS: AudioTrackKind[] = ['mic', 'system', 'mixed']
