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
  checkLinuxAudioSink,
  ensureLinuxAudioSink,
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

    it('teardownLinuxAudioSink unloads both demothat_sink and demothat_mic modules from PulseAudio/PipeWire', async () => {
      const unloaded: string[] = []
      mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
        if (args[0] === 'list') {
          // Output simulating pactl list short modules
          const sampleOutput = `12\tmodule-always-sink\t\n42\tmodule-null-sink\tsink_name=demothat_sink\tsink_properties=device.description=DemoThat_Virtual_Audio_Backend\n43\tmodule-remap-source\tmaster=demothat_sink.monitor source_name=demothat_mic source_properties=device.description=DemoThat_Virtual_Microphone\n55\tmodule-native-protocol-unix\t\n`
          cb(null, sampleOutput, '')
        } else if (args[0] === 'unload-module') {
          unloaded.push(args[1])
          cb(null, '', '')
        } else {
          cb(new Error(`unexpected exec: ${file} ${args.join(' ')}`), '', '')
        }
      })

      const res = await teardownLinuxAudioSink()
      expect(res.success).toBe(true)
      expect(unloaded).toEqual(['42', '43'])
    })

    it('teardownLinuxCameraDriver handles sudo failure gracefully without throwing', async () => {
      mockExecFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        const err = new Error('Module v4l2loopback is in use') as Error & { code?: number }
        err.code = 1
        cb(err, '', 'Module is in use')
      })

      const res = await teardownLinuxCameraDriver()
      expect(res.success).toBe(false)
      expect(res.error).toContain('Module is in use')
    })

    it('teardownLinuxAudioSink succeeds when no demothat modules are loaded', async () => {
      mockExecFile.mockImplementation((file: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        expect(file).toBe('pactl')
        cb(null, '12\tmodule-always-sink\t\n', '')
      })

      const res = await teardownLinuxAudioSink()
      expect(res.success).toBe(true)
    })

    describe('checkLinuxAudioSink', () => {
      it('returns true when demothat_mic source and demothat_sink sink exist', async () => {
        mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
          expect(file).toBe('pactl')
          if (args[0] === 'list' && args[2] === 'sources') {
            cb(null, '51\talldev\n8890\tdemothat_mic\tPipeWire\n', '')
          } else if (args[0] === 'list' && args[2] === 'sinks') {
            cb(null, '51\talldev\n8883\tdemothat_sink\tPipeWire\n', '')
          } else {
            cb(new Error(`unexpected exec: ${file} ${args.join(' ')}`), '', '')
          }
        })

        const res = await checkLinuxAudioSink()
        expect(res).toBe(true)
      })

      it('returns false when demothat_mic source is missing', async () => {
        mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
          expect(file).toBe('pactl')
          if (args[0] === 'list' && args[2] === 'sources') {
            cb(null, '51\tdefault_source\n', '')
          } else if (args[0] === 'list' && args[2] === 'sinks') {
            cb(null, '8883\tdemothat_sink\tPipeWire\n', '')
          } else {
            cb(new Error(`unexpected exec: ${file} ${args.join(' ')}`), '', '')
          }
        })

        const res = await checkLinuxAudioSink()
        expect(res).toBe(false)
      })

      it('returns false when demothat_sink sink is missing', async () => {
        mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
          expect(file).toBe('pactl')
          if (args[0] === 'list' && args[2] === 'sources') {
            cb(null, '8890\tdemothat_mic\tPipeWire\n', '')
          } else if (args[0] === 'list' && args[2] === 'sinks') {
            cb(null, '51\tdefault_sink\n', '')
          } else {
            cb(new Error(`unexpected exec: ${file} ${args.join(' ')}`), '', '')
          }
        })

        const res = await checkLinuxAudioSink()
        expect(res).toBe(false)
      })

      it('returns false on error', async () => {
        mockExecFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
          cb(new Error('pactl not found'), '', 'command not found')
        })

        const res = await checkLinuxAudioSink()
        expect(res).toBe(false)
      })
    })

    describe('ensureLinuxAudioSink', () => {
      it('enforces unmute & 100% volume when demothat_mic sink already exists', async () => {
        const executedCommands: string[][] = []
        mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
          expect(file).toBe('pactl')
          executedCommands.push(args)
          if (args[0] === 'list' && args[2] === 'sinks') {
            cb(null, '8883\tdemothat_mic\tPipeWire\n', '')
          } else if (
            (args[0] === 'set-source-mute' && args[2] === '0') ||
            (args[0] === 'set-source-volume' && args[2] === '65536') ||
            (args[0] === 'set-sink-mute' && args[2] === '0') ||
            (args[0] === 'set-sink-volume' && args[2] === '65536')
          ) {
            cb(null, '', '')
          } else {
            cb(new Error(`unexpected command ${args.join(' ')}`), '', '')
          }
        })

        const res = await ensureLinuxAudioSink()
        expect(res.success).toBe(true)
        expect(executedCommands[0]).toEqual(['list', 'short', 'sinks'])
      })

      it('creates module-null-sink demothat_mic when sink is missing', async () => {
        const executedCommands: string[][] = []
        mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
          expect(file).toBe('pactl')
          executedCommands.push(args)
          if (args[0] === 'list' && args[2] === 'sinks') {
            cb(null, '51\tdefault_sink\n', '')
          } else if (args[0] === 'load-module' && args[1] === 'module-null-sink') {
            expect(args).toEqual([
              'load-module',
              'module-null-sink',
              'sink_name=demothat_mic',
              'sink_properties=device.description=DemoThat_Virtual_Microphone',
            ])
            cb(null, '101\n', '')
          } else if (
            (args[0] === 'set-source-mute' && args[2] === '0') ||
            (args[0] === 'set-source-volume' && args[2] === '65536') ||
            (args[0] === 'set-sink-mute' && args[2] === '0') ||
            (args[0] === 'set-sink-volume' && args[2] === '65536')
          ) {
            cb(null, '', '')
          } else {
            cb(new Error(`unexpected command ${args.join(' ')}`), '', '')
          }
        })

        const res = await ensureLinuxAudioSink()
        expect(res.success).toBe(true)
        expect(executedCommands[0]).toEqual(['list', 'short', 'sinks'])
        expect(executedCommands[1][1]).toBe('module-null-sink')
      })

      it('returns error if loading module-null-sink fails', async () => {
        mockExecFile.mockImplementation((_file: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
          if (args[0] === 'list' && args[2] === 'sinks') {
            cb(null, '', '')
          } else if (args[0] === 'load-module' && args[1] === 'module-null-sink') {
            const err = new Error('load failed') as Error & { code?: number }
            err.code = 1
            cb(err, '', 'Failed to load module')
          } else {
            cb(null, '', '')
          }
        })

        const res = await ensureLinuxAudioSink()
        expect(res.success).toBe(false)
        expect(res.error).toContain('Failed to load module')
      })
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
            'max_buffers=4',
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
