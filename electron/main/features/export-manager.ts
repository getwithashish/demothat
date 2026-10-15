// Contains business logic for video export.

import log from 'electron-log/main'
import { BrowserWindow, IpcMainInvokeEvent, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { appState } from '../state'
import { getFFmpegPath, calculateExportDimensions } from '../lib/utils'
import { VITE_DEV_SERVER_URL, RENDERER_DIST, PRELOAD_SCRIPT } from '../lib/constants'
import {
  buildExportArgs,
  needsBuiltInClickSound,
  type ExportProjectState,
  type ExportSettingsInput,
} from './build-export-args'

const FFMPEG_PATH = getFFmpegPath()

function createBuiltInClickWav(): Buffer {
  const sampleRate = 44100
  const samples = Math.floor(sampleRate * 0.055)
  const dataSize = samples * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate
    const envelope = Math.exp(-t * 95)
    const tone = Math.sin(2 * Math.PI * (1450 - 650 * (i / samples)) * t)
    buffer.writeInt16LE(Math.round(tone * envelope * 9500), 44 + i * 2)
  }
  return buffer
}

interface ExportRequest {
  projectState: ExportProjectState
  exportSettings: ExportSettingsInput
  outputPath: string
}

/** Result of handing one frame to FFmpeg. `aborted` means "stop rendering". */
interface FrameWriteResult {
  aborted: boolean
}

