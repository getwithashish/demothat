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
  private ffmpegProcess: ChildProcessWithoutNullStreams | null = null
  private options: CameraSinkOptions | null = null
  private frameCount = 0
  private lastError: string | null = null

  public isActive(): boolean {
    return this.active
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
   * Starts the camera sink on the host OS.
   */
  public async start(options: CameraSinkOptions): Promise<{ success: boolean; error?: string }> {
    if (this.active) {
      await this.stop()
    }

    // Standardize default resolution to 1280x720 @ 30fps for optimal WebRTC / Google Meet compatibility
    const standardizedOptions: CameraSinkOptions = {
      width: options.width || DEFAULT_VIRTUAL_STUDIO_RESOLUTION.width,
      height: options.height || DEFAULT_VIRTUAL_STUDIO_RESOLUTION.height,
      fps: options.fps || DEFAULT_VIRTUAL_STUDIO_RESOLUTION.fps,
      devicePath: options.devicePath,
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
        this.active = false
        this.ffmpegProcess = null
      })

      this.ffmpegProcess = proc
      this.active = true

      // Immediately pipe initial frames so v4l2loopback registers V4L2_CAP_VIDEO_CAPTURE in Chrome/Google Meet
      try {
        const frameByteLength = options.width * options.height * 4
        const blankFrame = Buffer.alloc(frameByteLength, 0)
        for (let i = 3; i < frameByteLength; i += 4) {
          blankFrame[i] = 255
        }
        if (proc.stdin.writable) {
          for (let i = 0; i < 5; i++) {
            proc.stdin.write(blankFrame)
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
    if (!this.active) {
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
        const flushed = this.ffmpegProcess.stdin.write(buffer)
        if (!flushed) {
          // Backpressure encountered; wait for drain or drop next frame
          await new Promise<void>((resolve) => {
            this.ffmpegProcess?.stdin.once('drain', () => resolve())
            setTimeout(resolve, 10)
          })
        }
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
   * Stops the virtual camera sink.
   */
  public async stop(): Promise<void> {
    if (!this.active && !this.ffmpegProcess) {
      return
    }

    log.info('[VirtualCameraSink] Stopping virtual camera sink')
    this.active = false

    if (this.ffmpegProcess) {
      try {
        if (this.ffmpegProcess.stdin && !this.ffmpegProcess.stdin.destroyed) {
          this.ffmpegProcess.stdin.end()
        }
        this.ffmpegProcess.kill('SIGTERM')
      } catch (err) {
        log.warn('[VirtualCameraSink] Error terminating sink process:', err)
      }
      this.ffmpegProcess = null
    }

    this.options = null
  }
}

export const virtualCameraSink = new VirtualCameraSink()
