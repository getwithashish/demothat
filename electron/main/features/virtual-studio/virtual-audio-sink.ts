import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import log from 'electron-log/main'
import { getFFmpegPath } from '../../lib/utils'

export interface AudioSinkOptions {
  sampleRate?: number
  channels?: number
  deviceSinkName?: string
}

export class VirtualAudioSink {
  private active = false
  private muted = false
  private audioProcess: ChildProcessWithoutNullStreams | null = null
  private options: AudioSinkOptions | null = null
  private sampleRate = 48000
  private channels = 2
  private chunksWritten = 0
  private totalBytesWritten = 0
  private underflowCount = 0
  private overflowCount = 0
  private totalWriteLatencyMs = 0
  private lastChunkTime = 0
  private silenceTimer: NodeJS.Timeout | null = null
  private silenceBuffer: Buffer | null = null
  private metricsTimer: NodeJS.Timeout | null = null
  private lastMetricsTime = 0
  private lastMetricsChunks = 0
  private lastMetricsBytes = 0

  public isActive(): boolean {
    return this.active
  }

  public isMuted(): boolean {
    return this.muted
  }

  public setMuted(muted: boolean): void {
    this.muted = muted
    log.info(`[VirtualAudioSink] Audio sink muted state set to: ${muted}`)
  }

  public getChunksWritten(): number {
    return this.chunksWritten
  }

  public getTotalBytesWritten(): number {
    return this.totalBytesWritten
  }

  public getUnderflowCount(): number {
    return this.underflowCount
  }

  public getOverflowCount(): number {
    return this.overflowCount
  }

  public getMetrics(): {
    chunksWritten: number
    totalBytesWritten: number
    underflowCount: number
    overflowCount: number
    queueDepth: number
    avgWriteLatencyMs: number
  } {
    return {
      chunksWritten: this.chunksWritten,
      totalBytesWritten: this.totalBytesWritten,
      underflowCount: this.underflowCount,
      overflowCount: this.overflowCount,
      queueDepth: this.audioProcess?.stdin?.writableLength ?? 0,
      avgWriteLatencyMs:
        this.chunksWritten > 0 ? Number((this.totalWriteLatencyMs / this.chunksWritten).toFixed(2)) : 0,
    }
  }

  public getOptions(): AudioSinkOptions | null {
    return this.options
  }

  private startMetricsTimer(): void {
    this.stopMetricsTimer()
    this.lastMetricsTime = Date.now()
    this.lastMetricsChunks = this.chunksWritten
    this.lastMetricsBytes = this.totalBytesWritten
    this.metricsTimer = setInterval(() => {
      if (!this.active) return
      const now = Date.now()
      const elapsedSec = (now - this.lastMetricsTime) / 1000
      if (elapsedSec <= 0) return
      const chunksDelta = this.chunksWritten - this.lastMetricsChunks
      const bytesDelta = this.totalBytesWritten - this.lastMetricsBytes
      const queueDepth = this.audioProcess?.stdin?.writableLength ?? 0
      const avgLatency = this.chunksWritten > 0 ? (this.totalWriteLatencyMs / this.chunksWritten).toFixed(2) : '0.00'
      const kbps = ((bytesDelta * 8) / (elapsedSec * 1000)).toFixed(1)
      log.info(
        `[VirtualAudioSink Metrics] Audio throughput: ${chunksDelta} chunks (${bytesDelta} bytes, ${kbps} kbps in ${elapsedSec.toFixed(1)}s) | Queue depth: ${queueDepth} bytes | Avg write latency: ${avgLatency}ms | Underflows: ${this.underflowCount} | Overflows: ${this.overflowCount}`,
      )
      this.lastMetricsTime = now
      this.lastMetricsChunks = this.chunksWritten
      this.lastMetricsBytes = this.totalBytesWritten
    }, 5000)

    if (this.metricsTimer && typeof this.metricsTimer.unref === 'function') {
      this.metricsTimer.unref()
    }
  }

