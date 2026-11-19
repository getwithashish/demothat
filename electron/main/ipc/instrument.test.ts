import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { sanitizeValue, sanitizeIpcArgs, wrapHandler, wrapListener, instrumentIpcMain } from './instrument'

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import log from 'electron-log/main'

describe('IPC Instrument & Sanitization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sanitizes sensitive keys and large strings', () => {
    const sensitive = {
      token: 'secret-token-12345',
      apiKey: 'key-abc-xyz',
      password: 'mypassword',
      normalField: 'hello world',
      dataUrl: `data:image/png;base64,${'a'.repeat(300)}`,
      longString: 'x'.repeat(250),
    }

    const sanitized = sanitizeValue(sensitive) as Record<string, unknown>
    expect(sanitized.token).toBe('[REDACTED]')
    expect(sanitized.apiKey).toBe('[REDACTED]')
    expect(sanitized.password).toBe('[REDACTED]')
    expect(sanitized.normalField).toBe('hello world')
    expect(typeof sanitized.dataUrl).toBe('string')
    expect((sanitized.dataUrl as string).startsWith('[DataURL')).toBe(true)
    expect((sanitized.longString as string).endsWith('(250 chars)')).toBe(true)
  })

  it('sanitizes buffers and typed arrays without leaking byte dumps', () => {
    const buf = Buffer.from('hello buffer')
    const uint8 = new Uint8Array([1, 2, 3, 4, 5])
    const arrBuf = new ArrayBuffer(16)

    expect(sanitizeValue(buf)).toBe(`[Buffer ${buf.length} bytes]`)
    expect(sanitizeValue(uint8)).toBe('[Uint8Array 5 bytes]')
    expect(sanitizeValue(arrBuf)).toBe('[ArrayBuffer 16 bytes]')
    expect(sanitizeIpcArgs([buf, uint8])).toEqual([`[Buffer ${buf.length} bytes]`, '[Uint8Array 5 bytes]'])
  })

  it('guards against excessive depth', () => {
    const deepObj = {
      level1: {
        level2: {
          level3: {
            level4: 'too deep',
          },
        },
      },
    }

    const sanitized = sanitizeValue(deepObj) as { level1: { level2: { level3: unknown } } }
    expect(sanitized.level1.level2.level3).toBe('[Object (max depth)]')
  })

  it('wrapHandler logs duration, sanitized args, and returns result', async () => {
    const handler = vi.fn().mockResolvedValue({ status: 'ok' })
    const wrapped = wrapHandler('test:channel', handler)

    const event = {} as IpcMainInvokeEvent
    const result = await wrapped(event, { token: 'sensitive-token', project: 'my-project' })

    expect(result).toEqual({ status: 'ok' })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('[IPC] -> [test:channel] invoked'),
      expect.objectContaining({
        args: { token: '[REDACTED]', project: 'my-project' },
      }),
    )
    expect(log.info).toHaveBeenCalledWith(
      expect.stringMatching(/\[IPC\] <- \[test:channel\] completed in .*ms \(success\)/),
    )
  })

  it('wrapHandler logs error and rethrows when handler fails', async () => {
    const error = new Error('Database locked')
    const handler = vi.fn().mockRejectedValue(error)
    const wrapped = wrapHandler('test:failing-channel', handler)

    await expect(wrapped({} as IpcMainInvokeEvent, 'arg1')).rejects.toThrow('Database locked')
    expect(log.error).toHaveBeenCalledWith(
      expect.stringMatching(/\[IPC\] <- \[test:failing-channel\] failed in .*ms:/),
      error,
    )
  })

  it('wrapListener logs sync and async events', async () => {
    const listener = vi.fn()
    const wrapped = wrapListener('event:sync', listener)

    wrapped({} as IpcMainEvent, { sample: 123 })
    expect(listener).toHaveBeenCalledWith(expect.anything(), { sample: 123 })
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('[IPC] -> [event:sync] event received'),
      expect.anything(),
    )
    expect(log.info).toHaveBeenCalledWith(expect.stringMatching(/\[IPC\] <- \[event:sync\] event handled in .*ms/))
  })

  it('instrumentIpcMain patches ipc.handle and ipc.on', async () => {
    const handleFn = vi.fn()
    const onFn = vi.fn()
    const mockIpc = {
      handle: handleFn,
      on: onFn,
    } as unknown as typeof import('electron').ipcMain

    instrumentIpcMain(mockIpc)

    const myHandler = vi.fn()
    mockIpc.handle('my:channel', myHandler)
    expect(handleFn).toHaveBeenCalled()

    const myListener = vi.fn()
    mockIpc.on('my:event', myListener)
    expect(onFn).toHaveBeenCalled()
  })
})
