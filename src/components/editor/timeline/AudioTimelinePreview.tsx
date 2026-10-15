import { useEffect } from 'react'
import { useEditorStore } from '../../../store/editorStore'

const mediaUrl = (filePath: string) => `media://${encodeURI(filePath).replace(/#/g, '%23').replace(/\?/g, '%3F')}`

/** Keeps timeline audio synchronized with the editor playhead. Export uses the same clip settings in FFmpeg. */
export function AudioTimelinePreview() {
  useEffect(() => {
    const audioById = new Map<string, HTMLAudioElement>()
    let previousTime = 0
    let clickContext: AudioContext | null = null

    const tick = () => {
      const state = useEditorStore.getState()
      const musicClips = state.audioClips.filter((clip) => clip.kind !== 'click')
      const clickClips = state.audioClips.filter((clip) => clip.kind === 'click')
      const liveClips = new Set(musicClips.map((clip) => clip.id))

      for (const [id, audio] of audioById) {
        if (!liveClips.has(id)) {
          audio.pause()
          audio.removeAttribute('src')
          audio.load()
          audioById.delete(id)
        }
      }

      for (const clip of musicClips) {
        let audio = audioById.get(clip.id)
        if (!audio) {
          audio = new Audio(mediaUrl(clip.filePath))
          audio.preload = 'auto'
          audioById.set(clip.id, audio)
        }
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
          audio.volume = Math.max(0, Math.min(1, clip.volume * fadeInGain * fadeOutGain))
          if (audio.paused) void audio.play().catch(() => undefined)
        } else if (!audio.paused) {
          audio.pause()
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
          if (state.mouseClickSoundPath && clickVolume > 0) {
            const clickAudio = new Audio(mediaUrl(state.mouseClickSoundPath))
            clickAudio.volume = clickVolume
            clickAudio.currentTime = 0
            void clickAudio.play().catch(() => undefined)
            window.setTimeout(() => {
              clickAudio.pause()
              clickAudio.removeAttribute('src')
            }, 500)
          } else if (clickVolume > 0) {
            clickContext ??= new AudioContext()
            const oscillator = clickContext.createOscillator()
            const gain = clickContext.createGain()
            oscillator.type = 'sine'
            oscillator.frequency.setValueAtTime(1350, clickContext.currentTime)
            oscillator.frequency.exponentialRampToValueAtTime(720, clickContext.currentTime + 0.025)
            gain.gain.setValueAtTime(Math.max(0.01, clickVolume * 0.24), clickContext.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.001, clickContext.currentTime + 0.035)
            oscillator.connect(gain)
            gain.connect(clickContext.destination)
            oscillator.start()
            oscillator.stop(clickContext.currentTime + 0.04)
          }
        }
      }
      previousTime = state.currentTime
    }

    const timer = window.setInterval(tick, 80)
    return () => {
      window.clearInterval(timer)
      for (const audio of audioById.values()) {
        audio.pause()
        audio.removeAttribute('src')
      }
      clickContext?.close().catch(() => undefined)
    }
  }, [])

  return null
}
