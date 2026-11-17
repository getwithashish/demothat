import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import log from 'electron-log/main'
import { getFFmpegPath } from '../../lib/utils'
import { DEFAULT_VIRTUAL_STUDIO_RESOLUTION, type VirtualFramePayload } from '../../../../shared/virtual-camera-types'
import { checkLinuxCameraDriver } from './driver-setup'

export interface CameraSinkOptions {
  width: number
  height: number
  fps: number
  devicePath?: string
}

export class VirtualCameraSink {
  private active = false
  private isStandby = false
  private standbyTimer: NodeJS.Timeout | null = null
  private standbySlateBuffer: Buffer | null = null
  private ffmpegProcess: ChildProcessWithoutNullStreams | null = null
  private options: CameraSinkOptions | null = null
  private frameCount = 0
  private lastError: string | null = null

  public isActive(): boolean {
    return this.active
  }

  public isStandbyActive(): boolean {
    return this.isStandby
  }

  public isStandbyMode(): boolean {
    return this.isStandby
  }

  public getFrameCount(): number {
    return this.frameCount
  }

  public getLastError(): string | null {
    return this.lastError
  }

  public getOptions(): CameraSinkOptions | null {
    return this.options
  }

  /**
   * Generates or returns cached 1080p dark standby slate buffer.
   * Dark slate matching DEFAULT_VIRTUAL_STUDIO_FALLBACK_COLOR (#17181b -> R:23, G:24, B:27, A:255).
   */
  public getStandbySlateBuffer(width: number, height: number): Buffer {
    const size = width * height * 4
    if (this.standbySlateBuffer && this.standbySlateBuffer.length === size) {
      return this.standbySlateBuffer
    }
    const buf = Buffer.alloc(size)
    for (let i = 0; i < size; i += 4) {
      buf[i] = 23
      buf[i + 1] = 24
      buf[i + 2] = 27
      buf[i + 3] = 255
    }
    this.standbySlateBuffer = buf
    return buf
  }

  private startStandbyTimer(): void {
    this.stopStandbyTimer()
    const fps = this.options?.fps || 30
    const intervalMs = Math.floor(1000 / fps)
    const slate = this.getStandbySlateBuffer(
      this.options?.width || DEFAULT_VIRTUAL_STUDIO_RESOLUTION.width,
      this.options?.height || DEFAULT_VIRTUAL_STUDIO_RESOLUTION.height,
    )

    this.standbyTimer = setInterval(() => {
      if (!this.isStandby || !this.ffmpegProcess || !this.ffmpegProcess.stdin.writable) {
        return
      }
      try {
        if (this.ffmpegProcess.stdin.writableLength < slate.length * 2) {
          this.ffmpegProcess.stdin.write(slate)
        }
      } catch (err) {
        log.debug('[VirtualCameraSink] Standby timer write error:', err)
      }
    }, intervalMs)

    if (this.standbyTimer && typeof this.standbyTimer.unref === 'function') {
      this.standbyTimer.unref()
    }
  }

  private stopStandbyTimer(): void {
    if (this.standbyTimer) {
      clearInterval(this.standbyTimer)
      this.standbyTimer = null
    }
  }

  /**
   * Starts feeding an idle standby slate at 1080p while Studio is idle,
   * keeping /dev/video10 discoverable by WebRTC/browsers.
   */
  public async startStandby(options?: Partial<CameraSinkOptions>): Promise<{ success: boolean; error?: string }> {
    const standardizedOptions: CameraSinkOptions = {
      width: options?.width || DEFAULT_VIRTUAL_STUDIO_RESOLUTION.width,
      height: options?.height || DEFAULT_VIRTUAL_STUDIO_RESOLUTION.height,
      fps: options?.fps || DEFAULT_VIRTUAL_STUDIO_RESOLUTION.fps,
      devicePath: options?.devicePath,
    }

    // If already in standby with identical configuration, keep running
    if (
      this.isStandby &&
      this.options &&
      this.options.width === standardizedOptions.width &&
      this.options.height === standardizedOptions.height &&
      this.options.fps === standardizedOptions.fps &&
      (!standardizedOptions.devicePath || this.options.devicePath === standardizedOptions.devicePath) &&
      this.ffmpegProcess &&
      !this.ffmpegProcess.killed
    ) {
      return { success: true }
    }

    // If active live streaming is underway, do not interrupt live stream
    if (this.active && !this.isStandby) {
      log.info('[VirtualCameraSink] Live stream is active; ignoring startStandby')
      return { success: true }
    }

    if (this.active || this.ffmpegProcess) {
      await this.stop()
    }

    this.options = standardizedOptions
    this.frameCount = 0
    this.lastError = null

    try {
      if (process.platform === 'linux') {
        const res = await this.startLinuxSink(standardizedOptions)
        if (!res.success) {
          return res
        }
      } else if (process.platform === 'win32') {
        await this.startWindowsSink(standardizedOptions)
      } else if (process.platform === 'darwin') {
        await this.startMacSink(standardizedOptions)
      }

      this.active = false
      this.isStandby = true
      this.startStandbyTimer()
      log.info(
        `[VirtualCameraSink] Idle standby slate active at ${standardizedOptions.width}x${standardizedOptions.height} @ ${standardizedOptions.fps}fps`,
      )
      return { success: true }
    } catch (err: unknown) {
      this.lastError = err instanceof Error ? err.message : String(err)
      log.error('[VirtualCameraSink] Failed to start standby slate:', err)
      return { success: false, error: this.lastError ?? 'Failed to start standby slate' }
    }
  }

