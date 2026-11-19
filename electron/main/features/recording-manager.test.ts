import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

const mockSavingWin = {
  close: vi.fn(),
}

const mockRecorderWin = {
  minimize: vi.fn(),
  show: vi.fn(),
  close: vi.fn(),
  webContents: {
    send: vi.fn((channel: string) => {
      if (channel === 'recorder:stop-system-audio') {
        markSystemAudioStopped()
      }
      if (channel === 'recorder:stop-screen-capture') {
        markScreenCaptureStopped()
      }
    }),
  },
}

const mockTray = {
  destroy: vi.fn(),
}

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/mock/app'),
    getPath: vi.fn(() => '/mock/path'),
    isPackaged: false,
  },
  Menu: {
    buildFromTemplate: vi.fn(),
  },
  Tray: vi.fn(),
  nativeImage: {
    createFromPath: vi.fn(),
  },
  screen: {
    getPrimaryDisplay: vi.fn(() => ({
      id: 1,
      size: { width: 1920, height: 1080 },
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1,
    })),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  dialog: {
    showMessageBox: vi.fn(),
    showErrorBox: vi.fn(),
  },
  systemPreferences: {
    getMediaAccessStatus: vi.fn(),
    askForMediaAccess: vi.fn(),
  },
  desktopCapturer: {
    getSources: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
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

const callOrder: string[] = []

vi.mock('node:fs/promises', () => ({
  default: {
    stat: vi.fn().mockResolvedValue({ size: 1024, birthtimeMs: Date.now() }),
    writeFile: vi.fn().mockImplementation(async () => {
      callOrder.push('writeFile:metadata')
    }),
    unlink: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('')),
  },
}))

vi.mock('node:child_process', () => ({
  spawn: vi.fn((_cmd: string, args: string[]) => {
    callOrder.push(`spawn:${args[0] || 'ffmpeg'}`)
    const proc = Object.assign(new EventEmitter(), {
      stdin: { write: vi.fn(), end: vi.fn() },
      stderr: new EventEmitter(),
      stdout: new EventEmitter(),
      kill: vi.fn(),
    })
    setTimeout(() => {
      if (args.includes('-hide_banner')) {
        proc.stderr.emit('data', 'Duration: 00:00:10.00, start: 0.000000, bitrate: 500 kb/s')
      }
      proc.emit('close', 0)
    }, 5)
    return proc
  }),
}))

vi.mock('./cursor-manager', () => ({
  getCursorScale: vi.fn(() => 1),
  restoreOriginalCursorScale: vi.fn(),
  resetCursorScale: vi.fn(),
}))

vi.mock('./clean-demo-mode', () => ({
  applyCleanDemoMode: vi.fn().mockResolvedValue(undefined),
  restoreCleanDemoMode: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../windows/editor-window', () => ({
  createEditorWindow: vi.fn(),
  cleanupEditorFiles: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../windows/temporary-windows', () => ({
  createSavingWindow: vi.fn(),
  createSelectionWindow: vi.fn(),
}))

vi.mock('./mouse-tracker', () => ({
  createMouseTracker: vi.fn(),
}))

vi.mock('./cursor-helper', () => ({
  isCursorHelperAvailable: vi.fn().mockResolvedValue(false),
  startCursorHelper: vi.fn().mockResolvedValue(null),
  stopCursorHelper: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./cursor-helper-preference', () => ({
  isEmbeddedOnlyDesktop: vi.fn().mockReturnValue(false),
  rememberEmbeddedOnlyDesktop: vi.fn(),
}))

vi.mock('../lib/utils', () => ({
  getFFmpegPath: vi.fn(() => '/mock/ffmpeg'),
  ensureDirectoryExists: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./audio-tracks', () => ({
  probeAudioTracks: vi.fn().mockImplementation(async (filePath: string) => {
    callOrder.push(`probeAudioTracks:${filePath}`)
    return [
      { index: 0, kind: 'mic', name: 'mic', codec: 'aac', channels: 1, sampleRate: 48000 },
      { index: 1, kind: 'system', name: 'system', codec: 'aac', channels: 2, sampleRate: 48000 },
    ]
  }),
}))

import { stopRecording, markSystemAudioStopped, markScreenCaptureStopped } from './recording-manager'
import { appState } from '../state'
import { probeAudioTracks } from './audio-tracks'

describe('recording-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    callOrder.length = 0
  })

  describe('stopRecording', () => {
    it('executes muxSystemAudio BEFORE processAndSaveMetadata so probeAudioTracks reads muxed audio tracks', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      appState.recorderWin = mockRecorderWin as any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      appState.savingWin = mockSavingWin as any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      appState.tray = mockTray as any
      appState.currentRecordingSession = {
        screenVideoPath: '/tmp/test-screen.mp4',
        metadataPath: '/tmp/test.json',
        systemAudioPath: '/tmp/test-system.webm',
        recordingGeometry: { x: 0, y: 0, width: 1920, height: 1080 },
        hasMicAudio: true,
      }
      appState.recordedMouseEvents = []
      appState.ffmpegProcess = null

      await stopRecording()

      // Verify probeAudioTracks was called with the screenVideoPath
      expect(probeAudioTracks).toHaveBeenCalledWith('/tmp/test-screen.mp4')

      // Find indices of mux spawn, probeAudioTracks, and metadata file write
      const muxIndex = callOrder.findIndex((entry) => entry.startsWith('spawn:'))
      const probeIndex = callOrder.findIndex((entry) => entry.startsWith('probeAudioTracks:'))
      const writeMetaIndex = callOrder.findIndex((entry) => entry === 'writeFile:metadata')

      expect(muxIndex).toBeGreaterThanOrEqual(0)
      expect(probeIndex).toBeGreaterThan(muxIndex)
      expect(writeMetaIndex).toBeGreaterThan(probeIndex)
    })
  })
})
