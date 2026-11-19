// IPC handler instrumentation and parameter sanitization.

import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import log from 'electron-log/main'

/** Keys whose values should be redacted for security and privacy. */
const SENSITIVE_KEYS = new Set([
  'token',
  'secret',
  'key',
  'password',
  'apikey',
  'licensekey',
  'credential',
  'authorization',
  'auth',
  'accesstoken',
  'refreshtoken',
])

/** High-frequency streaming channels to sample (log 1 out of 100 calls). */
const STREAMING_CHANNELS = new Set([
  'virtual-studio:push-frame',
  'virtual-studio:push-preview-frame',
  'virtual-studio:push-audio',
  'recording:write-screen-video',
  'recording:write-system-audio',
])

const streamCallCounters = new Map<string, number>()

/**
 * Sanitizes an argument value for structured logging.
 * Replaces large buffers, truncates long strings / data URLs, redacts sensitive keys,
 * and guards against deep or circular objects.
 */
export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (typeof value === 'function') {
    return '[Function]'
  }

  if (typeof value === 'bigint') {
    return `${value.toString()}n`
  }

  if (typeof value === 'string') {
    if (value.startsWith('data:image/') || value.startsWith('data:video/') || value.startsWith('data:audio/')) {
      const commaIndex = value.indexOf(',')
      const header = commaIndex > 0 ? value.slice(0, commaIndex) : value.slice(0, 30)
      return `[DataURL ${header}... (${value.length} chars)]`
    }
    if (value.length > 200) {
      return `${value.slice(0, 100)}... (${value.length} chars)`
    }
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return `[Buffer ${value.length} bytes]`
  }

  if (value instanceof ArrayBuffer) {
    return `[ArrayBuffer ${value.byteLength} bytes]`
  }

  if (ArrayBuffer.isView(value)) {
    return `[${value.constructor.name} ${value.byteLength} bytes]`
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }
  }

  if (depth >= 3) {
    return '[Object (max depth)]'
  }

  if (Array.isArray(value)) {
    if (value.length > 10) {
      return [...value.slice(0, 10).map((v) => sanitizeValue(v, depth + 1)), `... (+${value.length - 10} more items)`]
    }
    return value.map((v) => sanitizeValue(v, depth + 1))
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        result[k] = '[REDACTED]'
      } else {
        result[k] = sanitizeValue(v, depth + 1)
      }
    }
    return result
  }

  return String(value)
}

/**
 * Sanitizes arguments passed into an IPC handler or listener.
 */
export function sanitizeIpcArgs(args: unknown[]): unknown[] {
  return args.map((arg) => sanitizeValue(arg))
}

export type IpcHandlerFn = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown> | unknown
export type IpcListenerFn = (event: IpcMainEvent, ...args: unknown[]) => Promise<unknown> | void | unknown

/**
 * Wraps an `ipcMain.handle` handler function to log channel, sanitized args,
 * duration in milliseconds, and success or error status.
 */
export function wrapHandler<T extends IpcHandlerFn>(channel: string, handler: T): T {
  if ((handler as { __isInstrumented?: boolean }).__isInstrumented) {
    return handler
  }

  const instrumented = async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    const isStreaming = STREAMING_CHANNELS.has(channel)
    let shouldLog = true
    if (isStreaming) {
      const count = (streamCallCounters.get(channel) ?? 0) + 1
      streamCallCounters.set(channel, count)
      shouldLog = count % 100 === 1
    }

    const start = performance.now()
    if (shouldLog) {
      const sanitized = sanitizeIpcArgs(args)
      log.info(`[IPC] -> [${channel}] invoked${isStreaming ? ' (sampled 1/100)' : ''}`, {
        args: sanitized.length === 1 ? sanitized[0] : sanitized,
      })
    }

    try {
      const result = await handler(event, ...args)
      const durationMs = Math.round((performance.now() - start) * 100) / 100
      if (shouldLog) {
        log.info(`[IPC] <- [${channel}] completed in ${durationMs}ms (success)`)
      }
      return result
    } catch (error) {
      const durationMs = Math.round((performance.now() - start) * 100) / 100
      log.error(`[IPC] <- [${channel}] failed in ${durationMs}ms:`, error)
      throw error
    }
  }

  ;(instrumented as { __isInstrumented?: boolean }).__isInstrumented = true
  return instrumented as unknown as T
}

/**
 * Wraps an `ipcMain.on` listener function to log channel, sanitized args,
 * duration in milliseconds, and success or error status.
 */
export function wrapListener<T extends IpcListenerFn>(channel: string, listener: T): T {
  if ((listener as { __isInstrumented?: boolean }).__isInstrumented) {
    return listener
  }

  const instrumented = (event: IpcMainEvent, ...args: unknown[]) => {
    const isStreaming = STREAMING_CHANNELS.has(channel)
    let shouldLog = true
    if (isStreaming) {
      const count = (streamCallCounters.get(channel) ?? 0) + 1
      streamCallCounters.set(channel, count)
      shouldLog = count % 100 === 1
    }

    const start = performance.now()
    if (shouldLog) {
      const sanitized = sanitizeIpcArgs(args)
      log.info(`[IPC] -> [${channel}] event received${isStreaming ? ' (sampled 1/100)' : ''}`, {
        args: sanitized.length === 1 ? sanitized[0] : sanitized,
      })
    }

    try {
      const result = listener(event, ...args)
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        ;(result as Promise<unknown>)
          .then(() => {
            const durationMs = Math.round((performance.now() - start) * 100) / 100
            if (shouldLog) {
              log.info(`[IPC] <- [${channel}] async event handled in ${durationMs}ms`)
            }
          })
          .catch((error) => {
            const durationMs = Math.round((performance.now() - start) * 100) / 100
            log.error(`[IPC] <- [${channel}] async event failed in ${durationMs}ms:`, error)
          })
      } else {
        const durationMs = Math.round((performance.now() - start) * 100) / 100
        if (shouldLog) {
          log.info(`[IPC] <- [${channel}] event handled in ${durationMs}ms`)
        }
      }
      return result
    } catch (error) {
      const durationMs = Math.round((performance.now() - start) * 100) / 100
      log.error(`[IPC] <- [${channel}] event handler error in ${durationMs}ms:`, error)
      throw error
    }
  }

  ;(instrumented as { __isInstrumented?: boolean }).__isInstrumented = true
  return instrumented as unknown as T
}

let isIpcMainInstrumented = false

/**
 * Instruments Electron's `ipcMain.handle` and `ipcMain.on` so all registered handlers
 * automatically log channel name, sanitized input parameters, duration in ms, and success/error status.
 */
export function instrumentIpcMain(ipc = ipcMain): void {
  if (isIpcMainInstrumented) {
    return
  }
  isIpcMainInstrumented = true

  const originalHandle = ipc.handle.bind(ipc)
  const originalOn = ipc.on.bind(ipc)

  ipc.handle = ((channel: string, handler: IpcHandlerFn) => {
    return originalHandle(channel, wrapHandler(channel, handler))
  }) as typeof ipc.handle

  ipc.on = ((channel: string, listener: IpcListenerFn) => {
    return originalOn(channel, wrapListener(channel, listener))
  }) as typeof ipc.on
}
