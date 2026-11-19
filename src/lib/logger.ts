// Centralized renderer logger wrapper around electron-log/renderer with test fallback.

import electronLog from 'electron-log/renderer'

export interface ScopedLogger {
  debug: (...data: unknown[]) => void
  info: (...data: unknown[]) => void
  warn: (...data: unknown[]) => void
  error: (...data: unknown[]) => void
  verbose: (...data: unknown[]) => void
}

function isTestEnvironment(): boolean {
  if (typeof process !== 'undefined') {
    if (process.env?.NODE_ENV === 'test' || Boolean(process.env?.VITEST)) {
      return true
    }
  }
  return false
}

function hasElectronLogBridge(): boolean {
  return typeof window !== 'undefined' && Boolean((window as unknown as { __electronLog?: unknown }).__electronLog)
}

export function createScopedLogger(scope: string): ScopedLogger {
  const prefix = `[${scope}]`

  return {
    debug: (...data: unknown[]) => {
      if (!isTestEnvironment() && hasElectronLogBridge()) {
        try {
          electronLog.scope(scope).debug(...data)
          return
        } catch {
          // fallback to console
        }
      }
      console.debug(prefix, ...data)
    },
    info: (...data: unknown[]) => {
      if (!isTestEnvironment() && hasElectronLogBridge()) {
        try {
          electronLog.scope(scope).info(...data)
          return
        } catch {
          // fallback to console
        }
      }
      console.info(prefix, ...data)
    },
    warn: (...data: unknown[]) => {
      if (!isTestEnvironment() && hasElectronLogBridge()) {
        try {
          electronLog.scope(scope).warn(...data)
          return
        } catch {
          // fallback to console
        }
      }
      console.warn(prefix, ...data)
    },
    error: (...data: unknown[]) => {
      if (!isTestEnvironment() && hasElectronLogBridge()) {
        try {
          electronLog.scope(scope).error(...data)
          return
        } catch {
          // fallback to console
        }
      }
      console.error(prefix, ...data)
    },
    verbose: (...data: unknown[]) => {
      if (!isTestEnvironment() && hasElectronLogBridge()) {
        try {
          electronLog.scope(scope).verbose(...data)
          return
        } catch {
          // fallback to console
        }
      }
      console.debug(prefix, ...data)
    },
  }
}

export const logger = createScopedLogger('renderer')
export default logger
