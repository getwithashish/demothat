// The preview's audio mixer: the microphone and the system audio, each with its
// own volume and mute, playing in step with the video.
//
// The shape of the problem: an HTML `<video>` element plays exactly one audio
// track, so per-track control means separate elements for the tracks and a Web
// Audio graph to mix them. That leaves the one thing that can actually go wrong —
// the separate elements and the video element are independent clocks, and nothing
// makes them agree. They are all started from the same seek and they all drift.
//
// The policy here, in order of how much it matters:
//
//  1. Every transport change is a re-seek of every track, not a play/pause. A
//     paused audio element resumed after the video has moved is wrong by however
//     far the video moved, and it never catches up on its own.
//  2. During playback, each track is checked against the video and re-seeked when
//     it is more than `driftToleranceSec` out. The threshold is small on purpose:
//     audio arriving early is what people notice, and it is noticeable from about
//     40 ms. Re-seeking on every tick instead would be audible as a stutter, so
//     the correction only happens when it would otherwise be heard.
//  3. A track's rate follows the video's rate, so a speed change moves the audio
//     with the picture rather than leaving it behind.
//
// The element and context types are interfaces rather than the DOM ones so the
// policy can be tested without a screen — which matters, because this is the part
// that cannot be verified by looking at it.

/** The parts of an `HTMLMediaElement` the mixer uses. */
export interface MediaLike {
  currentTime: number
  playbackRate: number
  paused: boolean
  duration: number
  play(): Promise<void> | void
  pause(): void
}

/** One audio source in the preview: a track of the recording, and its file. */
export interface PreviewTrackSource {
  id: string
  /** Where the extracted track file is readable from (a `media://` URL in the app). */
  url: string
  volume: number
  muted: boolean
}

export interface MixerOptions {
  context: AudioContext
  /** The video element the tracks must stay in step with. */
  video: MediaLike
  /** Builds a playable element for a track URL — an `<audio>` element in the app. */
  createElement: (url: string) => MediaLike
  /**
   * Where the mix goes. Defaults to the context's destination.
   *
   * A tap, for measuring the mix rather than hearing it: the graph is otherwise
   * impossible to observe, and "the two tracks are really mixed with independent
   * gain" is not something that can be checked by reading the code.
   */
  output?: AudioNode
  /**
   * How far a track may drift before it is pulled back, in seconds.
   *
   * 40 ms: audio leading the picture is perceptible from about there, and below it
   * the correction is more noticeable than the drift.
   */
  driftToleranceSec?: number
}

export const DEFAULT_DRIFT_TOLERANCE_SEC = 0.04

interface AttachedTrack {
  /** A copy: the caller's object is the store's, and mutating it would edit state
   *  outside a `set()` — the exact aliasing bug that makes React updates vanish. */
  source: PreviewTrackSource
  element: MediaLike
  gain: GainNode
}

/**
 * The preview's mix of the recording's audio tracks.
 *
 * Owns its elements: `dispose()` stops them and tears the graph down, which the
 * caller must do when the recording changes or the editor unmounts — a
 * MediaElementAudioSourceNode holds its element forever.
 */
export class PreviewAudioMixer {
  private readonly context: AudioContext
  private readonly video: MediaLike
  private readonly createElement: (url: string) => MediaLike
  private readonly tolerance: number
  private readonly master: GainNode
  private tracks: AttachedTrack[] = []
  private disposed = false
  private masterVolume = 1
  private masterMuted = false

  constructor(options: MixerOptions) {
    this.context = options.context
    this.video = options.video
    this.createElement = options.createElement
    this.tolerance = options.driftToleranceSec ?? DEFAULT_DRIFT_TOLERANCE_SEC
    this.master = this.context.createGain()
    this.master.gain.value = 1
    this.master.connect(options.output ?? this.context.destination)
  }

