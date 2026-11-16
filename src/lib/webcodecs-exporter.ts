import log from 'electron-log/renderer'
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import type { ExportQuality } from '../../electron/main/features/export-video-args'

export interface WebCodecsExporterOptions {
  width: number
  height: number
  fps: number
  quality?: ExportQuality | string
  bitrate?: number
}

export type WebCodecsHardwareAcceleration = 'prefer-hardware' | 'no-preference'

const H264_CANDIDATE_CODECS = [
  'avc1.64002A', // High Profile, Level 4.2
  'avc1.4D002A', // Main Profile, Level 4.2
  'avc1.42002A', // Baseline Profile, Level 4.2
  'avc1.42E02A', // Constrained Baseline, Level 4.2
  'avc1.42001E', // Baseline Profile, Level 3.0
]

const HW_ACCEL_CANDIDATES: WebCodecsHardwareAcceleration[] = ['prefer-hardware', 'no-preference']

/**
 * Calculates a sensible target bitrate based on resolution and export quality setting.
 */
export function calculateBitrate(width: number, height: number, fps: number, quality?: ExportQuality | string): number {
  const pixels = width * height
  const is4K = pixels >= 3840 * 2160
  const is2K = pixels >= 2560 * 1440
  const is1080p = pixels >= 1920 * 1080

  let baseBitrate = 8_000_000 // 8 Mbps default for 1080p30
  if (is4K) baseBitrate = 28_000_000
  else if (is2K) baseBitrate = 16_000_000
  else if (is1080p) baseBitrate = 8_000_000
  else baseBitrate = 4_000_000

  // Adjust for FPS
  if (fps > 30) baseBitrate = Math.round(baseBitrate * (fps / 30))

  // Adjust for quality
  if (quality === 'high') return Math.round(baseBitrate * 1.5)
  if (quality === 'low') return Math.round(baseBitrate * 0.6)
  return baseBitrate
}

/**
 * Checks if hardware or software WebCodecs H.264 encoding is available in this environment.
 */
export async function isWebCodecsSupported(width = 1920, height = 1080): Promise<boolean> {
  const encoderClass =
    typeof VideoEncoder !== 'undefined'
      ? VideoEncoder
      : typeof window !== 'undefined'
        ? (window as unknown as { VideoEncoder?: typeof VideoEncoder }).VideoEncoder
        : undefined

  if (!encoderClass || typeof encoderClass.isConfigSupported !== 'function') {
    return false
  }

  for (const hwAccel of HW_ACCEL_CANDIDATES) {
    for (const codec of H264_CANDIDATE_CODECS) {
      try {
        const config = {
          codec,
          width,
          height,
          bitrate: 5_000_000,
          bitrateMode: 'variable' as const,
          framerate: 30,
          hardwareAcceleration: hwAccel,
          avc: { format: 'avc' as const },
        }
        const support = await encoderClass.isConfigSupported(config)
        if (support && support.supported) return true
      } catch {
        // Ignore and test next candidate
      }
    }
  }
  return false
}

/**
 * High-performance, zero-copy WebCodecs H.264 chunk exporter.
 * Encodes canvas VideoFrames directly on the GPU (or via software fallback) and muxes them into an MP4 chunk.
 */
export class WebCodecsChunkExporter {
  private muxer: Muxer<ArrayBufferTarget> | null = null
  private encoder: VideoEncoder | null = null
  private width: number
  private height: number
  private fps: number
  private frameCount = 0
  private encoderError: Error | null = null
  private initialized = false
  private selectedCodec: string | null = null
  private selectedHwAccel: WebCodecsHardwareAcceleration = 'no-preference'

  public get codec(): string | null {
    return this.selectedCodec
  }

  public get hardwareAcceleration(): WebCodecsHardwareAcceleration {
    return this.selectedHwAccel
  }

  constructor(options: WebCodecsExporterOptions) {
    this.width = options.width
    this.height = options.height
    this.fps = options.fps
  }

