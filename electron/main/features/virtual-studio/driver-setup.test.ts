import { describe, expect, it, vi, beforeEach } from 'vitest'

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void

const mockExecFile = vi.fn()

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}))

vi.mock('node:fs', () => ({
  promises: {
    access: vi.fn(),
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
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

import {
  ensureLinuxCameraDriver,
  teardownLinuxCameraDriver,
  teardownLinuxAudioSink,
  installLinuxDriver,
} from './driver-setup'
import { promises as fs } from 'node:fs'

describe('driver-setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Linux Driver Teardown & Lifecycle', () => {
    it('teardownLinuxCameraDriver unloads v4l2loopback kernel module via passwordless sudo', async () => {
      mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
        expect(file).toBe('sudo')
        expect(args).toEqual(['-n', 'modprobe', '-r', 'v4l2loopback'])
        cb(null, '', '')
      })

      const res = await teardownLinuxCameraDriver()
      expect(res.success).toBe(true)
    })

    it('teardownLinuxAudioSink unloads demothat_mic module from PulseAudio/PipeWire', async () => {
      mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
        if (args[0] === 'list') {
          // Output simulating pactl list short modules
          const sampleOutput = `12\tmodule-always-sink\t\n42\tmodule-null-sink\tsink_name=demothat_mic\tsink_properties=device.description=DemoThat_Virtual_Microphone\n55\tmodule-native-protocol-unix\t\n`
          cb(null, sampleOutput, '')
        } else if (args[0] === 'unload-module') {
          expect(args[1]).toBe('42')
          cb(null, '', '')
        } else {
          cb(new Error(`unexpected exec: ${file} ${args.join(' ')}`), '', '')
        }
      })

      const res = await teardownLinuxAudioSink()
      expect(res.success).toBe(true)
    })

    it('ensureLinuxCameraDriver checks camera status and executes passwordless sudo if needed', async () => {
      // Driver not loaded initially
      vi.mocked(fs.access).mockRejectedValueOnce(new Error('ENOENT'))
      mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
        if (file === 'lsmod') {
          cb(null, 'snd_pcm 12345 1', '')
        } else if (file === 'sudo') {
          expect(args).toEqual([
            '-n',
            'modprobe',
            'v4l2loopback',
            'video_nr=10',
            'card_label=DemoThat Virtual Camera',
            'exclusive_caps=1',
          ])
          cb(null, '', '')
        } else {
          cb(null, '', '')
        }
      })

      const res = await ensureLinuxCameraDriver()
      expect(res.success).toBe(true)
    })

    it('installLinuxDriver sets up v4l2loopback and creates passwordless sudoers rule via pkexec', async () => {
      mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
        if (file === 'pkexec') {
          expect(args[0]).toBe('sh')
          expect(args[2]).toContain('modprobe v4l2loopback')
          expect(args[2]).toContain('/etc/sudoers.d/demothat-v4l2')
          cb(null, '', '')
        } else if (file === 'pactl') {
          cb(null, '', '')
        } else {
          cb(null, '', '')
        }
      })

      const res = await installLinuxDriver()
      expect(res.success).toBe(true)
    })
  })
})
