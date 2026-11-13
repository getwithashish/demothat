// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeSeeks, loadVideo, seekVideo } from './video-seek'

describe('video-seek loading and seek engine', () => {
  let video: HTMLVideoElement

  beforeEach(() => {
    vi.useFakeTimers()
    video = document.createElement('video')
    Object.defineProperty(video, 'duration', { value: 10, writable: true, configurable: true })
    Object.defineProperty(video, 'currentTime', { value: 0, writable: true, configurable: true })
    Object.defineProperty(video, 'seeking', { value: false, writable: true, configurable: true })
    Object.defineProperty(video, 'readyState', { value: 0, writable: true, configurable: true })
    video.load = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    activeSeeks.delete(video)
  })

  describe('loadVideo', () => {
    it('resolves immediately when readyState is already >= 2 (HAVE_CURRENT_DATA)', async () => {
      Object.defineProperty(video, 'readyState', { value: 2 })
      let resolved = false
      loadVideo(video, 'test video', '/path/to/video.mp4').then(() => {
        resolved = true
      })
      await vi.runAllTimersAsync()
      expect(resolved).toBe(true)
    })

    it('waits for loadeddata when readyState is initially HAVE_NOTHING (0)', async () => {
      let resolved = false
      const promise = loadVideo(video, 'test video', '/path/to/video.mp4').then(() => {
        resolved = true
      })

      expect(video.src).toContain('media:///path/to/video.mp4')
      expect(video.preload).toBe('auto')
      expect(video.muted).toBe(true)
      expect(resolved).toBe(false)

      Object.defineProperty(video, 'readyState', { value: 2 })
      video.dispatchEvent(new Event('loadeddata'))
      await promise
      expect(resolved).toBe(true)
    })

    it('resolves when canplay event fires', async () => {
      let resolved = false
      const promise = loadVideo(video, 'test video', '/path/to/video.mp4').then(() => {
        resolved = true
      })

      expect(resolved).toBe(false)
      Object.defineProperty(video, 'readyState', { value: 3 })
      video.dispatchEvent(new Event('canplay'))
      await promise
      expect(resolved).toBe(true)
    })

    it('proceeds after timeout if media never fires loadeddata/canplay', async () => {
      let resolved = false
      loadVideo(video, 'test video', '/path/to/video.mp4').then(() => {
        resolved = true
      })

      expect(resolved).toBe(false)
      await vi.advanceTimersByTimeAsync(10001)
      expect(resolved).toBe(true)
    })
  })

  describe('seekVideo', () => {
    it('resolves immediately if video is already at target time and not seeking', async () => {
      video.currentTime = 5.0
      Object.defineProperty(video, 'seeking', { value: false })

      let resolved = false
      seekVideo(video, 5.0).then(() => {
        resolved = true
      })

      await Promise.resolve()
      expect(resolved).toBe(true)
    })

    it('seeks video to target time and resolves when seeked event fires', async () => {
      video.currentTime = 0.0

      let resolved = false
      const promise = seekVideo(video, 6.4).then(() => {
        resolved = true
      })

      expect(video.currentTime).toBe(6.4)
      expect(resolved).toBe(false)

      video.dispatchEvent(new Event('seeked'))
      await promise
      expect(resolved).toBe(true)
    })

    it('clamps target time between 0 and video duration', async () => {
      video.currentTime = 0.0

      const promise = seekVideo(video, 25.0)
      expect(video.currentTime).toBe(10.0) // clamped to duration 10

      video.dispatchEvent(new Event('seeked'))
      await promise
    })

    it('serializes sequential seeks on the same element so later seek awaits earlier seek', async () => {
      video.currentTime = 0.0

      let firstResolved = false
      let secondResolved = false

      const firstSeek = seekVideo(video, 2.0).then(() => {
        firstResolved = true
      })
      const secondSeek = seekVideo(video, 4.0).then(() => {
        secondResolved = true
      })

      expect(firstResolved).toBe(false)
      expect(secondResolved).toBe(false)
      expect(video.currentTime).toBe(2.0)

      // First seek completes
      video.dispatchEvent(new Event('seeked'))
      await firstSeek
      expect(firstResolved).toBe(true)

      // Allow tick for second seek to execute
      await Promise.resolve()
      expect(video.currentTime).toBe(4.0)
      expect(secondResolved).toBe(false)

      // Second seek completes
      video.dispatchEvent(new Event('seeked'))
      await secondSeek
      expect(secondResolved).toBe(true)
    })

    it('triggers watchdog safety timeout (5000ms default) if seeked event never fires', async () => {
      video.currentTime = 0.0

      let resolved = false
      seekVideo(video, 3.5, 5000).then(() => {
        resolved = true
      })

      expect(resolved).toBe(false)
      await vi.advanceTimersByTimeAsync(4999)
      expect(resolved).toBe(false)

      await vi.advanceTimersByTimeAsync(2)
      expect(resolved).toBe(true)
    })

    it('waits for seeking flag to settle before applying new currentTime', async () => {
      Object.defineProperty(video, 'seeking', { value: true })
      video.currentTime = 1.0

      let resolved = false
      const promise = seekVideo(video, 3.0).then(() => {
        resolved = true
      })

      // While seeking is true, currentTime should not immediately be overridden to 3.0
      expect(video.currentTime).toBe(1.0)

      // Simulate prior seek finishing
      Object.defineProperty(video, 'seeking', { value: false })
      video.dispatchEvent(new Event('seeked'))

      await vi.advanceTimersByTimeAsync(10)
      expect(video.currentTime).toBe(3.0)

      // Settle the new seek
      video.dispatchEvent(new Event('seeked'))
      await promise
      expect(resolved).toBe(true)
    })
  })
})
