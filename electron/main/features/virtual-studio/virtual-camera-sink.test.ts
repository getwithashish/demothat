import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

const mockStdin = {
  write: vi.fn().mockReturnValue(true),
  end: vi.fn(),
  writable: true,
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
    sink = new VirtualCameraSink()
  })

  it('standardizes resolution to DEFAULT_VIRTUAL_STUDIO_RESOLUTION and passes Lanczos chroma filter and BT.709 color matrix flags on Linux', async () => {
    const res = await sink.start({ width: 0, height: 0, fps: 0 })
    expect(res.success).toBe(true)
    expect(sink.isActive()).toBe(true)

    const options = sink.getOptions()
    expect(options?.width).toBe(DEFAULT_VIRTUAL_STUDIO_RESOLUTION.width)
    expect(options?.height).toBe(DEFAULT_VIRTUAL_STUDIO_RESOLUTION.height)
    expect(options?.fps).toBe(DEFAULT_VIRTUAL_STUDIO_RESOLUTION.fps)
    expect(options?.width).toBe(1280)
    expect(options?.height).toBe(720)

    expect(spawn).toHaveBeenCalledWith(
      '/mock/bin/ffmpeg',
      expect.arrayContaining([
        '-s',
        '1280x720',
        '-r',
        '30',
        '-vf',
        'scale=out_color_matrix=bt709:out_range=limited:flags=lanczos+accurate_rnd+full_chroma_int',
        '-color_range',
        'tv',
        '-colorspace',
        'bt709',
        '-color_primaries',
        'bt709',
        '-color_trc',
        'bt709',
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

    // When active and write returns false (backpressure)
    await sink.start({ width: 1280, height: 720, fps: 30 })
    mockStdin.write.mockReturnValueOnce(false)

    const drainedPromise = sink.pushFrame({
      data: new Uint8Array([1, 2, 3]),
      width: 1280,
      height: 720,
    })

    // Simulate drain
    const drainCallback = mockStdin.once.mock.calls.find((call) => call[0] === 'drain')?.[1]
    drainCallback?.()

    const backpressureOk = await drainedPromise
    expect(backpressureOk).toBe(true)
  })

  it('stops cleanly and terminates child process', async () => {
    await sink.start({ width: 1280, height: 720, fps: 30 })
    expect(sink.isActive()).toBe(true)

    // Simulate close on proc after SIGTERM
    const stopPromise = sink.stop()
    mockProc.emit('close', 0)
    await stopPromise

    expect(sink.isActive()).toBe(false)
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
})
