import { describe, expect, it, vi, beforeEach } from 'vitest'
import { generateFastIntraProxy } from './fast-intra-proxy'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import EventEmitter from 'node:events'

vi.mock('node:fs')
vi.mock('node:child_process')
vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe('fast-intra-proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns original path immediately if sourcePath does not exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const result = await generateFastIntraProxy({
      sourcePath: '/path/to/missing.mp4',
      sessionDir: '/tmp/session',
      label: 'screen',
    })
    expect(result).toBe('/path/to/missing.mp4')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('spawns FFmpeg with keyint=1 and returns proxy path on success', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('missing')) return false
      return true
    })
    vi.mocked(fs.statSync).mockReturnValue({ size: 1024 * 1024 * 5 } as fs.Stats)

    const mockProc = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter
    }
    mockProc.stderr = new EventEmitter()

    vi.mocked(spawn).mockImplementation((() => {
      setTimeout(() => {
        mockProc.emit('close', 0)
      }, 5)
      return mockProc as unknown as ReturnType<typeof spawn>
    }) as unknown as typeof spawn)

    const result = await generateFastIntraProxy({
      sourcePath: '/path/to/source.mp4',
      sessionDir: '/tmp/session',
      label: 'screen',
      ffmpegPath: 'ffmpeg',
    })

    expect(result).toMatch(/\/tmp\/session\/intra_screen_\d+\.mp4/)
    expect(spawn).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining(['-i', '/path/to/source.mp4', '-c:v', 'libx264', '-g', '1', '-preset', 'ultrafast']),
    )
  })

  it('falls back to source path if FFmpeg exits with non-zero code', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)

    const mockProc = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter
    }
    mockProc.stderr = new EventEmitter()

    vi.mocked(spawn).mockImplementation((() => {
      setTimeout(() => {
        mockProc.emit('close', 1)
      }, 5)
      return mockProc as unknown as ReturnType<typeof spawn>
    }) as unknown as typeof spawn)

    const result = await generateFastIntraProxy({
      sourcePath: '/path/to/source.mp4',
      sessionDir: '/tmp/session',
      label: 'screen',
    })

    expect(result).toBe('/path/to/source.mp4')
  })

  it('falls back to source path if FFmpeg emits an error', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)

    const mockProc = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter
    }
    mockProc.stderr = new EventEmitter()

    vi.mocked(spawn).mockImplementation((() => {
      setTimeout(() => {
        mockProc.emit('error', new Error('spawn ENOENT'))
      }, 5)
      return mockProc as unknown as ReturnType<typeof spawn>
    }) as unknown as typeof spawn)

    const result = await generateFastIntraProxy({
      sourcePath: '/path/to/source.mp4',
      sessionDir: '/tmp/session',
      label: 'screen',
    })

    expect(result).toBe('/path/to/source.mp4')
  })
})
