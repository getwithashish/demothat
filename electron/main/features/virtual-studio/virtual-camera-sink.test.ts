import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

const mockStdin = {
  write: vi.fn().mockReturnValue(true),
  end: vi.fn(),
  writable: true,
  writableLength: 0,
  destroyed: false,
  on: vi.fn(),
  once: vi.fn(),
}

const mockStderr = new EventEmitter()

const mockProc = Object.assign(new EventEmitter(), {
  stdin: mockStdin,
  stderr: mockStderr,
  kill: vi.fn(),
})

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockProc),
}))

vi.mock('../../lib/utils', () => ({
  getFFmpegPath: vi.fn(() => '/mock/bin/ffmpeg'),
}))

vi.mock('./driver-setup', () => ({
  checkLinuxCameraDriver: vi.fn().mockResolvedValue({
    installed: true,
    devicePath: '/dev/video10',
  }),
}))

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import { VirtualCameraSink } from './virtual-camera-sink'
import { DEFAULT_VIRTUAL_STUDIO_RESOLUTION } from '../../../../shared/virtual-camera-types'
import { spawn } from 'node:child_process'

describe('VirtualCameraSink', () => {
  let sink: VirtualCameraSink

  beforeEach(() => {
    vi.clearAllMocks()
    mockStdin.writableLength = 0
    sink = new VirtualCameraSink()
  })

  it('standardizes resolution to DEFAULT_VIRTUAL_STUDIO_RESOLUTION and passes BT.709 yuv420p flags on Linux', async () => {
    const res = await sink.start({ width: 0, height: 0, fps: 0 })
    expect(res.success).toBe(true)
    expect(sink.isActive()).toBe(true)

    const options = sink.getOptions()
    expect(options?.width).toBe(DEFAULT_VIRTUAL_STUDIO_RESOLUTION.width)
    expect(options?.height).toBe(DEFAULT_VIRTUAL_STUDIO_RESOLUTION.height)
    expect(options?.fps).toBe(DEFAULT_VIRTUAL_STUDIO_RESOLUTION.fps)
    expect(options?.width).toBe(1920)
    expect(options?.height).toBe(1080)

    expect(spawn).toHaveBeenCalledWith(
      '/mock/bin/ffmpeg',
      expect.arrayContaining([
        '-pix_fmt',
        'yuv420p',
        '-s',
        '1920x1080',
        '-r',
        '30',
        '-color_range',
        'pc',
        '-colorspace',
        'bt709',
        '-color_primaries',
        'bt709',
        '-color_trc',
        'bt709',
        '-threads',
        '2',
        '-flush_packets',
        '1',
        '/dev/video10',
      ]),
    )

    // Initial frames burst should have been piped to stdin
    expect(mockStdin.write).toHaveBeenCalled()
  })

  it('safely slices buffers in pushFrame for ArrayBuffer views and ClampedArrays', async () => {
    await sink.start({ width: 1280, height: 720, fps: 30 })
    mockStdin.write.mockClear()

    // 1. Uint8ClampedArray with byteOffset and byteLength
    const fullBuffer = new ArrayBuffer(16)
    const view = new Uint8ClampedArray(fullBuffer, 4, 8)
    view.set([1, 2, 3, 4, 5, 6, 7, 8])

    const ok = await sink.pushFrame({
      data: view,
      width: 1280,
      height: 720,
    })

    expect(ok).toBe(true)
    expect(mockStdin.write).toHaveBeenCalledTimes(1)
    const writtenBuffer = mockStdin.write.mock.calls[0][0] as Buffer
    expect(writtenBuffer.length).toBe(8)
    expect(Array.from(writtenBuffer)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('handles pushFrame when stopped or when backpressure occurs', async () => {
    // When stopped
    const stoppedOk = await sink.pushFrame({
      data: new Uint8Array([1, 2, 3]),
      width: 1280,
      height: 720,
    })
    expect(stoppedOk).toBe(false)

    // When active and queue length exceeds threshold (backpressure)
    await sink.start({ width: 1280, height: 720, fps: 30 })
    mockStdin.writableLength = 100 // > 3 * 2

    const drainedPromise = sink.pushFrame({
      data: new Uint8Array([1, 2, 3]),
      width: 1280,
      height: 720,
    })

    // Simulate drain
    const drainCallback = mockStdin.once.mock.calls.find((call) => call[0] === 'drain')?.[1]
    mockStdin.writableLength = 0
    drainCallback?.()

    const backpressureOk = await drainedPromise
    expect(backpressureOk).toBe(true)
  })

  it('stops cleanly and terminates child process', async () => {
    await sink.start({ width: 1280, height: 720, fps: 30 })
    expect(sink.isActive()).toBe(true)

    // Simulate close on proc after SIGTERM
    const stopPromise = sink.stop({ fallbackToStandby: false })
    mockProc.emit('close', 0)
    await stopPromise

    expect(sink.isActive()).toBe(false)
    expect(sink.isStandbyActive()).toBe(false)
    expect(mockStdin.end).toHaveBeenCalled()
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('keeps running idempotently when start() is called with identical configuration', async () => {
    const res1 = await sink.start({ width: 1280, height: 720, fps: 30 })
    expect(res1.success).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(1)

    // Call start again with exact matching configuration
    const res2 = await sink.start({ width: 1280, height: 720, fps: 30 })
    expect(res2.success).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(1) // Should not spawn a second process
  })

  it('ignores close event from previous process if newer process is active', async () => {
    await sink.start({ width: 1280, height: 720, fps: 30 })
    expect(sink.isActive()).toBe(true)

    // Create fake stale proc and emit close
    const staleProc = new EventEmitter()
    staleProc.emit('close', 0)

    // Sink should remain active
    expect(sink.isActive()).toBe(true)
  })

  it('starts idle standby slate at 1080p and seamlessly switches to live frames on start() without restarting FFmpeg', async () => {
    // 1. Start standby slate
    const standbyRes = await sink.startStandby({ width: 1920, height: 1080, fps: 30 })
    expect(standbyRes.success).toBe(true)
    expect(sink.isStandbyActive()).toBe(true)
    expect(sink.isActive()).toBe(false)
    expect(spawn).toHaveBeenCalledTimes(1)

    // In standby, pushFrame should return false
    const pushInStandby = await sink.pushFrame({
      data: new Uint8Array([1, 2, 3]),
      width: 1920,
      height: 1080,
    })
    expect(pushInStandby).toBe(false)

    // 2. Seamlessly switch to live streaming via start() with identical resolution
    const startRes = await sink.start({ width: 1920, height: 1080, fps: 30 })
    expect(startRes.success).toBe(true)
    expect(sink.isStandbyActive()).toBe(false)
    expect(sink.isActive()).toBe(true)
    // FFmpeg process MUST NOT be respawned (spawn called only once!)
    expect(spawn).toHaveBeenCalledTimes(1)

    // Now pushFrame should succeed
    const pushLive = await sink.pushFrame({
      data: new Uint8Array([1, 2, 3, 4]),
      width: 1920,
      height: 1080,
    })
    expect(pushLive).toBe(true)

    // 3. Fallback to standby on stop({ fallbackToStandby: true })
    await sink.stop({ fallbackToStandby: true })
    expect(sink.isStandbyActive()).toBe(true)
    expect(sink.isActive()).toBe(false)
    expect(mockProc.kill).not.toHaveBeenCalled()

    // 4. Complete stop on exit terminates process
    const stopPromise = sink.stop()
    mockProc.emit('close', 0)
    await stopPromise
    expect(sink.isStandbyActive()).toBe(false)
    expect(sink.isActive()).toBe(false)
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM')
  })
})