  /** Replace the set of tracks. Existing elements are torn down first. */
  attach(sources: PreviewTrackSource[]): void {
    if (this.disposed) return
    this.teardownTracks()

    this.tracks = sources.map((source) => {
      const element = this.createElement(source.url)
      element.currentTime = this.video.currentTime
      element.playbackRate = this.video.playbackRate

      const gain = this.context.createGain()
      this.applyGain(gain, source)
      // A MediaElementAudioSourceNode routes the element's audio into the graph and
      // out of the default output, which is what stops a track playing twice.
      this.context.createMediaElementSource(element as unknown as HTMLMediaElement).connect(gain)
      gain.connect(this.master)

      // Copied, not referenced: these objects come from the store, and the mixer
      // changing one would be a state edit outside a `set()`.
      return { source: { ...source }, element, gain }
    })

    this.applyMaster()
  }

  /** Seek every track to where the video is. Call on any transport change. */
  seek(time: number = this.video.currentTime): void {
    for (const track of this.tracks) {
      // A track that has not been seeked yet reports 0; setting it to the video's
      // time is what stops a track starting at the beginning of the recording
      // while the picture is elsewhere.
      track.element.currentTime = time
      track.element.playbackRate = this.video.playbackRate
    }
  }

  async play(): Promise<void> {
    if (this.disposed) return
    if (this.context.state === 'suspended') await this.context.resume()
    // Always from a known position: the elements have been sitting still while the
    // video was not.
    this.seek()
    await Promise.all(this.tracks.map((track) => track.element.play()))
  }

  pause(): void {
    for (const track of this.tracks) track.element.pause()
  }

  /**
   * Keep the tracks in step. Call while playing, on every frame or timer tick.
   *
   * Returns the ids of the tracks that were corrected, which is what a test asserts
   * on — and what a diagnostic could log.
   */
  tick(): string[] {
    if (this.disposed || this.video.paused) return []

    const expected = this.video.currentTime
    const corrected: string[] = []

    for (const track of this.tracks) {
      if (track.element.playbackRate !== this.video.playbackRate) {
        track.element.playbackRate = this.video.playbackRate
      }
      if (Math.abs(track.element.currentTime - expected) > this.tolerance) {
        track.element.currentTime = expected
        corrected.push(track.source.id)
      }
    }

    return corrected
  }

  /** Change one track's volume or mute. */
  setTrack(id: string, patch: { volume?: number; muted?: boolean }): void {
    const track = this.tracks.find((candidate) => candidate.source.id === id)
    if (!track) return
    if (patch.volume !== undefined) track.source.volume = clamp01(patch.volume)
    if (patch.muted !== undefined) track.source.muted = patch.muted
    this.applyGain(track.gain, track.source)
  }

  /** The master control, which the recording's overall volume and mute drive. */
  setMaster(volume: number, muted: boolean): void {
    this.masterVolume = clamp01(volume)
    this.masterMuted = muted
    this.applyMaster()
  }

  /** The gain actually applied to a track, after its own mute and the master's. */
  effectiveGain(id: string): number {
    const track = this.tracks.find((candidate) => candidate.source.id === id)
    if (!track) return 0
    return this.gainValue(track.source)
  }

  trackIds(): string[] {
    return this.tracks.map((track) => track.source.id)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.teardownTracks()
    this.master.disconnect()
  }

  private gainValue(source: PreviewTrackSource): number {
    if (source.muted) return 0
    return clamp01(source.volume)
  }

  private applyGain(gain: GainNode, source: PreviewTrackSource): void {
    gain.gain.value = this.gainValue(source)
  }

  private applyMaster(): void {
    this.master.gain.value = this.masterMuted ? 0 : this.masterVolume
  }

  private teardownTracks(): void {
    for (const track of this.tracks) {
      try {
        track.element.pause()
      } catch {
        // An element that is already stopped or was never playable.
      }
      try {
        track.gain.disconnect()
      } catch {
        // Already disconnected.
      }
    }
    this.tracks = []
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
