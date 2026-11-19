import { useEffect } from 'react'
import { useEditorStore } from '../../../store/editorStore'
import { DEFAULT_CLICK_SOUND } from '../../../../shared/click-sound'
import { mediaUrl } from '../../../../shared/media-url'
import { virtualStudioStreamer } from '../../../features/virtual-studio'

interface ClipAudioEntry {
  audio: HTMLAudioElement
  gainNode: GainNode | null
  filePath: string
}

// In-memory cache for decoded click sound AudioBuffers for instant 0ms playback
const clickBufferCache = new Map<string, AudioBuffer>()
const pendingClickLoads = new Set<string>()

function preloadClickSound(ctx: AudioContext | null, sourcePath: string): void {
  if (!ctx || typeof fetch !== 'function' || typeof ctx.decodeAudioData !== 'function') return
  const url = mediaUrl(sourcePath)
  if (clickBufferCache.has(url) || pendingClickLoads.has(url)) return
  pendingClickLoads.add(url)
  void fetch(url)
    .then((res) => res.arrayBuffer())
    .then((buf) => ctx.decodeAudioData(buf))
    .then((decoded) => {
      clickBufferCache.set(url, decoded)
    })
    .catch(() => undefined)
    .finally(() => {
      pendingClickLoads.delete(url)
    })
}

function playClickSound(ctx: AudioContext, demoBus: GainNode, sourcePath: string, volume: number): void {
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {})
  }
  const url = mediaUrl(sourcePath)
  const cachedBuffer = clickBufferCache.get(url)

  if (cachedBuffer && typeof ctx.createBufferSource === 'function') {
    try {
      const source = ctx.createBufferSource()
      source.buffer = cachedBuffer
      const gain = ctx.createGain()
      gain.gain.value = volume
      source.connect(gain)
      gain.connect(demoBus)
      source.onended = () => {
        try {
          source.disconnect()
          gain.disconnect()
        } catch {
          // Ignore
        }
      }
      source.start(0)
      return
    } catch (err) {
      console.warn('[AudioTimelinePreview] Error playing click via AudioBufferSourceNode:', err)
    }
  }

  // Pre-load audio buffer for subsequent zero-latency clicks
  preloadClickSound(ctx, sourcePath)

  // Fallback: route an Audio element through Web Audio GainNode into demoBus
  try {
    const clickAudio = new Audio(url)
    clickAudio.crossOrigin = 'anonymous'
    clickAudio.preload = 'auto'
    if (typeof ctx.createGain === 'function') {
      const sourceNode = virtualStudioStreamer.createMediaElementSource(clickAudio)
      const gainNode = ctx.createGain()
      gainNode.gain.value = volume
      sourceNode.connect(gainNode)
      gainNode.connect(demoBus)
      void clickAudio.play().catch(() => undefined)
      window.setTimeout(() => {
        try {
          sourceNode.disconnect(gainNode)
          gainNode.disconnect()
        } catch {
          // Ignore
        }
        clickAudio.pause()
        clickAudio.removeAttribute('src')
      }, 500)
    } else {
      clickAudio.volume = volume
      void clickAudio.play().catch(() => undefined)
    }
  } catch (err) {
    console.warn('[AudioTimelinePreview] Error playing fallback click sound:', err)
  }
}