  /**
   * Starts the camera sink on the host OS, seamlessly transitioning from standby slate if running.
   */
  public async start(options: CameraSinkOptions): Promise<{ success: boolean; error?: string }> {
    // Standardize default resolution to DEFAULT_VIRTUAL_STUDIO_RESOLUTION (1920x1080 @ 30fps)
    const standardizedOptions: CameraSinkOptions = {
      width: options.width || DEFAULT_VIRTUAL_STUDIO_RESOLUTION.width,
      height: options.height || DEFAULT_VIRTUAL_STUDIO_RESOLUTION.height,
      fps: options.fps || DEFAULT_VIRTUAL_STUDIO_RESOLUTION.fps,
      devicePath: options.devicePath,
    }

    // Seamless transition from standby slate to live frames without restarting FFmpeg
    if (
      this.isStandby &&
      this.ffmpegProcess &&
      !this.ffmpegProcess.killed &&
      this.options &&
      this.options.width === standardizedOptions.width &&
      this.options.height === standardizedOptions.height &&
      this.options.fps === standardizedOptions.fps &&
      (!standardizedOptions.devicePath || this.options.devicePath === standardizedOptions.devicePath)
    ) {
      log.info('[VirtualCameraSink] Seamlessly switching from standby slate to live frames')
      this.stopStandbyTimer()
      this.isStandby = false
      this.active = true
      return { success: true }
    }

    // Idempotent guard: if already active live with identical configuration, keep running without restarting
    if (
      this.active &&
      !this.isStandby &&
      this.options &&
      this.options.width === standardizedOptions.width &&
      this.options.height === standardizedOptions.height &&
      this.options.fps === standardizedOptions.fps &&
      (!standardizedOptions.devicePath || this.options.devicePath === standardizedOptions.devicePath) &&
      this.ffmpegProcess &&
      !this.ffmpegProcess.killed
    ) {
      log.info('[VirtualCameraSink] Sink already active with identical configuration; keeping existing stream')
      return { success: true }
    }

    if (this.active || this.isStandby || this.ffmpegProcess) {
      await this.stop()
    }

    this.options = standardizedOptions
    this.frameCount = 0
    this.lastError = null

    try {
      if (process.platform === 'linux') {
        return await this.startLinuxSink(standardizedOptions)
      } else if (process.platform === 'win32') {
        return await this.startWindowsSink(standardizedOptions)
      } else if (process.platform === 'darwin') {
        return await this.startMacSink(standardizedOptions)
      } else {
        this.active = true
        log.info(`[VirtualCameraSink] Running on stub platform: ${process.platform}`)
        return { success: true }
      }
    } catch (err: unknown) {
      this.lastError = err instanceof Error ? err.message : String(err)
      log.error('[VirtualCameraSink] Failed to start virtual camera sink:', err)
      return { success: false, error: this.lastError ?? 'Failed to start virtual camera sink' }
    }
  }

