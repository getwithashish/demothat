import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

const mockStdin = Object.assign(new EventEmitter(), {
  write: vi.fn().mockReturnValue(true),
  end: vi.fn(),
  writable: true,
  destroyed: false,
})

const mockProc = Object.assign(new EventEmitter(), {
  stdin: mockStdin,
  kill: vi.fn(),
  killed: false,
})

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockProc),
}))

vi.mock('../../lib/utils', () => ({
  getFFmpegPath: vi.fn(() => '/mock/bin/ffmpeg'),
}))

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import { VirtualAudioSink } from './virtual-audio-sink'
import log from 'electron-log/main'
import { spawn } from 'node:child_process'

describe('VirtualAudioSink', () => {
  let sink: VirtualAudioSink

  beforeEach(() => {
    vi.clearAllMocks()
    mockProc.removeAllListeners()
    mockStdin.removeAllListeners()
    mockStdin.writable = true
    sink = new VirtualAudioSink()
  })

  it('spawns pacat on Linux with default demothat_mic when deviceSinkName is omitted', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

    try {
      const result = await sink.start({ sampleRate: 48000, channels: 2 })
      expect(result.success).toBe(true)
      expect(sink.isActive()).toBe(true)

      expect(spawn).toHaveBeenCalledWith('pacat', [
        '--playback',
        '--format=s16le',
        '--rate=48000',
        '--channels=2',
        '--device=demothat_mic',
      ])

      // Verify pacat process error handler is attached
      mockProc.emit('error', new Error('pacat runtime failure'))
      expect(log.error).toHaveBeenCalledWith('[VirtualAudioSink] pacat process error:', expect.any(Error))
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    }
  })

  it('spawns pacat on Linux with explicit deviceSinkName', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

    try {
      const result = await sink.start({ sampleRate: 48000, channels: 2, deviceSinkName: 'custom_sink' })
      expect(result.success).toBe(true)
      expect(sink.isActive()).toBe(true)

      expect(spawn).toHaveBeenCalledWith('pacat', [
        '--playback',
        '--format=s16le',
        '--rate=48000',
        '--channels=2',
        '--device=custom_sink',
      ])
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    }
  })

  it('correctly handles buffer slicing for Buffer, ArrayBuffer, and Uint8Array with byteOffset', async () => {
    await sink.start()

    // 1. Plain Buffer
    const buf = Buffer.from([1, 2, 3, 4])
    await sink.pushAudio(buf)
    expect(mockStdin.write).toHaveBeenLastCalledWith(buf)

    // 2. ArrayBuffer
    const arrayBuffer = new ArrayBuffer(4)
    const view = new Uint8Array(arrayBuffer)
    view.set([5, 6, 7, 8])
    await sink.pushAudio(arrayBuffer)
    expect(mockStdin.write).toHaveBeenLastCalledWith(Buffer.from(arrayBuffer))

    // 3. Uint8Array with non-zero byteOffset and custom byteLength
    const bigBuffer = new ArrayBuffer(16)
    const subView = new Uint8Array(bigBuffer, 4, 4)
    subView.set([10, 20, 30, 40])
    await sink.pushAudio(subView)
    const expectedSubBuffer = Buffer.from(subView.buffer, subView.byteOffset, subView.byteLength)
    expect(mockStdin.write).toHaveBeenLastCalledWith(expectedSubBuffer)
    expect(sink.getChunksWritten()).toBe(3)
  })

  it('does not write audio chunks to stdin when muted', async () => {
    await sink.start()
    sink.setMuted(true)
    expect(sink.isMuted()).toBe(true)

    const buf = Buffer.from([1, 2, 3, 4])
    const written = await sink.pushAudio(buf)
    expect(written).toBe(true)
    expect(mockStdin.write).not.toHaveBeenCalled()
  })

  it('stops cleanly and terminates child process', async () => {
    await sink.start()
    expect(sink.isActive()).toBe(true)

    const stopPromise = sink.stop()
    mockProc.emit('close', 0)
    await stopPromise

    expect(sink.isActive()).toBe(false)
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('tracks audio buffer metrics, total bytes written, and queue depth', async () => {
    await sink.start()
    const buf = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])

    await sink.pushAudio(buf)
    expect(sink.getChunksWritten()).toBe(1)
    expect(sink.getTotalBytesWritten()).toBe(8)

    const metrics = sink.getMetrics()
    expect(metrics.chunksWritten).toBe(1)
    expect(metrics.totalBytesWritten).toBe(8)
    expect(metrics.underflowCount).toBe(0)
    expect(metrics.overflowCount).toBe(0)

    const stopPromise = sink.stop()
    mockProc.emit('close', 0)
    await stopPromise
  })

  it('writes silence buffer to stdin when silence keep-alive interval detects gap >= 120ms', async () => {
    vi.useFakeTimers()
    try {
      await sink.start()
      mockStdin.write.mockClear()

      // Push initial audio chunk to establish lastChunkTime
      const buf = Buffer.from([1, 2, 3, 4])
      await sink.pushAudio(buf)
      expect(mockStdin.write).toHaveBeenCalledWith(buf)
      mockStdin.write.mockClear()

      // Advance time by 60ms: gap is 60ms (<120ms threshold), no silence should be written yet
      vi.advanceTimersByTime(60)
      expect(mockStdin.write).not.toHaveBeenCalled()

      // Advance time by another 70ms (total gap: 130ms >= 120ms threshold): silence watchdog should fire
      vi.advanceTimersByTime(70)
      expect(mockStdin.write).toHaveBeenCalledTimes(1)
      const silenceArg = mockStdin.write.mock.calls[0][0] as Buffer
      expect(Buffer.isBuffer(silenceArg)).toBe(true)
      expect(silenceArg.length).toBe(4096)
      // Verify silence is all zeroes
      expect(silenceArg.every((byte) => byte === 0)).toBe(true)
    } finally {
      const stopPromise = sink.stop()
      mockProc.emit('close', 0)
      await stopPromise
      vi.useRealTimers()
    }
  })

  it('does not write silence buffer when audio sink is muted or inactive', async () => {
    vi.useFakeTimers()
    try {
      await sink.start()
      sink.setMuted(true)
      mockStdin.write.mockClear()

      // Push audio while muted
      await sink.pushAudio(Buffer.from([1, 2, 3, 4]))

      // Advance time past keep-alive threshold
      vi.advanceTimersByTime(200)
      expect(mockStdin.write).not.toHaveBeenCalled()
    } finally {
      const stopPromise = sink.stop()
      mockProc.emit('close', 0)
      await stopPromise
      vi.useRealTimers()
    }
  })
})
