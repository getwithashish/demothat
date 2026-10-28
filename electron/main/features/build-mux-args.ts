// Builds FFmpeg arguments for the post-recording mux step that combines the
// screen-capture file with an optional renderer-recorded system-audio WebM.
//
// Layout:
//   input 0: screen capture (mp4) — may already contain mic audio
//   input 1: system audio (webm/opus) — optional
//
// The two audio sources are kept as **separate streams**, not mixed: the editor
// shows one lane per source, each with its own mute and volume, and the auto-speed
// pass reads them independently (a quiet mic is not the same as a quiet desktop).
// Mixing them here would destroy both, irreversibly and before the user ever sees
// the recording.
//
// Stream order and titles are part of the recording's contract with the app:
// audio stream 0 is the microphone, stream 1 is the system audio, and each carries
// a `title` tag naming it. Order alone is not enough — a platform where only one
// source exists produces a file with a single stream at index 0 — so the app reads
// the titles, and the titles are what it trusts.
//
// When only system audio is present it is mapped through aresample for drift
// correction. When neither extra audio applies, we just stream-copy.

/** The `title` tag each audio stream carries, so the app can identify it. */
export const AUDIO_TRACK_TITLES = { mic: 'mic', system: 'system' } as const

export type AudioTrackKind = keyof typeof AUDIO_TRACK_TITLES

/**
 * Name one audio stream.
 *
 * `handler_name` and not `title`, because this lands in an MP4: FFmpeg's mp4
 * muxer silently drops a stream's `title` tag and keeps `handler_name`, which is
 * the QuickTime track name and what `ffmpeg -i` shows back. Both are written — the
 * `title` costs nothing and is what a Matroska or WebM consumer would read — but
 * `handler_name` is the one that survives the container this actually uses.
 */
function trackNameArgs(index: number, kind: AudioTrackKind): string[] {
  const name = AUDIO_TRACK_TITLES[kind]
  return ['-metadata:s:a:' + String(index), 'handler_name=' + name, '-metadata:s:a:' + String(index), 'title=' + name]
}

/**
 * The `-t` bound for a mux whose regenerated audio is padded with `apad` to the
 * length of the video. Without an explicit duration, `-shortest` does not stop
 * an infinitely-padded audio stream in static FFmpeg builds, so the encode never
 * finishes. Returns [] when the duration is not known.
 */
function durationAt(sec?: number | null): string[] {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return []
  return ['-t', String(Math.round(sec * 100) / 100)]
}

export interface BuildMuxArgsOptions {
  screenInput: string
  systemAudioInput: string | undefined
  output: string
  hasMicAudio: boolean
  /** Screen video length in seconds; bounds the apad-padded audio mux. */
  durationSec?: number | null
}

export function buildMuxArgs(opts: BuildMuxArgsOptions): string[] {
  const { screenInput, systemAudioInput, output, hasMicAudio, durationSec } = opts

  // No system audio file: nothing to mux. Stream-copy to a renamed output.
  if (!systemAudioInput) {
    // A copy still accepts metadata, so the single stream is named too. It is the
    // microphone here: this path is the one where FFmpeg itself recorded the mic
    // into the screen file.
    return ['-y', '-i', screenInput, '-c', 'copy', ...(hasMicAudio ? trackNameArgs(0, 'mic') : []), output]
  }

  // Both sources: two streams, mic first. `apad` keeps each stream running to the
  // end of the video, so a source that stops early (the user stops sharing audio)
  // is silence for the rest of the recording rather than a shorter file that
  // `-shortest` would then cut the video down to.
  const filterGraph = hasMicAudio
    ? '[0:a]aresample=async=1,apad[mic];[1:a]aresample=async=1,apad[sys]'
    : '[1:a]aresample=async=1,apad[sys]'

  const maps = hasMicAudio ? ['-map', '[mic]', '-map', '[sys]'] : ['-map', '[sys]']
  const titles = hasMicAudio ? [...trackNameArgs(0, 'mic'), ...trackNameArgs(1, 'system')] : trackNameArgs(0, 'system')

  return [
    '-y',
    '-i',
    screenInput,
    '-i',
    systemAudioInput,
    '-filter_complex',
    filterGraph,
    '-map',
    '0:v',
    ...maps,
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    ...titles,
    '-shortest',
    ...durationAt(durationSec),
    output,
  ]
}

