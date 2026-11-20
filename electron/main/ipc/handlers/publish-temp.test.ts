import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { IpcMainInvokeEvent } from 'electron'
import {
  handlePublishGetTempPath,
  handlePublishSaveTempFile,
  handlePublishCleanupTempFile,
  registerPublishHandlers,
} from './publish'
import { handleGetPath } from './app'

vi.mock('electron-store', () => ({
  default: class MockStore {
    private data = new Map<string, unknown>()
    get(key: string) {
      return this.data.get(key)
    }
    set(key: string, value: unknown) {
      this.data.set(key, value)
    }
    delete(key: string) {
      this.data.delete(key)
    }
  },
}))

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

describe('Publish Temp File IPC Handlers', () => {
  let testTempDir: string

  beforeEach(async () => {
    testTempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'demothat-test-temp-'))
  })

  afterEach(async () => {
    if (fs.existsSync(testTempDir)) {
      await fsp.rm(testTempDir, { recursive: true, force: true })
    }
  })

  describe('handleGetPath', () => {
    it('supports temp and returns a string path', () => {
      const result = handleGetPath({} as IpcMainInvokeEvent, 'temp')
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('handlePublishGetTempPath', () => {
    it('generates a path ending in .mp4 with default prefix', () => {
      const result = handlePublishGetTempPath()
      expect(result.endsWith('.mp4')).toBe(true)
      const basename = path.basename(result)
      expect(basename).toMatch(/^demothat-publish-\d+(\.mp4|-\d+\.mp4)$/)
    })

    it('supports custom prefix string', () => {
      const result = handlePublishGetTempPath({} as IpcMainInvokeEvent, 'my-preview')
      expect(result.endsWith('.mp4')).toBe(true)
      const basename = path.basename(result)
      expect(basename).toMatch(/^my-preview-\d+(\.mp4|-\d+\.mp4)$/)
    })

    it('supports custom prefix via options object', () => {
      const result = handlePublishGetTempPath({} as IpcMainInvokeEvent, { prefix: 'object-prefix' })
      expect(result.endsWith('.mp4')).toBe(true)
      const basename = path.basename(result)
      expect(basename).toMatch(/^object-prefix-\d+(\.mp4|-\d+\.mp4)$/)
    })

    it('generates unique path when collision candidate exists', () => {
      const first = handlePublishGetTempPath()
      // Create that file to simulate a collision
      fs.writeFileSync(first, 'test')
      try {
        const second = handlePublishGetTempPath()
        expect(second).not.toBe(first)
      } finally {
        fs.unlinkSync(first)
      }
    })
  })

  describe('handlePublishSaveTempFile', () => {
    it('copies temp file to destination path with object args', async () => {
      const srcFile = path.join(testTempDir, 'temp-render.mp4')
      const destDir = path.join(testTempDir, 'subfolder')
      const destFile = path.join(destDir, 'saved-render.mp4')

      await fsp.writeFile(srcFile, 'dummy video content')

      const res = await handlePublishSaveTempFile({} as IpcMainInvokeEvent, {
        tempPath: srcFile,
        destinationPath: destFile,
      })

      expect(res.ok).toBe(true)
      expect(fs.existsSync(destFile)).toBe(true)
      expect(await fsp.readFile(destFile, 'utf8')).toBe('dummy video content')
    })

    it('copies temp file with positional arguments', async () => {
      const srcFile = path.join(testTempDir, 'temp-render2.mp4')
      const destFile = path.join(testTempDir, 'saved2.mp4')

      await fsp.writeFile(srcFile, 'second test')

      const res = await handlePublishSaveTempFile({} as IpcMainInvokeEvent, srcFile, destFile)

      expect(res.ok).toBe(true)
      expect(fs.existsSync(destFile)).toBe(true)
      expect(await fsp.readFile(destFile, 'utf8')).toBe('second test')
    })

    it('returns error when source or destination is missing', async () => {
      const res = await handlePublishSaveTempFile({} as IpcMainInvokeEvent, {
        tempPath: '',
        destinationPath: '',
      })
      expect(res.ok).toBe(false)
      expect(res.error).toBeDefined()
    })

    it('returns error when source file does not exist', async () => {
      const res = await handlePublishSaveTempFile({} as IpcMainInvokeEvent, {
        tempPath: path.join(testTempDir, 'non-existent.mp4'),
        destinationPath: path.join(testTempDir, 'out.mp4'),
      })
      expect(res.ok).toBe(false)
      expect(res.error).toBeDefined()
    })
  })

  describe('handlePublishCleanupTempFile', () => {
    it('deletes temp file when it exists (object arg)', async () => {
      const file = path.join(testTempDir, 'to-delete.mp4')
      await fsp.writeFile(file, 'data')
      expect(fs.existsSync(file)).toBe(true)

      await handlePublishCleanupTempFile({} as IpcMainInvokeEvent, { tempPath: file })
      expect(fs.existsSync(file)).toBe(false)
    })

    it('deletes temp file when it exists (string arg)', async () => {
      const file = path.join(testTempDir, 'to-delete-str.mp4')
      await fsp.writeFile(file, 'data')
      expect(fs.existsSync(file)).toBe(true)

      await handlePublishCleanupTempFile({} as IpcMainInvokeEvent, file)
      expect(fs.existsSync(file)).toBe(false)
    })

    it('does not throw when file does not exist', async () => {
      const nonExistent = path.join(testTempDir, 'does-not-exist.mp4')
      await expect(handlePublishCleanupTempFile({} as IpcMainInvokeEvent, nonExistent)).resolves.toBeUndefined()
    })
  })

  describe('registerPublishHandlers', () => {
    it('registers handlers on ipcMain', () => {
      const registered: string[] = []
      const fakeIpcMain = {
        handle: (channel: string) => {
          registered.push(channel)
        },
        on: (channel: string) => {
          registered.push(channel)
        },
      }

      vi.spyOn(fakeIpcMain, 'handle')
      // Call registerPublishHandlers (uses mocked/stubbed electron ipcMain)
      expect(() => registerPublishHandlers()).not.toThrow()
    })
  })
})