export async function startExport(event: IpcMainInvokeEvent, request: ExportRequest) {
  const { projectState, exportSettings, outputPath } = request
  log.info('[ExportManager] Starting export process...')
  const editorWindow = BrowserWindow.fromWebContents(event.sender)
  if (!editorWindow) return

  if (appState.renderWorker) {
    appState.renderWorker.close()
  }
  appState.renderWorker = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: {
      preload: PRELOAD_SCRIPT,
      offscreen: true,
      webSecurity: false,
    },
  })
  if (VITE_DEV_SERVER_URL) {
    const renderUrl = `${VITE_DEV_SERVER_URL}#renderer`
    appState.renderWorker.loadURL(renderUrl)
    log.info(`[ExportManager] Loading render worker URL (Dev): ${renderUrl}`)
  } else {
    const renderPath = path.join(RENDERER_DIST, 'index.html')
    appState.renderWorker.loadFile(renderPath, { hash: 'renderer' })
    log.info(`[ExportManager] Loading render worker file (Prod): ${renderPath}#renderer`)
  }

  const { resolution } = exportSettings
  const { width: outputWidth, height: outputHeight } = calculateExportDimensions(resolution, projectState.aspectRatio)

  // Materialise the built-in click WAV when click sounds are on and no custom
  // sound is set, so buildExportArgs can stay pure.
  const temporaryFiles: string[] = []
  let clickSoundPath: string | null = projectState.mouseClickSoundPath ?? null
  if (needsBuiltInClickSound(projectState)) {
    const generatedClickPath = path.join(os.tmpdir(), `demothat-click-${Date.now()}.wav`)
    await fsPromises.writeFile(generatedClickPath, createBuiltInClickWav())
    temporaryFiles.push(generatedClickPath)
    clickSoundPath = generatedClickPath
  }

  const ffmpegArgs = buildExportArgs({
    projectState,
    exportSettings,
    outputPath,
    width: outputWidth,
    height: outputHeight,
    clickSoundPath,
  })

  log.info('[ExportManager] Spawning FFmpeg with args:', ffmpegArgs.join(' '))
  const ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs)

  let ffmpegClosed = false
  let exportAborted = false
  // Set while a frame write waits for `drain` so a cancel or an early FFmpeg
  // exit can unblock the renderer instead of leaving it hung.
  let unblockPendingWrite: (() => void) | null = null

  ffmpeg.stderr.on('data', (data) => log.info(`[FFmpeg stderr]: ${data.toString()}`))

  const abortExport = (reason: string) => {
    if (exportAborted) return
    exportAborted = true
    log.warn(`[ExportManager] Aborting export: ${reason}`)
    const unblock = unblockPendingWrite
    unblockPendingWrite = null
    unblock?.()
  }

  // FFmpeg can die (bad args, disk full, permissions) while frames are still
  // streaming in; unblock the renderer so it stops instead of piling frames up.
  ffmpeg.stdin?.on('error', (error) => {
    log.error('[ExportManager] FFmpeg stdin error:', error)
    abortExport('stdin error')
  })

  /**
   * Writes one frame and resolves once FFmpeg has accepted it, waiting for
   * `drain` when the pipe is full. Resolves aborted=true when the export has
   * been cancelled or FFmpeg is gone.
   */
  const writeFrame = (frame: Uint8Array): Promise<FrameWriteResult> =>
    new Promise((resolve) => {
      const stdin = ffmpeg.stdin
      const done = (aborted: boolean) => {
        unblockPendingWrite = null
        stdin?.off('drain', onDrain)
        stdin?.off('error', onError)
        resolve({ aborted })
      }
      const onDrain = () => done(false)
      const onError = () => done(true)

      if (exportAborted || ffmpegClosed || !stdin?.writable) {
        done(true)
        return
      }
      if (stdin.write(frame)) {
        done(false)
        return
      }
      stdin.once('drain', onDrain)
      stdin.once('error', onError)
      unblockPendingWrite = () => done(true)
    })

  const frameHandler = async (
    _event: IpcMainInvokeEvent,
    { frame, progress }: { frame: Uint8Array; progress: number },
  ): Promise<FrameWriteResult> => {
    const result = await writeFrame(frame)
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('export:progress', { progress, stage: 'Rendering...' })
    }
    return result
  }

  const cancellationHandler = () => {
    log.warn('[ExportManager] Received "export:cancel". Terminating export.')
    abortExport('cancelled by user')
    if (ffmpeg && !ffmpeg.killed) {
      ffmpeg.kill('SIGKILL')
    }
    if (appState.renderWorker && !appState.renderWorker.isDestroyed()) {
      appState.renderWorker.close()
    }
    if (fs.existsSync(outputPath)) {
      fsPromises.unlink(outputPath).catch((err) => log.error('Failed to delete cancelled export file:', err))
    }
    for (const temporaryFile of temporaryFiles) fsPromises.unlink(temporaryFile).catch(() => undefined)
  }

  const finishListener = () => {
    log.info('[ExportManager] Render finished. Closing FFmpeg stdin.')
    if (!ffmpegClosed && ffmpeg.stdin?.writable) {
      ffmpeg.stdin.end()
    }
  }

  ipcMain.handle('export:frame-data', frameHandler)
  ipcMain.on('export:render-finished', finishListener)
  ipcMain.once('export:cancel', cancellationHandler)

  ffmpeg.on('close', (code) => {
    ffmpegClosed = true
    abortExport(`FFmpeg exited with code ${code}`)
    log.info(`[ExportManager] FFmpeg process exited with code ${code}.`)
    if (appState.renderWorker && !appState.renderWorker.isDestroyed()) {
      appState.renderWorker.close()
    }
    appState.renderWorker = null
    for (const temporaryFile of temporaryFiles) {
      fsPromises.unlink(temporaryFile).catch((err) => log.warn('Could not remove temporary audio asset:', err))
    }

    // Check if the editor window still exists before sending a message
    if (editorWindow && !editorWindow.isDestroyed()) {
      if (code === null) {
        // Cancelled by SIGKILL
        editorWindow.webContents.send('export:complete', { success: false, error: 'Export cancelled.' })
      } else if (code === 0) {
        editorWindow.webContents.send('export:complete', { success: true, outputPath })
      } else {
        editorWindow.webContents.send('export:complete', { success: false, error: `FFmpeg exited with code ${code}` })
      }
    } else {
      log.warn('[ExportManager] Editor window was destroyed. Could not send export:complete message.')
    }

    // Clean up all listeners
    ipcMain.removeHandler('export:frame-data')
    ipcMain.removeListener('export:render-finished', finishListener)
    ipcMain.removeListener('export:cancel', cancellationHandler)
  })

  ipcMain.once('render:ready', () => {
    log.info('[ExportManager] Worker ready. Sending project state.')
    if (appState.renderWorker && !appState.renderWorker.isDestroyed()) {
      appState.renderWorker.webContents.send('render:start', { projectState, exportSettings })
    }
  })
}