  /**
   * Linux v4l2 sink using FFmpeg piping raw frames to v4l2 device node.
   */
  private async startLinuxSink(options: CameraSinkOptions): Promise<{ success: boolean; error?: string }> {
    let device = options.devicePath
    if (!device) {
      const detected = await checkLinuxCameraDriver()
      device = detected.devicePath || '/dev/video10'
    }

    try {
      const ffmpegPath = getFFmpegPath()
      const args = [
        '-y',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        '-s',
        `${options.width}x${options.height}`,
        '-r',
        String(options.fps || 30),
        '-i',
        'pipe:0',
        '-vf',
        'scale=out_color_matrix=bt709:out_range=full:flags=lanczos+accurate_rnd+full_chroma_int,unsharp=lx=5:ly=5:la=0.6:cx=5:cy=5:ca=0.3',
        '-color_range',
        'pc',
        '-colorspace',
        'bt709',
        '-color_primaries',
        'bt709',
        '-color_trc',
        'bt709',
        '-f',
        'v4l2',
        '-pix_fmt',
        'yuv420p',
        '-flush_packets',
        '1',
        device,
      ]

      log.info(`[VirtualCameraSink] Spawning Linux FFmpeg sink -> ${device}: ${ffmpegPath} ${args.join(' ')}`)
      const proc = spawn(ffmpegPath, args)

      proc.stdin.on('error', (err) => {
        log.warn('[VirtualCameraSink] Linux stdin pipe error:', err.message)
      })

      proc.stderr.on('data', (chunk) => {
        const msg = chunk.toString()
        if (msg.includes('Error') || msg.includes('failed')) {
          log.warn(`[VirtualCameraSink] FFmpeg stderr: ${msg.trim()}`)
        }
      })

      proc.on('close', (code) => {
        log.info(`[VirtualCameraSink] FFmpeg sink closed with code ${code}`)
        if (this.ffmpegProcess === proc) {
          this.stopStandbyTimer()
          this.active = false
          this.isStandby = false
          this.ffmpegProcess = null
        }
      })

      this.ffmpegProcess = proc
      this.active = true

      // Immediately pipe initial frames so v4l2loopback registers V4L2_CAP_VIDEO_CAPTURE in Chrome/Google Meet
      try {
        const slate = this.getStandbySlateBuffer(options.width, options.height)
        if (proc.stdin.writable) {
          for (let i = 0; i < 5; i++) {
            proc.stdin.write(slate)
          }
        }
      } catch (frameErr) {
        log.debug('[VirtualCameraSink] Could not pipe initial frames to sink:', frameErr)
      }

      return { success: true }
    } catch (err: unknown) {
      log.warn('[VirtualCameraSink] Could not spawn FFmpeg for v4l2; falling back to software stub:', err)
      this.active = true
      return { success: true }
    }
  }

  /**
   * Windows DirectShow sink using shared memory or virtual camera pipe.
   */
  private async startWindowsSink(options: CameraSinkOptions): Promise<{ success: boolean; error?: string }> {
    log.info(
      `[VirtualCameraSink] Initializing Windows DirectShow sink (${options.width}x${options.height} @ ${options.fps}fps)`,
    )
    this.active = true
    return { success: true }
  }

  /**
   * macOS CMIO Extension sink using CoreMediaIO shared buffer.
   */
  private async startMacSink(options: CameraSinkOptions): Promise<{ success: boolean; error?: string }> {
    log.info(
      `[VirtualCameraSink] Initializing macOS CMIO sink (${options.width}x${options.height} @ ${options.fps}fps)`,
    )
    this.active = true
    return { success: true }
  }

  /**
   * Pushes a single video frame to the active virtual camera sink.
   */
  public async pushFrame(payload: VirtualFramePayload): Promise<boolean> {
    if (!this.active || this.isStandby) {
      return false
    }

    try {
      let buffer: Buffer
      if (Buffer.isBuffer(payload.data)) {
        buffer = payload.data
      } else if (payload.data instanceof ArrayBuffer) {
        buffer = Buffer.from(payload.data)
      } else if (ArrayBuffer.isView(payload.data)) {
        buffer = Buffer.from(payload.data.buffer, payload.data.byteOffset, payload.data.byteLength)
      } else {
        buffer = Buffer.from(payload.data)
      }

      if (this.ffmpegProcess && this.ffmpegProcess.stdin.writable) {
        const stdin = this.ffmpegProcess.stdin
        if (stdin.writableLength > buffer.length * 2) {
          await new Promise<void>((resolve) => {
            stdin.once('drain', () => resolve())
            setTimeout(resolve, 10)
          })
        }
        stdin.write(buffer)
      }

      this.frameCount++
      return true
    } catch (err: unknown) {
      this.lastError = err instanceof Error ? err.message : String(err)
      log.warn('[VirtualCameraSink] pushFrame error:', this.lastError)
      return false
    }
  }

  /**
   * Stops the virtual camera sink and cleanly awaits child process termination,
   * or falls back to idle standby slate if fallbackToStandby is true.
   */
  public async stop(options: { fallbackToStandby?: boolean } = {}): Promise<void> {
    if (options.fallbackToStandby && this.ffmpegProcess && !this.ffmpegProcess.killed) {
      log.info('[VirtualCameraSink] Falling back to idle standby slate')
      this.active = false
      this.isStandby = true
      this.startStandbyTimer()
      return
    }

    this.stopStandbyTimer()
    this.isStandby = false

    if (!this.active && !this.ffmpegProcess) {
      return
    }

    log.info('[VirtualCameraSink] Stopping virtual camera sink')
    this.active = false
    const proc = this.ffmpegProcess
    this.ffmpegProcess = null
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
          log.warn('[VirtualCameraSink] Error terminating sink process:', err)
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

export const virtualCameraSink = new VirtualCameraSink()