/** Keeps timeline audio synchronized with the editor playhead and routes into Virtual Studio demo bus. */
export function AudioTimelinePreview() {
  useEffect(() => {
    const audioById = new Map<string, ClipAudioEntry>()
    let previousTime = -0.001

    const ctx = virtualStudioStreamer.getAudioContext()
    const demoBus = virtualStudioStreamer.getDemoAudioBus()

    // Upfront preload of default click sound
    const initialClickSound = useEditorStore.getState().mouseClickSoundPath || DEFAULT_CLICK_SOUND
    preloadClickSound(ctx, initialClickSound)

    const tick = () => {
      const state = useEditorStore.getState()
      if (state.isPlaying && ctx?.state === 'suspended') {
        void ctx.resume().catch(() => {})
      }
      const musicClips = state.audioClips.filter((clip) => clip.kind !== 'click')
      const clickClips = state.audioClips.filter((clip) => clip.kind === 'click')
      const liveClips = new Set(musicClips.map((clip) => clip.id))

      for (const [id, entry] of audioById) {
        if (!liveClips.has(id)) {
          entry.audio.pause()
          entry.audio.removeAttribute('src')
          entry.audio.load()
          if (entry.gainNode) {
            try {
              entry.gainNode.disconnect()
            } catch {
              // Ignore
            }
          }
          audioById.delete(id)
        }
      }

      for (const clip of musicClips) {
        let entry = audioById.get(clip.id)
        if (entry && entry.filePath !== clip.filePath) {
          entry.audio.pause()
          entry.audio.removeAttribute('src')
          if (entry.gainNode) {
            try {
              entry.gainNode.disconnect()
            } catch {
              // Ignore
            }
          }
          audioById.delete(clip.id)
          entry = undefined
        }

        if (!entry) {
          const audio = new Audio(mediaUrl(clip.filePath))
          audio.crossOrigin = 'anonymous'
          audio.preload = 'auto'
          let gainNode: GainNode | null = null
          if (ctx && typeof ctx.createGain === 'function' && demoBus) {
            try {
              const sourceNode = virtualStudioStreamer.createMediaElementSource(audio)
              gainNode = ctx.createGain()
              gainNode.gain.value = 0
              sourceNode.connect(gainNode)
              gainNode.connect(demoBus)
            } catch (err) {
              console.warn('[AudioTimelinePreview] Error creating Web Audio source for clip:', err)
            }
          }
          entry = { audio, gainNode, filePath: clip.filePath }
          audioById.set(clip.id, entry)
        } else if (!entry.gainNode && ctx && typeof ctx.createGain === 'function' && demoBus) {
          try {
            const sourceNode = virtualStudioStreamer.createMediaElementSource(entry.audio)
            entry.gainNode = ctx.createGain()
            entry.gainNode.gain.value = 0
            sourceNode.connect(entry.gainNode)
            entry.gainNode.connect(demoBus)
          } catch (err) {
            console.warn('[AudioTimelinePreview] Error creating Web Audio source for clip:', err)
          }
        }

        const { audio, gainNode } = entry
        const elapsed = state.currentTime - clip.startTime
        const speed = Math.max(0.5, Math.min(2, Number(clip.speed) || 1))
        const playableSourceDuration = Math.max(0, clip.sourceDuration - clip.sourceStart)
        const sourceElapsed = elapsed * speed
        const active =
          state.isPlaying &&
          elapsed >= 0 &&
          elapsed < clip.duration &&
          (clip.loop || sourceElapsed < playableSourceDuration)

        if (active) {
          const loopSourceDuration = Math.min(playableSourceDuration, clip.duration * speed)
          const sourceTime =
            clip.sourceStart +
            (clip.loop && loopSourceDuration > 0 ? sourceElapsed % loopSourceDuration : sourceElapsed)
          if (Math.abs(audio.currentTime - sourceTime) > 0.35) audio.currentTime = sourceTime
          audio.playbackRate = speed
          const fadeInGain = clip.fadeIn > 0 ? Math.min(1, elapsed / clip.fadeIn) : 1
          const fadeOutGain = clip.fadeOut > 0 ? Math.min(1, (clip.duration - elapsed) / clip.fadeOut) : 1
          const clipVolume = Math.max(0, Math.min(1, clip.volume * fadeInGain * fadeOutGain))
          const masterVolume = state.isMuted ? 0 : Math.max(0, Math.min(1, state.volume))
          const effectiveGain = clipVolume * masterVolume

          if (gainNode) {
            if (typeof gainNode.gain.setTargetAtTime === 'function' && ctx) {
              gainNode.gain.setTargetAtTime(effectiveGain, ctx.currentTime, 0.015)
            }
            gainNode.gain.value = effectiveGain
          } else {
            audio.volume = effectiveGain
          }

          if (audio.paused) void audio.play().catch(() => undefined)
        } else {
          if (gainNode) {
            if (typeof gainNode.gain.setTargetAtTime === 'function' && ctx) {
              gainNode.gain.setTargetAtTime(0, ctx.currentTime, 0.015)
            }
            gainNode.gain.value = 0
          }
          if (!audio.paused) {
            audio.pause()
          }
        }
      }

      if (
        state.mouseClickSoundsEnabled &&
        state.isPlaying &&
        state.currentTime >= previousTime &&
        state.currentTime - previousTime <= 0.5
      ) {
        const clicks = clickClips.filter((clip) => clip.startTime > previousTime && clip.startTime <= state.currentTime)
        for (const click of clicks) {
          const clickVolume = Math.max(0, Math.min(1, state.mouseClickSoundVolume * click.volume))
          const masterVolume = state.isMuted ? 0 : Math.max(0, Math.min(1, state.volume))
          const effectiveClickGain = clickVolume * masterVolume
          if (effectiveClickGain <= 0) continue

          const source = state.mouseClickSoundPath || DEFAULT_CLICK_SOUND
          if (ctx && demoBus) {
            playClickSound(ctx, demoBus, source, effectiveClickGain)
          }
        }
      }
      previousTime = state.currentTime
    }

    const timer = window.setInterval(tick, 80)
    return () => {
      window.clearInterval(timer)
      for (const entry of audioById.values()) {
        entry.audio.pause()
        entry.audio.removeAttribute('src')
        if (entry.gainNode) {
          try {
            entry.gainNode.disconnect()
          } catch {
            // Ignore
          }
        }
      }
      audioById.clear()
    }
  }, [])

  return null
}
