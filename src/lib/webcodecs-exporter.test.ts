import { describe, expect, it, vi, beforeEach } from 'vitest'
import { calculateBitrate, isWebCodecsSupported, WebCodecsChunkExporter } from './webcodecs-exporter'

describe('webcodecs-exporter', () => {
  describe('calculateBitrate', () => {
    it('calculates 8 Mbps for 1080p30 medium quality', () => {
      const bitrate = calculateBitrate(1920, 1080, 30, 'medium')
      expect(bitrate).toBe(8_000_000)
    })

    it('scales up for high quality and 60fps', () => {
      const bitrate = calculateBitrate(1920, 1080, 60, 'high')
      expect(bitrate).toBe(8_000_000 * 2 * 1.5) // 24 Mbps
    })

    it('calculates higher bitrate for 4K', () => {
      const bitrate = calculateBitrate(3840, 2160, 30, 'medium')
      expect(bitrate).toBe(28_000_000)
    })

    it('calculates lower bitrate for 720p low quality', () => {
      const bitrate = calculateBitrate(1280, 720, 30, 'low')
      expect(bitrate).toBe(Math.round(4_000_000 * 0.6))
    })
  })

  describe('isWebCodecsSupported', () => {
    it('returns false if window or VideoEncoder is undefined', async () => {
      const globalObj = globalThis as Record<string, unknown>
      const originalVideoEncoder = globalObj.VideoEncoder
      delete globalObj.VideoEncoder
      if (typeof window !== 'undefined') {
        const winObj = window as unknown as Record<string, unknown>
        delete winObj.VideoEncoder
      }
      const supported = await isWebCodecsSupported()
      expect(supported).toBe(false)
      globalObj.VideoEncoder = originalVideoEncoder
    })

    it('returns true when VideoEncoder supports H.264 profile', async () => {
      const mockEncoder = {
        isConfigSupported: vi.fn().mockResolvedValue({ supported: true }),
      }
      const globalObj = globalThis as Record<string, unknown>
      globalObj.VideoEncoder = mockEncoder
      if (typeof window !== 'undefined') {
        const winObj = window as unknown as Record<string, unknown>
        winObj.VideoEncoder = mockEncoder
      }
      const supported = await isWebCodecsSupported()
      expect(supported).toBe(true)
    })

    it('returns false if VideoEncoder isConfigSupported rejects or returns false for all profiles', async () => {
      const mockEncoder = {
        isConfigSupported: vi.fn().mockResolvedValue({ supported: false }),
      }
      const globalObj = globalThis as Record<string, unknown>
      globalObj.VideoEncoder = mockEncoder
      if (typeof window !== 'undefined') {
        const winObj = window as unknown as Record<string, unknown>
        winObj.VideoEncoder = mockEncoder
      }
      const supported = await isWebCodecsSupported()
      expect(supported).toBe(false)
    })
  })

  describe('WebCodecsChunkExporter lifecycle', () => {
    // Mock EncodedVideoChunk for mp4-muxer in Node environment
    class MockEncodedVideoChunk {
      type: 'key' | 'delta'
      timestamp: number
      duration = 33333
      byteLength: number
      data: Uint8Array

      constructor(init: { type: 'key' | 'delta'; timestamp: number; data: Uint8Array }) {
        this.type = init.type
        this.timestamp = init.timestamp
        this.data = init.data
        this.byteLength = init.data.byteLength
      }

      copyTo(dest: Uint8Array | ArrayBuffer) {
        const target = dest instanceof Uint8Array ? dest : new Uint8Array(dest)
        target.set(this.data)
      }
    }

    class MockVideoEncoder {
      static isConfigSupported = vi.fn().mockImplementation((config: { hardwareAcceleration?: string }) => {
        return Promise.resolve({ supported: true, config })
      })
      output: (chunk: MockEncodedVideoChunk, meta?: unknown) => void
      error: (err: unknown) => void
      encodeQueueSize = 0
      state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured'
      eventListeners = new Map<string, Array<() => void>>()

      constructor(init: {
        output: (chunk: MockEncodedVideoChunk, meta?: unknown) => void
        error: (err: unknown) => void
      }) {
        this.output = init.output
        this.error = init.error
      }

      addEventListener(event: string, callback: () => void) {
        if (!this.eventListeners.has(event)) {
          this.eventListeners.set(event, [])
        }
        this.eventListeners.get(event)!.push(callback)
      }

      configure = vi.fn((_config: unknown) => {
        this.state = 'configured'
      })

      encode = vi.fn((frame: { timestamp: number; close: () => void }) => {
        if (this.state === 'closed') {
          throw new Error("Cannot call 'encode' on a closed codec.")
        }
        const chunk = new MockEncodedVideoChunk({
          type: 'key',
          timestamp: frame.timestamp,
          data: new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0, 0x1f]),
        })
        this.output(chunk, {
          decoderConfig: {
            codec: 'avc1.64002A',
            description: new Uint8Array([1, 2, 3]),
          },
        })
      })

      flush = vi.fn().mockResolvedValue(undefined)
      close = vi.fn(() => {
        this.state = 'closed'
      })
    }

    class MockVideoFrame {
      timestamp: number
      constructor(_canvas: CanvasImageSource, init: { timestamp: number }) {
        this.timestamp = init.timestamp
      }
      close = vi.fn()
    }

    beforeEach(() => {
      const globalObj = globalThis as Record<string, unknown>
      globalObj.EncodedVideoChunk = MockEncodedVideoChunk
      globalObj.VideoEncoder = MockVideoEncoder
      globalObj.VideoFrame = MockVideoFrame
      if (typeof window !== 'undefined') {
        const winObj = window as unknown as Record<string, unknown>
        winObj.EncodedVideoChunk = MockEncodedVideoChunk
        winObj.VideoEncoder = MockVideoEncoder
        winObj.VideoFrame = MockVideoFrame
      }
    })

    it('initializes with candidate codec, encodes frames and finishes MP4 chunk', async () => {
      const exporter = new WebCodecsChunkExporter({ width: 1920, height: 1080, fps: 30 })
      await exporter.init('medium')

      const mockCanvas = {} as HTMLCanvasElement
      await exporter.addFrame(mockCanvas, 0, true)
      await exporter.addFrame(mockCanvas, 33333, false)

      const chunkBuffer = await exporter.finish()
      expect(chunkBuffer).toBeInstanceOf(Uint8Array)
      expect(chunkBuffer.byteLength).toBeGreaterThan(0)
    })

    it('falls back to no-preference when prefer-hardware is not supported', async () => {
      MockVideoEncoder.isConfigSupported = vi.fn().mockImplementation((config: { hardwareAcceleration?: string }) => {
        if (config.hardwareAcceleration === 'prefer-hardware') {
          return Promise.resolve({ supported: false })
        }
        return Promise.resolve({ supported: true })
      })

      const exporter = new WebCodecsChunkExporter({ width: 1920, height: 1080, fps: 30 })
      await exporter.init('medium')

      const mockCanvas = {} as HTMLCanvasElement
      await exporter.addFrame(mockCanvas, 0, true)
      const chunkBuffer = await exporter.finish()
      expect(chunkBuffer.byteLength).toBeGreaterThan(0)
    })

    it('throws during init if VideoEncoder triggers error during configure', async () => {
      class FailingVideoEncoder extends MockVideoEncoder {
        override configure = vi.fn(() => {
          setTimeout(() => {
            this.state = 'closed'
            this.error(new Error('OperationError Encoder creation error'))
          }, 0)
        })
      }
      const globalObj = globalThis as Record<string, unknown>
      globalObj.VideoEncoder = FailingVideoEncoder
      if (typeof window !== 'undefined') {
        const winObj = window as unknown as Record<string, unknown>
        winObj.VideoEncoder = FailingVideoEncoder
      }

      const exporter = new WebCodecsChunkExporter({ width: 1920, height: 1080, fps: 30 })
      await expect(exporter.init('medium')).rejects.toThrow('Encoder creation error')
    })

    it('handles queue backpressure with dequeue event', async () => {
      let dequeueTriggered = false
      class BackpressureVideoEncoder extends MockVideoEncoder {
        override encodeQueueSize = 15
        override addEventListener(event: string, callback: () => void) {
          super.addEventListener(event, callback)
          if (event === 'dequeue') {
            setTimeout(() => {
              this.encodeQueueSize = 2
              dequeueTriggered = true
              callback()
            }, 5)
          }
        }
      }
      const globalObj = globalThis as Record<string, unknown>
      globalObj.VideoEncoder = BackpressureVideoEncoder
      if (typeof window !== 'undefined') {
        const winObj = window as unknown as Record<string, unknown>
        winObj.VideoEncoder = BackpressureVideoEncoder
      }

      const exporter = new WebCodecsChunkExporter({ width: 1920, height: 1080, fps: 30 })
      await exporter.init('medium')

      const mockCanvas = {} as HTMLCanvasElement
      await exporter.addFrame(mockCanvas, 0, true)
      expect(dequeueTriggered).toBe(true)

      const chunkBuffer = await exporter.finish()
      expect(chunkBuffer.byteLength).toBeGreaterThan(0)
    })
  })
})
