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

    it('teardownLinuxAudioSink unloads both demothat_virtual_mic and demothat_mic modules from PulseAudio/PipeWire', async () => {
      const unloaded: string[] = []
      mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
        if (args[0] === 'list') {
          // Output simulating pactl list short modules
          const sampleOutput = `12\tmodule-always-sink\t\n42\tmodule-null-sink\tsink_name=demothat_mic\tsink_properties=device.description=DemoThat_Virtual_Audio\n43\tmodule-remap-source\tmaster=demothat_mic.monitor source_name=demothat_virtual_mic source_properties=device.description=DemoThat_Virtual_Microphone\n55\tmodule-native-protocol-unix\t\n`
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

    describe('checkLinuxAudioSink', () => {
      it('returns true when demothat_virtual_mic source exists', async () => {
        mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
          expect(file).toBe('pactl')
          expect(args).toEqual(['list', 'short', 'sources'])
          cb(null, '51\talldev\n8890\tdemothat_virtual_mic\tPipeWire\n', '')
        })

        const res = await checkLinuxAudioSink()
        expect(res).toBe(true)
      })

      it('returns true when demothat_mic source monitor exists', async () => {
        mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
          expect(file).toBe('pactl')
          expect(args).toEqual(['list', 'short', 'sources'])
          cb(null, '8883\tdemothat_mic.monitor\tPipeWire\n', '')
        })

        const res = await checkLinuxAudioSink()
        expect(res).toBe(true)
      })

      it('returns false when neither demothat_virtual_mic nor demothat_mic is in sources', async () => {
        mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
          expect(file).toBe('pactl')
          expect(args).toEqual(['list', 'short', 'sources'])
          cb(null, '51\talsa_output.sink.monitor\tPipeWire\n', '')
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
      it('returns success immediately if demothat_virtual_mic source already exists', async () => {
        mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
          expect(file).toBe('pactl')
          expect(args).toEqual(['list', 'short', 'sources'])
          cb(null, '8890\tdemothat_virtual_mic\tPipeWire\n', '')
        })

        const res = await ensureLinuxAudioSink()
        expect(res.success).toBe(true)
        expect(mockExecFile).toHaveBeenCalledTimes(1)
      })

      it('creates both null sink and remap-source when neither exists', async () => {
        const executedCommands: string[][] = []
        mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
          expect(file).toBe('pactl')
          executedCommands.push(args)
          if (args[0] === 'list' && args[2] === 'sources') {
            cb(null, '51\tdefault_source\n', '')
          } else if (args[0] === 'list' && args[2] === 'sinks') {
            cb(null, '51\tdefault_sink\n', '')
          } else if (args[0] === 'load-module' && args[1] === 'module-null-sink') {
            expect(args).toEqual([
              'load-module',
              'module-null-sink',
              'sink_name=demothat_mic',
              'sink_properties=device.description=DemoThat_Virtual_Audio',
            ])
            cb(null, '101\n', '')
          } else if (args[0] === 'load-module' && args[1] === 'module-remap-source') {
            expect(args).toEqual([
              'load-module',
              'module-remap-source',
              'master=demothat_mic.monitor',
              'source_name=demothat_virtual_mic',
              'source_properties=device.description=DemoThat_Virtual_Microphone',
            ])
            cb(null, '102\n', '')
          } else {
            cb(new Error(`unexpected command ${args.join(' ')}`), '', '')
          }
        })

        const res = await ensureLinuxAudioSink()
        expect(res.success).toBe(true)
        expect(executedCommands).toHaveLength(4)
        expect(executedCommands[0]).toEqual(['list', 'short', 'sources'])
        expect(executedCommands[1]).toEqual(['list', 'short', 'sinks'])
        expect(executedCommands[2][1]).toBe('module-null-sink')
        expect(executedCommands[3][1]).toBe('module-remap-source')
      })

      it('skips module-null-sink if demothat_mic sink already exists, but creates remap-source', async () => {
        const executedCommands: string[][] = []
        mockExecFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
          expect(file).toBe('pactl')
          executedCommands.push(args)
          if (args[0] === 'list' && args[2] === 'sources') {
            cb(null, '51\tdefault_source\n', '')
          } else if (args[0] === 'list' && args[2] === 'sinks') {
            cb(null, '8883\tdemothat_mic\tPipeWire\n', '')
          } else if (args[0] === 'load-module' && args[1] === 'module-remap-source') {
            cb(null, '102\n', '')
          } else {
            cb(new Error(`unexpected command ${args.join(' ')}`), '', '')
          }
        })

        const res = await ensureLinuxAudioSink()
        expect(res.success).toBe(true)
        expect(executedCommands).toHaveLength(3)
        expect(executedCommands[0]).toEqual(['list', 'short', 'sources'])
        expect(executedCommands[1]).toEqual(['list', 'short', 'sinks'])
        expect(executedCommands[2][1]).toBe('module-remap-source')
      })

      it('returns error if loading module-null-sink fails', async () => {
        mockExecFile.mockImplementation((_file: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
          if (args[0] === 'list' && args[2] === 'sources') {
            cb(null, '', '')
          } else if (args[0] === 'list' && args[2] === 'sinks') {
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

      it('returns error if loading module-remap-source fails', async () => {
        mockExecFile.mockImplementation((_file: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
          if (args[0] === 'list' && args[2] === 'sources') {
            cb(null, '', '')
          } else if (args[0] === 'list' && args[2] === 'sinks') {
            cb(null, 'demothat_mic', '')
          } else if (args[0] === 'load-module' && args[1] === 'module-remap-source') {
            const err = new Error('remap load failed') as Error & { code?: number }
            err.code = 1
            cb(err, '', 'Failed to load remap module')
          } else {
            cb(null, '', '')
          }
        })

        const res = await ensureLinuxAudioSink()
        expect(res.success).toBe(false)
        expect(res.error).toContain('Failed to load remap module')
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