  public async init(quality?: ExportQuality | string, bitrateOverride?: number): Promise<void> {
    if (this.initialized) return

    const encoderClass =
      typeof VideoEncoder !== 'undefined'
        ? VideoEncoder
        : typeof window !== 'undefined'
          ? (window as unknown as { VideoEncoder?: typeof VideoEncoder }).VideoEncoder
          : undefined

    if (!encoderClass) {
      throw new Error('VideoEncoder is not available in this environment.')
    }

    const targetBitrate = bitrateOverride ?? calculateBitrate(this.width, this.height, this.fps, quality)

    let selectedCodec: string | null = null
    let selectedHwAccel: WebCodecsHardwareAcceleration = 'no-preference'

    // Probe hardware acceleration first across candidate profiles, then software fallback (no-preference)
    for (const hwAccel of HW_ACCEL_CANDIDATES) {
      for (const codec of H264_CANDIDATE_CODECS) {
        try {
          const support = await encoderClass.isConfigSupported({
            codec,
            width: this.width,
            height: this.height,
            bitrate: targetBitrate,
            bitrateMode: 'variable' as const,
            framerate: this.fps,
            hardwareAcceleration: hwAccel,
            avc: { format: 'avc' as const },
          })
          if (support.supported) {
            selectedCodec = codec
            selectedHwAccel = hwAccel
            break
          }
        } catch {
          // Continue probing
        }
      }
      if (selectedCodec) break
    }

    if (!selectedCodec) {
      throw new Error(`WebCodecs H.264 encoder is not supported for ${this.width}x${this.height}`)
    }

    this.selectedCodec = selectedCodec
    this.selectedHwAccel = selectedHwAccel

    this.muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: {
        codec: 'avc',
        width: this.width,
        height: this.height,
      },
      fastStart: 'in-memory',
    })

    this.encoder = new encoderClass({
      output: (chunk, meta) => {
        if (this.muxer) {
          this.muxer.addVideoChunk(chunk, meta)
        }
      },
      error: (e) => {
        log.error('[WebCodecsExporter] VideoEncoder error:', e)
        this.encoderError = e instanceof Error ? e : new Error(String(e))
      },
    })

    log.info(
      `[WebCodecsExporter] Initialized with codec ${selectedCodec} (${selectedHwAccel}), ${this.width}x${this.height} @ ${this.fps}fps, bitrate: ${(targetBitrate / 1_000_000).toFixed(1)} Mbps`,
    )

    this.encoder.configure({
      codec: selectedCodec,
      width: this.width,
      height: this.height,
      bitrate: targetBitrate,
      bitrateMode: 'variable',
      framerate: this.fps,
      hardwareAcceleration: selectedHwAccel,
      avc: { format: 'avc' },
    })

    // Yield a tick so any async initialization/creation failure surfaces immediately
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    if (this.encoderError) {
      throw this.encoderError
    }
    if (this.encoder.state === 'closed') {
      throw new Error(`WebCodecs VideoEncoder closed immediately after configure with codec ${selectedCodec}`)
    }

    this.initialized = true
  }

  /**
   * Encodes a single canvas frame. Zero CPU readback; the canvas texture is processed on the GPU.
   */
  public async addFrame(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    timestampMicros: number,
    forceKeyFrame = false,
  ): Promise<void> {
    if (!this.encoder || !this.initialized) {
      throw new Error('WebCodecsChunkExporter is not initialized.')
    }
    if (this.encoderError) {
      throw this.encoderError
    }
    if (this.encoder.state === 'closed') {
      throw new Error('WebCodecs VideoEncoder has unexpectedly closed.')
    }

    const isKeyFrame = forceKeyFrame || this.frameCount === 0 || this.frameCount % (this.fps * 2) === 0
    const videoFrame = new VideoFrame(canvas, { timestamp: Math.round(timestampMicros) })

    try {
      this.encoder.encode(videoFrame, { keyFrame: isKeyFrame })
      this.frameCount++
    } finally {
      videoFrame.close()
    }

    // Apply backpressure throttling to prevent GPU queue memory growth.
    // If the queue exceeds 12 frames, wait for dequeue event or timeout safely.
    if (this.encoder.encodeQueueSize > 12) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 50)
        if (typeof this.encoder?.addEventListener === 'function') {
          this.encoder.addEventListener(
            'dequeue',
            () => {
              clearTimeout(timeout)
              resolve()
            },
            { once: true },
          )
        }
      })
    }
    if (this.encoderError) {
      throw this.encoderError
    }
  }

  /**
   * Flushes the encoder, finalizes the MP4 container, and returns the raw MP4 file bytes.
   */
  public async finish(): Promise<Uint8Array> {
    if (!this.encoder || !this.muxer || !this.initialized) {
      throw new Error('WebCodecsChunkExporter is not initialized.')
    }
    if (this.encoderError) {
      throw this.encoderError
    }
    if (this.encoder.state === 'closed') {
      throw new Error('WebCodecs VideoEncoder has unexpectedly closed before finish.')
    }

    log.info(`[WebCodecsExporter] Flushing encoder after ${this.frameCount} frames...`)
    await this.encoder.flush()
    if (this.encoderError) {
      throw this.encoderError
    }

    this.muxer.finalize()

    const buffer = this.muxer.target.buffer
    log.info(`[WebCodecsExporter] Chunk MP4 muxing complete (${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB).`)

    this.encoder.close()
    this.encoder = null
    this.muxer = null
    this.initialized = false

    return new Uint8Array(buffer)
  }
}