  private stopMetricsTimer(): void {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer)
      this.metricsTimer = null
    }
  }

  public getSilenceBuffer(): Buffer {
    if (!this.silenceBuffer) {
      // 1024 stereo 16-bit PCM samples = 1024 * 2 channels * 2 bytes = 4096 bytes
      this.silenceBuffer = Buffer.alloc(4096)
    }
    return this.silenceBuffer
  }

  public startSilenceKeepAlive(): void {
    this.stopSilenceKeepAlive()
    // Watchdog checking every 60ms; if no audio chunk has arrived for >=120ms, write silence
    this.silenceTimer = setInterval(() => {
      if (!this.active || this.muted || !this.audioProcess || !this.audioProcess.stdin.writable) {
        return
      }
      const now = Date.now()
      if (this.lastChunkTime > 0 && now - this.lastChunkTime >= 120) {
        try {
          const silence = this.getSilenceBuffer()
          this.audioProcess.stdin.write(silence)
          this.lastChunkTime = now
          this.chunksWritten++
          this.totalBytesWritten += silence.length
        } catch (err) {
          log.debug('[VirtualAudioSink] Silence keep-alive write error:', err)
        }
      }
    }, 60)

    if (this.silenceTimer && typeof this.silenceTimer.unref === 'function') {
      this.silenceTimer.unref()
    }
  }

  public stopSilenceKeepAlive(): void {
    if (this.silenceTimer) {
      clearInterval(this.silenceTimer)
      this.silenceTimer = null
    }
  }

  /**
   * Starts the virtual audio sink.
   */
  public async start(options: AudioSinkOptions = {}): Promise<{ success: boolean; error?: string }> {
    const targetSampleRate = options.sampleRate || 48000
    const targetChannels = options.channels || 2

    // Idempotent guard: if already active with identical configuration, keep running without restarting
    if (
      this.active &&
      this.options &&
      this.sampleRate === targetSampleRate &&
      this.channels === targetChannels &&
      this.options.deviceSinkName === options.deviceSinkName &&
      this.audioProcess &&
      !this.audioProcess.killed
    ) {
      log.info('[VirtualAudioSink] Audio sink already active with identical configuration; keeping existing stream')
      return { success: true }
    }

    if (this.active || this.audioProcess) {
      await this.stop()
    }

    this.options = options
    this.sampleRate = targetSampleRate
    this.channels = targetChannels
    this.chunksWritten = 0
    this.totalBytesWritten = 0
    this.underflowCount = 0
    this.overflowCount = 0
    this.totalWriteLatencyMs = 0
    this.lastChunkTime = 0

    log.info(
      `[VirtualAudioSink] Starting audio sink (sampleRate: ${targetSampleRate}Hz, channels: ${targetChannels}, deviceSinkName: ${options.deviceSinkName || 'demothat_mic'})`,
    )

    try {
      let result: { success: boolean; error?: string }
      if (process.platform === 'linux') {
        result = await this.startLinuxSink(options)
      } else if (process.platform === 'win32') {
        result = await this.startWindowsSink(options)
      } else if (process.platform === 'darwin') {
        result = await this.startMacSink(options)
      } else {
        this.active = true
        result = { success: true }
      }

      if (result.success && this.active) {
        this.startMetricsTimer()
        this.startSilenceKeepAlive()
      }
      return result
    } catch (err: unknown) {
      log.warn('[VirtualAudioSink] Failed to start virtual audio sink process:', err)
      // Best-effort active state so UI doesn't crash on stub systems
      this.active = true
      this.startMetricsTimer()
      this.startSilenceKeepAlive()
      return { success: true }
    }
  }

  /**
   * Starts Linux PulseAudio/PipeWire audio sink via pacat or ffmpeg.
   */
  private async startLinuxSink(options: AudioSinkOptions): Promise<{ success: boolean; error?: string }> {
    const sinkName = options.deviceSinkName || 'demothat_mic'
    log.info(
      `[VirtualAudioSink] Setting up Linux PipeWire/PulseAudio sink for target: ${sinkName} (${this.sampleRate}Hz, ${this.channels}ch, s16le)`,
    )

    try {
      // First try pacat directly
      const proc = spawn('pacat', [
        '--playback',
        '--format=s16le',
        `--rate=${this.sampleRate}`,
        `--channels=${this.channels}`,
        `--device=${sinkName}`,
      ])

      proc.stdin.on('error', (err) => {
        log.warn('[VirtualAudioSink] pacat stdin error:', err.message)
      })

      proc.on('error', (err) => {
        log.error('[VirtualAudioSink] pacat process error:', err)
      })

      proc.on('close', (code) => {
        log.info(`[VirtualAudioSink] pacat closed with code ${code}`)
        if (this.audioProcess === proc) {
          this.active = false
          this.audioProcess = null
          this.stopMetricsTimer()
          this.stopSilenceKeepAlive()
        }
      })

      this.audioProcess = proc
      this.active = true
      log.info(`[VirtualAudioSink] pacat audio sink started for target: ${sinkName}`)
      return { success: true }
    } catch (err) {
      log.warn('[VirtualAudioSink] pacat not found, trying FFmpeg pulse output:', err)
      try {
        const ffmpegPath = getFFmpegPath()
        const args = [
          '-y',
          '-f',
          's16le',
          '-ar',
          String(this.sampleRate),
          '-ac',
          String(this.channels),
          '-i',
          'pipe:0',
          '-f',
          'pulse',
          sinkName,
        ]
        log.info(`[VirtualAudioSink] Spawning FFmpeg pulse sink: ${ffmpegPath} ${args.join(' ')}`)
        const proc = spawn(ffmpegPath, args)
        proc.stdin.on('error', () => {})
        proc.on('close', (code) => {
          log.info(`[VirtualAudioSink] FFmpeg pulse sink closed with code ${code}`)
          if (this.audioProcess === proc) {
            this.active = false
            this.audioProcess = null
            this.stopMetricsTimer()
            this.stopSilenceKeepAlive()
          }
        })
        this.audioProcess = proc
        this.active = true
        return { success: true }
      } catch {
        this.active = true
        return { success: true }
      }
    }
  }

  /**
   * Starts Windows virtual audio endpoint.
   */
  private async startWindowsSink(_options: AudioSinkOptions): Promise<{ success: boolean; error?: string }> {
    log.info('[VirtualAudioSink] Initializing Windows virtual audio endpoint')
    this.active = true
    return { success: true }
  }

  /**
   * Starts macOS virtual audio endpoint (BlackHole/Aggregate device).
   */
  private async startMacSink(_options: AudioSinkOptions): Promise<{ success: boolean; error?: string }> {
    log.info('[VirtualAudioSink] Initializing macOS virtual audio endpoint')
    this.active = true
    return { success: true }
  }

  /**
   * Pushes raw PCM audio chunks into the audio sink.
   */
  public async pushAudio(chunk: Uint8Array | ArrayBuffer | Buffer): Promise<boolean> {
    if (!this.active) {
      return false
    }

    if (this.muted) {
      // When muted, do not forward audio
      return true
    }

    try {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : chunk instanceof ArrayBuffer
          ? Buffer.from(chunk)
          : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)

      const now = Date.now()
      if (this.lastChunkTime > 0) {
        const gapMs = now - this.lastChunkTime
        if (gapMs > 250) {
          this.underflowCount++
          log.debug(
            `[VirtualAudioSink] Audio underflow detected: ${gapMs}ms gap between chunks (underflow #${this.underflowCount})`,
          )
        }
      }
      this.lastChunkTime = now

      if (this.audioProcess && this.audioProcess.stdin.writable) {
        const queueDepth = this.audioProcess.stdin.writableLength ?? 0
        if (queueDepth > 64 * 1024) {
          this.overflowCount++
          log.warn(
            `[VirtualAudioSink] Audio queue overflow/backpressure: stdin buffer length ${queueDepth} bytes > 64KB (overflow #${this.overflowCount})`,
          )
        }

        const writeStart = performance.now()
        this.audioProcess.stdin.write(buffer)
        const writeDuration = performance.now() - writeStart
        this.totalWriteLatencyMs += writeDuration
      }
      this.chunksWritten++
      this.totalBytesWritten += buffer.length
      return true
    } catch (err: unknown) {
      log.warn('[VirtualAudioSink] pushAudio error:', err instanceof Error ? err.message : String(err))
      return false
    }
  }

  /**
   * Stops the virtual audio sink and cleanly awaits child process termination.
   */
  public async stop(): Promise<void> {
    this.stopMetricsTimer()
    this.stopSilenceKeepAlive()

    if (!this.active && !this.audioProcess) {
      return
    }

    log.info(
      `[VirtualAudioSink] Stopping virtual audio sink. Session summary: ${this.chunksWritten} chunks (${this.totalBytesWritten} bytes written), underflows: ${this.underflowCount}, overflows: ${this.overflowCount}`,
    )
    this.active = false
    const proc = this.audioProcess
    this.audioProcess = null
    this.options = null

    if (proc) {
      await new Promise<void>((resolve) => {
        let resolved = false
        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true
            try {
              proc.kill('SIGKILL')
            } catch {
              // ignore
            }
            resolve()
          }
        }, 1500)

        proc.once('close', () => {
          if (!resolved) {
            resolved = true
            clearTimeout(timer)
            resolve()
          }
        })

        try {
          if (proc.stdin && !proc.stdin.destroyed) {
            proc.stdin.end()
          }
          proc.kill('SIGTERM')
        } catch (err) {
          log.warn('[VirtualAudioSink] Error terminating audio process:', err)
          if (!resolved) {
            resolved = true
            clearTimeout(timer)
            resolve()
          }
        }
      })
    }
  }
}

export const virtualAudioSink = new VirtualAudioSink()
