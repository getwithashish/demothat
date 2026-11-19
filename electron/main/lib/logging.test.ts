import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import log from 'electron-log/main'
import {
  getLogEnvironment,
  rotateLogFiles,
  setupLogging,
  createScopedLogger,
  resetLoggingSetupForTesting,
} from './logging'

describe('logging infrastructure', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    resetLoggingSetupForTesting()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('getLogEnvironment', () => {
    it('detects staging from DEMOTHAT_ENV', () => {
      process.env.DEMOTHAT_ENV = 'staging'
      delete process.env.NODE_ENV
      expect(getLogEnvironment()).toBe('staging')
    })

    it('detects staging from NODE_ENV', () => {
      delete process.env.DEMOTHAT_ENV
      process.env.NODE_ENV = 'staging'
      expect(getLogEnvironment()).toBe('staging')
    })

    it('detects development when NODE_ENV is development', () => {
      delete process.env.DEMOTHAT_ENV
      process.env.NODE_ENV = 'development'
      expect(getLogEnvironment()).toBe('development')
    })

    it('defaults to development when unpackaged in non-staging', () => {
      delete process.env.DEMOTHAT_ENV
      delete process.env.NODE_ENV
      expect(getLogEnvironment()).toBe('development')
    })
  })

  describe('rotateLogFiles', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demothat-log-rot-test-'))
    })

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('keeps at most 3 files during multiple rotations', () => {
      const logFile = path.join(tmpDir, 'main.log')

      // 1. Initial file
      fs.writeFileSync(logFile, 'file 0\n')
      rotateLogFiles(logFile, 3)
      // Now main.1.log exists, main.log was renamed
      expect(fs.existsSync(path.join(tmpDir, 'main.1.log'))).toBe(true)

      // 2. Second file
      fs.writeFileSync(logFile, 'file 1\n')
      rotateLogFiles(logFile, 3)
      // Now main.2.log and main.1.log exist
      expect(fs.existsSync(path.join(tmpDir, 'main.2.log'))).toBe(true)
      expect(fs.existsSync(path.join(tmpDir, 'main.1.log'))).toBe(true)

      // 3. Third file
      fs.writeFileSync(logFile, 'file 2\n')
      rotateLogFiles(logFile, 3)
      // Still at most main.2.log, main.1.log
      const files = fs.readdirSync(tmpDir).filter((f) => f.startsWith('main.'))
      expect(files.sort()).toEqual(['main.1.log', 'main.2.log'])

      // 4. Fourth file - active + 2 archives = 3 files total
      fs.writeFileSync(logFile, 'file 3\n')
      const totalFiles = fs.readdirSync(tmpDir).filter((f) => f.startsWith('main.'))
      expect(totalFiles.sort()).toEqual(['main.1.log', 'main.2.log', 'main.log'])
      expect(totalFiles.length).toBe(3)
    })
  })

  describe('setupLogging', () => {
    it('configures development transport levels and formats', () => {
      process.env.NODE_ENV = 'development'
      delete process.env.DEMOTHAT_ENV

      setupLogging()

      expect(log.transports.console.level).toBe('debug')
      expect(log.transports.file.level).toBe('debug')
      expect(log.transports.file.maxSize).toBe(5 * 1024 * 1024)
      expect(log.transports.console.format).toBe('[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [{scope}] {text}')
    })

    it('configures staging transport levels and 10MB file limit', () => {
      process.env.DEMOTHAT_ENV = 'staging'

      setupLogging()

      expect(log.transports.console.level).toBe('info')
      expect(log.transports.file.level).toBe('info')
      expect(log.transports.file.maxSize).toBe(10 * 1024 * 1024)
    })

    it('creates scoped loggers correctly', () => {
      const scoped = createScopedLogger('test-scope')
      expect(typeof scoped.debug).toBe('function')
      expect(typeof scoped.info).toBe('function')
      expect(typeof scoped.warn).toBe('function')
      expect(typeof scoped.error).toBe('function')
    })
  })
})
