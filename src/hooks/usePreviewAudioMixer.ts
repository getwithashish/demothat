// The preview's audio, wired to the editor.
//
// The mixer (see `preview-audio-mixer.ts`) knows how to hold the tracks in step and
// how to mix them; this knows when to. It owns the lifecycle — extract the tracks
// once per recording, build the graph, follow the transport, tear it all down — and
// it is the only place that decides the video element must stop playing its own
// audio while the mixer is running.
//
// That last point is not a detail: the recording's file holds both tracks, so the
// video element plays one of them by default. Left alone, the microphone would be
// heard twice — once from the element and once from the mixer's own copy of it.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { PreviewAudioMixer, type MediaLike, type PreviewTrackSource } from '../lib/preview-audio-mixer'

export interface UsePreviewAudioMixerOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>
  /** The editor's transport state; the mixer follows it. */
  isPlaying: boolean
}

export interface PreviewAudioState {
  /**
   * True when the mixer is carrying the recording's audio.
   *
   * While it is, the video element must be muted or the first track is heard twice.
   */
  mixerOwnsAudio: boolean
}

/** An `HTMLAudioElement` is a `MediaLike`; the cast lives here rather than at each use. */
const asMedia = (element: HTMLAudioElement): MediaLike => element as unknown as MediaLike

export function usePreviewAudioMixer({ videoRef, isPlaying }: UsePreviewAudioMixerOptions): PreviewAudioState {
  const audioTracks = useEditorStore((state) => state.audioTracks)
  const videoPath = useEditorStore((state) => state.videoPath)
  const volume = useEditorStore((state) => state.volume)
  const isMuted = useEditorStore((state) => state.isMuted)

  const [sources, setSources] = useState<PreviewTrackSource[]>([])
  const mixerRef = useRef<PreviewAudioMixer | null>(null)
  /** Which extraction attempt is current, so a slow one cannot overwrite a newer. */
  const extractToken = useRef(0)

  /**
   * Which tracks the recording has — deliberately not their volume or mute.
   *
   * The extraction depends on this and not on `audioTracks`: dragging a volume
   * slider produces a new track array every frame, and extracting the recording
   * again on each of those would be an IPC round trip per frame of the drag.
   */
  const trackSetKey = useMemo(() => audioTracks.map((track) => track.id).join('|'), [audioTracks])

  const mixerOwnsAudio = sources.length > 0

  // --- Extract the tracks, once per recording ------------------------------------
  useEffect(() => {
    const token = ++extractToken.current
    if (!videoPath || trackSetKey.length === 0) {
      setSources([])
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const result = await window.electronAPI.extractAudioTracks({
          filePath: videoPath,
          tracks: useEditorStore.getState().audioTracks,
        })
        // A newer recording has been loaded since this started; its result wins.
        if (cancelled || token !== extractToken.current) return
        // Volume and mute come from the store, which the effect below applies the
        // moment the graph exists — so these start neutral rather than stale.
        setSources(result.tracks.map((track) => ({ id: track.id, url: track.url, volume: 1, muted: false })))
      } catch (error) {
        console.warn('[PreviewAudio] Could not extract the recording’s tracks:', error)
        if (!cancelled && token === extractToken.current) setSources([])
      }
    })()

    return () => {
      cancelled = true
    }
  }, [videoPath, trackSetKey])

  // --- Build the graph when there are tracks to play and a video to follow -------
  useEffect(() => {
    if (sources.length === 0) return
    const video = videoRef.current
    if (!video) return

    let context: AudioContext
    let mixer: PreviewAudioMixer
    try {
      context = new AudioContext()
      mixer = new PreviewAudioMixer({
        context,
        video: video as unknown as MediaLike,
        createElement: (url) => {
          const element = new Audio(url)
          element.preload = 'auto'
          return asMedia(element)
        },
      })
      mixer.attach(sources)
    } catch (error) {
      // Silence would be the worst outcome: falling back to the element's own audio
      // gives the user a recording they can hear, just without per-track control.
      console.warn('[PreviewAudio] Could not build the preview mix; using the element’s audio:', error)
      setSources([])
      return
    }
    mixerRef.current = mixer

    return () => {
      mixer.dispose()
      mixerRef.current = null
      void context.close().catch(() => undefined)
    }
  }, [sources, videoRef])

  // --- Follow the transport -----------------------------------------------------
  //
  // Idempotent per mixer: the effect can run twice for one transition (the graph
  // arriving and playback starting in the same commit), and `play()` twice on an
  // element is a stutter, not a no-op, in some browsers. A *new* mixer while
  // already playing still has to be started, which is why the guard is keyed on the
  // mixer instance and not just on `isPlaying`.
  const transportRef = useRef<{ mixer: PreviewAudioMixer | null; playing: boolean }>({ mixer: null, playing: false })
  useEffect(() => {
    const mixer = mixerRef.current
    if (!mixer) return
    const last = transportRef.current
    if (last.mixer === mixer && last.playing === isPlaying) return
    transportRef.current = { mixer, playing: isPlaying }

    if (isPlaying) {
      // play() re-seeks first, so a track never starts from where it was left while
      // the picture moved on without it.
      void mixer.play().catch((error) => console.warn('[PreviewAudio] Could not start the mix:', error))
    } else {
      mixer.pause()
    }
  }, [isPlaying, mixerOwnsAudio])

  // --- Keep the tracks in step while playing ------------------------------------
  useEffect(() => {
    if (!isPlaying || !mixerOwnsAudio) return
    let frame = 0
    const step = () => {
      mixerRef.current?.tick()
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [isPlaying, mixerOwnsAudio])

  // --- Volume, mute and per-track settings --------------------------------------
  useEffect(() => {
    const mixer = mixerRef.current
    if (!mixer) return
    mixer.setMaster(volume, isMuted)
    for (const track of audioTracks) {
      mixer.setTrack(track.id, { volume: track.volume, muted: track.muted })
    }
  }, [volume, isMuted, audioTracks, mixerOwnsAudio])

  return { mixerOwnsAudio }
}
