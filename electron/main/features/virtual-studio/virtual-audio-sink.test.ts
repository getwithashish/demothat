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
})