// macOS variant: the screen capture is a renderer-produced WebM (VP9 +
// optional Opus loopback audio). Optional mic audio is captured by FFmpeg
// to its own AAC/m4a file. Output is MP4 (H.264 + AAC).
//
// Layout (only inputs that exist are added):
//   input 0: screen video (webm) — has video, may have system audio
//   input 1: mic audio (m4a/aac)  — optional
//
// Video is always re-encoded VP9 → H.264. Audio strategy:
//   - webm has system audio + mic present → two streams: mic, then system
//   - webm has system audio only         → aresample, encode AAC, titled system
//   - mic only (no system audio in webm) → copy mic stream from input 1, titled mic
//   - neither                            → output has no audio track

export interface BuildMacMuxArgsOptions {
  screenWebmInput: string
  micAudioInput: string | undefined
  output: string
  webmHasSystemAudio: boolean
  /** Screen video length in seconds; bounds the apad-padded audio mux. */
  durationSec?: number | null
  /**
   * Wayland area recording: the WebM holds the whole monitor, so the selection
   * is cropped out here, in the one pass that already re-encodes the video.
   * Omitted on macOS and for full-screen Wayland recordings.
   */
  crop?: { x: number; y: number; width: number; height: number } | null
}

export function buildMacMuxArgs(opts: BuildMacMuxArgsOptions): string[] {
  const { screenWebmInput, micAudioInput, output, webmHasSystemAudio, durationSec, crop } = opts

  const args: string[] = ['-y', '-i', screenWebmInput]
  if (micAudioInput) {
    args.push('-i', micAudioInput)
  }

  // Common video encode settings — match the existing screen-capture profile.
  const videoEncode = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']

  const cropFilter = crop ? `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}` : null
  // FFmpeg refuses `-vf` alongside `-filter_complex` on one output, so when the
  // audio graph is in play the crop joins it as its own link and the video is
  // mapped from that label instead of straight off input 0.
  const videoGraph = cropFilter ? `[0:v]${cropFilter}[v]` : null
  const videoMap = cropFilter ? '[v]' : '0:v'
  const withCrop = (graph: string): string => (videoGraph ? `${graph};${videoGraph}` : graph)

  if (webmHasSystemAudio && micAudioInput) {
    // Two streams, mic first — the mirror image of buildMuxArgs, where the screen
    // file carries the mic instead. `apad` keeps each stream as long as the video
    // so a source that stops early becomes silence, not a shorter recording.
    args.push(
      '-filter_complex',
      withCrop('[1:a]aresample=async=1,apad[mic];[0:a]aresample=async=1,apad[sys]'),
      '-map',
      videoMap,
      '-map',
      '[mic]',
      '-map',
      '[sys]',
      ...videoEncode,
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      ...trackNameArgs(0, 'mic'),
      ...trackNameArgs(1, 'system'),
      '-shortest',
      ...durationAt(durationSec),
      output,
    )
    return args
  }

  if (webmHasSystemAudio) {
    args.push(
      '-filter_complex',
      withCrop('[0:a]aresample=async=1,apad[sys]'),
      '-map',
      videoMap,
      '-map',
      '[sys]',
      ...videoEncode,
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      ...trackNameArgs(0, 'system'),
      '-shortest',
      ...durationAt(durationSec),
      output,
    )
    return args
  }

  if (micAudioInput) {
    // Mic file is already AAC — copy through to avoid double-encoding.
    if (cropFilter) {
      args.push(
        '-filter_complex',
        videoGraph as string,
        '-map',
        '[v]',
        '-map',
        '1:a',
        ...videoEncode,
        '-c:a',
        'copy',
        ...trackNameArgs(0, 'mic'),
        '-shortest',
        output,
      )
      return args
    }
    args.push(
      '-map',
      '0:v',
      '-map',
      '1:a',
      ...videoEncode,
      '-c:a',
      'copy',
      ...trackNameArgs(0, 'mic'),
      '-shortest',
      output,
    )
    return args
  }

  // No audio at all — re-encode video (and crop if asked), drop audio explicitly.
  if (cropFilter) {
    args.push('-vf', cropFilter, '-map', '0:v', ...videoEncode, '-an', output)
    return args
  }
  args.push('-map', '0:v', ...videoEncode, '-an', output)
  return args
}
