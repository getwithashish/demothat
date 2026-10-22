// Audio tracks: what a recording's audio sources are, and what the editor calls
// them.
//
// Two different things share this vocabulary and must not drift apart:
//
//  - a *manifest entry* is what a recording file has — an index, a kind, and the
//    stream's own details. It is written by the recorder and read back on load.
//  - an *audio track* is editor state — the same source, with the volume and mute
//    the user set, and an id that survives reordering.
//
// The kind is decided by the name the recorder's mux wrote into the stream (see
// build-mux-args.ts). An index cannot decide it: a recording with a microphone and
// no system audio has one stream at index 0 and it is the microphone, the same
// index a system-audio-only recording uses for its system audio.

/** What an audio source is. `mixed` is a recording from before the sources were split. */
export type AudioTrackKind = 'mic' | 'system' | 'mixed'

/** The names the recorder's mux writes into a track. */
export const TRACK_NAME_MIC = 'mic'
export const TRACK_NAME_SYSTEM = 'system'

/** One audio stream of a recording, as the manifest records it. */
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

/** One audio source in the editor: the manifest entry plus the user's settings. */
export interface AudioTrack {
  /** Stable across a reload, so per-track settings survive a save. */
  id: string
  kind: AudioTrackKind
  /** The `a:N` index in the recording file, which the export maps. */
  index: number
  label: string
  /** 0–1, applied to this source alone. */
  volume: number
  muted: boolean
}

/**
 * What a stream is, from the name in the file.
 *
 * Anything unrecognised is `mixed`, never `mic`: a recording made before the
 * sources were separated has one stream carrying both, and calling it the
 * microphone would claim a separation that does not exist.
 */
export function trackKindFromName(name: string | null | undefined): AudioTrackKind {
  const normalized = (name ?? '').trim().toLowerCase()
  if (normalized === TRACK_NAME_MIC) return 'mic'
  if (normalized === TRACK_NAME_SYSTEM) return 'system'
  return 'mixed'
}

/** A short human label for a track, for the timeline lane. */
export function trackLabel(kind: AudioTrackKind): string {
  if (kind === 'mic') return 'Microphone'
  if (kind === 'system') return 'System audio'
  return 'Audio'
}

/** The id a track's settings are stored under. */
export function trackId(index: number, kind: AudioTrackKind): string {
  return `audio-${kind}-${index}`
}

/**
 * The editor's tracks for a manifest.
 *
 * Every track starts at full volume and unmuted: a recording is not an edit, and
 * a track the user has never touched should sound exactly as it was captured.
 */
export function tracksFromManifest(entries: AudioTrackManifestEntry[]): AudioTrack[] {
  return entries.map((entry) => ({
    id: trackId(entry.index, entry.kind),
    kind: entry.kind,
    index: entry.index,
    label: trackLabel(entry.kind),
    volume: 1,
    muted: false,
  }))
}

/**
 * The tracks for a recording whose manifest predates this feature.
 *
 * The manifest says nothing about how many sources there were, so there is no
 * honest way to split them: one `mixed` track is what the file actually holds.
 */
export function legacyTracks(hasAudio: boolean): AudioTrack[] {
  if (!hasAudio) return []
  return [
    {
      id: trackId(0, 'mixed'),
      kind: 'mixed',
      index: 0,
      label: trackLabel('mixed'),
      volume: 1,
      muted: false,
    },
  ]
}

/**
 * Read the audio tracks out of a recording manifest.
 *
 * A manifest with an `audioTracks` array is believed, including an empty one — a
 * silent recording genuinely has no tracks. A manifest without the field is a
 * recording made before the sources were separated, and falls back to a single
 * mixed track when the recording has audio at all.
 */
export function audioTracksFromManifest(
  manifest: { audioTracks?: unknown; hasAudioTrack?: unknown },
  hasAudioStream: boolean,
): AudioTrack[] {
  if (Array.isArray(manifest.audioTracks)) {
    const entries = manifest.audioTracks.filter(isManifestEntry)
    // An array that is present but unusable is treated as absent rather than as
    // "no audio": the recording has sound, we just cannot tell what it is.
    if (entries.length > 0) return tracksFromManifest(entries)
    if (manifest.audioTracks.length === 0) return []
    return legacyTracks(hasAudioStream)
  }
  return legacyTracks(hasAudioStream)
}

function isManifestEntry(value: unknown): value is AudioTrackManifestEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  if (typeof entry.index !== 'number' || !Number.isFinite(entry.index)) return false
  return entry.kind === 'mic' || entry.kind === 'system' || entry.kind === 'mixed'
}
