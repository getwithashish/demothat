import log from 'electron-log/renderer'

export const activeSeeks = new WeakMap<HTMLVideoElement, Promise<void>>()

export const loadVideo = (videoElement: HTMLVideoElement, source: string, path: string): Promise<void> =>
  new Promise((resolve, reject) => {
    if (videoElement.readyState >= 2) {
      log.info(`[RendererPage] ${source} already ready (readyState: ${videoElement.readyState}).`)
      resolve()
      return
    }

    const cleanup = () => {
      clearTimeout(timeout)
      videoElement.removeEventListener('loadeddata', onReady)
      videoElement.removeEventListener('canplay', onReady)
      videoElement.removeEventListener('error', onError)
    }

    const onReady = () => {
      cleanup()
      log.info(`[RendererPage] ${source} loaded (readyState: ${videoElement.readyState}).`)
      resolve()
    }

    const onError = (e: Event) => {
      cleanup()
      reject(new Error(`Failed to load ${source}: ${e}`))
    }

    const timeout = setTimeout(() => {
      cleanup()
      log.warn(
        `[RendererPage] Timed out waiting for ${source} loadeddata/canplay (readyState: ${videoElement.readyState}). Proceeding anyway.`,
      )
      resolve()
    }, 10000)

    videoElement.addEventListener('loadeddata', onReady, { once: true })
    videoElement.addEventListener('canplay', onReady, { once: true })
    videoElement.addEventListener('error', onError, { once: true })

    videoElement.src = `media://${path}`
    videoElement.muted = true
    videoElement.preload = 'auto'
    videoElement.load()

    if (videoElement.readyState >= 2) {
      cleanup()
      resolve()
    }
  })

export const seekVideo = (videoElement: HTMLVideoElement, targetTime: number, timeoutMs = 5000): Promise<void> => {
  const maxDuration =
    Number.isFinite(videoElement.duration) && videoElement.duration > 0 ? videoElement.duration : Infinity
  const clampedTarget = Math.max(0, Math.min(targetTime, maxDuration))

  // Fast-path: if already settled at target time with no active seek, resolve immediately
  if (
    !videoElement.seeking &&
    !activeSeeks.has(videoElement) &&
    Math.abs(videoElement.currentTime - clampedTarget) < 0.001
  ) {
    return Promise.resolve()
  }

  const performSeek = async (): Promise<void> => {
    // If the video element is actively seeking, wait for it to settle before changing currentTime
    if (videoElement.seeking) {
      await new Promise<void>((r) => {
        const onSettled = () => {
          videoElement.removeEventListener('seeked', onSettled)
          videoElement.removeEventListener('error', onSettled)
          r()
        }
        videoElement.addEventListener('seeked', onSettled, { once: true })
        videoElement.addEventListener('error', onSettled, { once: true })
        setTimeout(onSettled, 1000)
      })
    }

    // If already at target time and not seeking, no-op
    if (Math.abs(videoElement.currentTime - clampedTarget) < 0.001 && !videoElement.seeking) {
      return
    }

    return new Promise<void>((resolve) => {
      let timeout: NodeJS.Timeout | null = null
      let done = false

      const onDone = (isTimeout = false) => {
        if (done) return
        done = true
        if (timeout) {
          clearTimeout(timeout)
          timeout = null
        }
        videoElement.removeEventListener('seeked', onSeeked)
        videoElement.removeEventListener('error', onError)
        if (isTimeout) {
          log.warn(
            `[RendererPage] Seek timed out after ${timeoutMs}ms (target: ${clampedTarget.toFixed(3)}s, current: ${videoElement.currentTime.toFixed(3)}s, seeking: ${videoElement.seeking})`,
          )
        }
        resolve()
      }

      const onSeeked = () => onDone(false)
      const onError = () => onDone(false)

      timeout = setTimeout(() => onDone(true), timeoutMs)
      videoElement.addEventListener('seeked', onSeeked, { once: true })
      videoElement.addEventListener('error', onError, { once: true })

      const prevTime = videoElement.currentTime
      videoElement.currentTime = clampedTarget
      if (videoElement.currentTime === prevTime && !videoElement.seeking) {
        onDone(false)
      }
    })
  }

  // If a seek is already active on this video element, await it before starting a new one
  const prevSeek = activeSeeks.get(videoElement)
  const currentSeek = (prevSeek ? prevSeek.catch(() => {}).then(performSeek) : performSeek()).finally(() => {
    if (activeSeeks.get(videoElement) === currentSeek) {
      activeSeeks.delete(videoElement)
    }
  })

  activeSeeks.set(videoElement, currentSeek)
  return currentSeek
}
