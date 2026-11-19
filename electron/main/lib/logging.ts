// Sets up the logging system and environment-specific transports.

import { app } from 'electron'
import log from 'electron-log/main'
import fs from 'node:fs'
import path from 'node:path'
import { startSystemResourceProbe } from './system-resource-probe'

export type LogEnvironment = 'development' | 'staging' | 'production'

/**
 * Detects the runtime environment:
 * - staging: DEMOTHAT_ENV === 'staging' or NODE_ENV === 'staging'
 * - development: !app.isPackaged or NODE_ENV === 'development'
 * - production: app.isPackaged and not staging
 */
export function getLogEnvironment(): LogEnvironment {
  const isStaging = process.env.DEMOTHAT_ENV === 'staging' || process.env.NODE_ENV === 'staging'
  if (isStaging) {
    return 'staging'
  }

  const isPackaged = typeof app !== 'undefined' && Boolean(app.isPackaged)
  const isDevelopment = !isPackaged || process.env.NODE_ENV === 'development'
  if (isDevelopment) {
    return 'development'
  }

  return 'production'
}

/**
 * Custom log rotation function keeping up to maxFiles (default 3):
 * active file -> .1 -> .2 (oldest discarded)
 */
export function rotateLogFiles(file: { toString(): string }, maxFiles = 3): void {
  try {
    const filePath = file.toString()
    const dir = path.dirname(filePath)
    const ext = path.extname(filePath)
    const base = path.basename(filePath, ext)

    const maxArchives = maxFiles - 1
    const oldest = path.join(dir, `${base}.${maxArchives}${ext}`)
    if (fs.existsSync(oldest)) {
      fs.rmSync(oldest, { force: true })
    }

    for (let i = maxArchives - 1; i >= 1; i--) {
      const src = path.join(dir, `${base}.${i}${ext}`)
      const dst = path.join(dir, `${base}.${i + 1}${ext}`)
      if (fs.existsSync(src)) {
        fs.renameSync(src, dst)
      }
    }

    const first = path.join(dir, `${base}.1${ext}`)
    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, first)
    }
  } catch (error) {
    // If rotation fails, log to console safely
    console.error('Failed to rotate log files:', error)
  }
}

let isLoggingSetup = false

export function resetLoggingSetupForTesting(): void {
  isLoggingSetup = false
}

export function setupLogging(): void {
  if (isLoggingSetup) {
    return
  }
  isLoggingSetup = true

  // Call log.initialize() for electron-log v5 IPC bridging
  try {
    log.initialize()
  } catch (error) {
    console.error('Failed to initialize electron-log IPC bridge:', error)
  }

  const env = getLogEnvironment()
  const logFormat = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [{scope}] {text}'

  log.transports.console.format = logFormat
  log.transports.file.format = logFormat

  if (env === 'development') {
    // Development: Console level 'silly'/'debug', format '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [{scope}] {text}', file level 'debug' (5MB).
    log.transports.console.level = 'debug'
    log.transports.file.level = 'debug'
    log.transports.file.maxSize = 5 * 1024 * 1024 // 5 MB

    // Start 10s system resource probe in development (unless running unit tests)
    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
      startSystemResourceProbe(10000)
    }
  } else if (env === 'staging') {
    // Staging: Console level 'info', file level 'info' (10MB).
    log.transports.console.level = 'info'
    log.transports.file.level = 'info'
    log.transports.file.maxSize = 10 * 1024 * 1024 // 10 MB
  } else {
    // Production: Console level 'warn'/'error', file level 'info' (10MB, keep 3 files).
    log.transports.console.level = 'warn'
    log.transports.file.level = 'info'
    log.transports.file.maxSize = 10 * 1024 * 1024 // 10 MB
    log.transports.file.archiveLogFn = (file) => rotateLogFiles(file, 3)
  }

  process.on('uncaughtException', (error) => {
    log.error('Unhandled Exception:', error)
  })

  process.on('unhandledRejection', (reason, promise) => {
    log.error('Unhandled Rejection at:', promise, 'reason:', reason)
  })

  log.info(`[Logging] Logging initialized (${env} environment).`)
}

export function createScopedLogger(scope: string) {
  return log.scope(scope)
}

export { log }
export default log
