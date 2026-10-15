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
  computeExportDuration,
  needsBuiltInClickSound,
  type ExportProjectState,
  type ExportSettingsInput,
  buildCloudFallbackArgs,
} from './build-export-args'
import { getEncoderCapabilities } from './encoder-capabilities'
import { getEntitlement } from './entitlement'
import { recordExportPerf } from './export-perf'
import {
  cloudStagePercent,
  intermediatePathFor,
  preflightCloudUpscale,
  runCloudStages,
  type CloudStage,
} from './cloud-upscale-job'
import type { CloudCancellation, CloudJobCreated, CloudSettings } from './cloud-upscale-client'
import { isFormatAllowed, selectExportCodec } from '../../../shared/export-codec'
import { maxCameraScale, maxZoomLevel, detectUpscale } from '../../../shared/export-upscale'
import { applyRenderCap } from '../../../shared/export-render-cap'

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
  /**
   * Present for the AI (cloud) method: render the intermediate locally, then
   * upload it for the cloud to upscale.
   */
  cloud?: { model?: string }
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

  const { resolution } = exportSettings
  const { width: targetWidth, height: targetHeight } = calculateExportDimensions(resolution, projectState.aspectRatio)

  // GIF is limited to 2K.
  if (!isFormatAllowed(exportSettings.format, targetHeight)) {
    editorWindow.webContents.send('export:complete', {
      success: false,
      error: 'GIF export is limited to 2K. Choose MP4 for larger resolutions.',
    })
    return
  }

  // Targets above 4K need HEVC. Never fall back to H.264 silently.
  if (selectExportCodec(targetHeight) === 'hevc') {
    const capabilities = await getEncoderCapabilities()
    if (!capabilities.libx265) {
      log.error('[ExportManager] HEVC requested but libx265 is unavailable in this FFmpeg build.')
      editorWindow.webContents.send('export:complete', {
        success: false,
        error:
          'This build cannot export above 4K: the bundled FFmpeg has no libx265 (HEVC) encoder. ' +
          'Rebuild the FFmpeg binary with --enable-libx265.',
      })
      return
    }
  }

  // Upscaling is a Pro feature. This is a SOFT gate (see features/entitlement.ts):
  // a rebuilt client can remove it, so it is defence in depth, not enforcement.
  const videoDimensions = projectState.videoDimensions
  if (videoDimensions && videoDimensions.width > 0 && videoDimensions.height > 0) {
    const upscale = detectUpscale({
      targetWidth,
      targetHeight,
      paddingPercent: Number(projectState.frameStyles?.padding) || 0,
      videoWidth: videoDimensions.width,
      videoHeight: videoDimensions.height,
      maxZoom: maxZoomLevel(projectState.zoomRegions),
      cameraScale: maxCameraScale(projectState.cameraMotions),
    })
    if (upscale.isUpscale) {
      const entitlement = await getEntitlement()
      if (!entitlement.pro) {
        log.info('[ExportManager] Refusing an upscaling export without Pro entitlement.')
        editorWindow.webContents.send('export:complete', {
          success: false,
          error: `This export would upscale the source by ${upscale.requiredScale.toFixed(1)}x, which is a Pro feature.`,
        })
        return
      }
    }
  }

  // The renderer draws at the capped size; FFmpeg scales to the exact target.
  const { width: renderWidth, height: renderHeight } = applyRenderCap(targetWidth, targetHeight)
  log.info(`[ExportManager] Target ${targetWidth}x${targetHeight}, rendering at ${renderWidth}x${renderHeight}.`)

  // --- Cloud (AI) upscaling: reserve the credits BEFORE rendering anything ----
  // A refusal (no credits, no consent, backend unreachable) must cost the user no
  // render time at all.
  const cloudCancellation: CloudCancellation = { cancelled: false }
  let cloudJob: CloudJobCreated | null = null
  let cloudSettings: CloudSettings | null = null
  let intermediatePath: string | null = null

  if (request.cloud) {
    const preflight = await preflightCloudUpscale({
      editorWindow,
      targetWidth,
      targetHeight,
      renderWidth,
      renderHeight,
      fps: exportSettings.fps,
      durationSec: computeExportDuration(projectState),
      model: request.cloud.model,
    })
    if (!preflight.ok) {
      log.warn(`[ExportManager] Cloud preflight refused: ${preflight.error}`)
      editorWindow.webContents.send('export:complete', { success: false, error: preflight.error })
      return
    }
    cloudJob = preflight.job
    cloudSettings = preflight.settings
    intermediatePath = intermediatePathFor(os.tmpdir(), Date.now())
    log.info(
      `[ExportManager] Cloud job ${cloudJob.jobId}: rendering the intermediate at ${renderWidth}x${renderHeight}.`,
    )
  }

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
    outputPath: intermediatePath ?? outputPath,
    renderWidth,
    renderHeight,
    targetWidth,
    targetHeight,
    clickSoundPath,
    intermediate: !!request.cloud,
  })

  log.info('[ExportManager] Spawning FFmpeg with args:', ffmpegArgs.join(' '))
  const ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs)

  let ffmpegClosed = false
  let exportAborted = false
  // Set while a frame write waits for `drain` so a cancel or an early FFmpeg
  // exit can unblock the renderer instead of leaving it hung.
  let unblockPendingWrite: (() => void) | null = null

  // --- Measured throughput -------------------------------------------------------
  // Recorded when the export completes so the modal can estimate render times.
  const perfStartedAt = Date.now()
  let framesWritten = 0
  // Set once the local render is done and the cloud stages take over; it also
  // marks the intermediate as complete (so a cancel keeps it).
  let cloudContinuation: (() => void) | null = null

  ffmpeg.stderr.on('data', (data) => log.info(`[FFmpeg stderr]: ${data.toString()}`))

  // --- Progress -----------------------------------------------------------------
  // FFmpeg's own position is the authoritative progress: with backpressure the
  // renderer cannot run ahead of the encoder, and unlike frames-sent it also
  // covers the encode/flush tail after rendering has finished.
  const exportDuration = computeExportDuration(projectState)
  let frameProgress = 0
  let encodeProgress = 0
  let renderFinished = false

  /** Cloud stage progress: the stage's own percent mapped onto the overall bar. */
  const emitCloudProgress = (stage: CloudStage, stagePercent: number) => {
    if (!editorWindow || editorWindow.isDestroyed()) return
    editorWindow.webContents.send('export:progress', {
      progress: cloudStagePercent(stage, stagePercent),
      stage,
    })
  }

  const emitProgress = () => {
    if (!editorWindow || editorWindow.isDestroyed()) return
    const percent = Math.min(100, Math.max(frameProgress, encodeProgress))
    if (request.cloud) {
      // The same render, reported against the cloud flow's own bar and label.
      emitCloudProgress('Rendering locally', percent)
      return
    }
    editorWindow.webContents.send('export:progress', {
      progress: percent,
      stage: renderFinished ? 'Encoding' : 'Rendering',
    })
  }

  let progressBuffer = ''
  const handleProgressOutput = (chunk: Buffer) => {
    progressBuffer += chunk.toString()
    const lines = progressBuffer.split('\n')
    progressBuffer = lines.pop() ?? ''

    let changed = false
    for (const line of lines) {
      const [key, value] = line.trim().split('=')
      if (key === 'out_time_us' || key === 'out_time_ms') {
        // Both fields carry microseconds in FFmpeg's progress output.
        const microseconds = Number(value)
        if (exportDuration > 0 && Number.isFinite(microseconds) && microseconds >= 0) {
          encodeProgress = Math.max(encodeProgress, (microseconds / 1_000_000 / exportDuration) * 100)
          changed = true
        }
      } else if (key === 'progress' && value === 'end') {
        encodeProgress = 100
        changed = true
      }
    }
    if (changed) emitProgress()
  }
  ffmpeg.stdout?.on('data', handleProgressOutput)

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
    if (!result.aborted) framesWritten += 1
    frameProgress = Math.max(frameProgress, Number(progress) || 0)
    emitProgress()
    return result
  }

  const cancellationHandler = () => {
    log.warn('[ExportManager] Received "export:cancel". Terminating export.')
    // Stops an in-flight upload/download/poll as well as the render.
    cloudCancellation.cancelled = true
    abortExport('cancelled by user')
    if (ffmpeg && !ffmpeg.killed) {
      ffmpeg.kill('SIGKILL')
    }
    if (appState.renderWorker && !appState.renderWorker.isDestroyed()) {
      appState.renderWorker.close()
    }
    // A finished intermediate is kept (it can be retried or upscaled locally); a
    // half-written one is not worth anything.
    if (cloudContinuation === null && intermediatePath) {
      fsPromises.unlink(intermediatePath).catch(() => undefined)
    }
    if (intermediatePath === null && fs.existsSync(outputPath)) {
      fsPromises.unlink(outputPath).catch((err) => log.error('Failed to delete cancelled export file:', err))
    }
    for (const temporaryFile of temporaryFiles) fsPromises.unlink(temporaryFile).catch(() => undefined)
  }

  const finishListener = () => {
    log.info('[ExportManager] Render finished. Closing FFmpeg stdin.')
    renderFinished = true
    emitProgress()
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
      } else if (code === 0 && cloudJob && cloudSettings && intermediatePath) {
        // The render is done. Hand the intermediate to the cloud *after* the
        // listeners below are cleaned up, so a second export can start while the
        // upload is still running.
        const job = cloudJob
        const settings = cloudSettings
        const intermediate = intermediatePath
        cloudContinuation = () => {
          void runCloudStages({
            editorWindow,
            settings,
            job,
            intermediatePath: intermediate,
            outputPath,
            cancel: cloudCancellation,
            onProgress: emitCloudProgress,
          }).then((outcome) => {
            if (editorWindow.isDestroyed()) return
            if (outcome.ok) {
              editorWindow.webContents.send('export:complete', { success: true, outputPath })
              return
            }
            editorWindow.webContents.send('export:complete', {
              success: false,
              error: outcome.error ?? 'The cloud upscale failed.',
              // Kept so retry / Standard fallback need no second render.
              intermediatePath: outcome.intermediatePath,
              canRetryCloud: !cloudCancellation.cancelled,
            })
          })
        }
      } else if (code === 0) {
        // Remember how fast this configuration actually ran (render + encode).
        if (framesWritten > 0) {
          const elapsedSeconds = Math.max(0.001, (Date.now() - perfStartedAt) / 1000)
          recordExportPerf({
            resolution: exportSettings.resolution,
            codec: selectExportCodec(targetHeight),
            settingFps: exportSettings.fps,
            width: targetWidth,
            height: targetHeight,
            throughput: framesWritten / elapsedSeconds,
          })
        }
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

    // The cloud stages start only now, so the export slot is free again and a
    // cancel during the upload does not fight the render's cleanup.
    cloudContinuation?.()
  })

  ipcMain.once('render:ready', () => {
    log.info('[ExportManager] Worker ready. Sending project state.')
    if (appState.renderWorker && !appState.renderWorker.isDestroyed()) {
      appState.renderWorker.webContents.send('render:start', { projectState, exportSettings })
    }
  })
}

export interface StandardFallbackRequest {
  intermediatePath: string
  outputPath: string
  targetWidth: number
  targetHeight: number
  durationSec: number
  quality?: ExportSettingsInput['quality']
  onProgress?: (percent: number) => void
}

/**
 * Standard (Lanczos) upscale of an intermediate that a cloud export already
 * rendered, so a failed cloud step costs no render time to recover from.
 *
 * Independent of the render worker: FFmpeg reads the intermediate straight from
 * disk, scales it to the exact target and copies the audio it already contains.
 */
export function runStandardFallback(request: StandardFallbackRequest): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const args = buildCloudFallbackArgs({
      intermediatePath: request.intermediatePath,
      outputPath: request.outputPath,
      targetWidth: request.targetWidth,
      targetHeight: request.targetHeight,
      quality: request.quality,
    })
    log.info('[ExportManager] Standard fallback with args:', args.join(' '))
    const ffmpeg = spawn(FFMPEG_PATH, args)

    let buffer = ''
    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const [key, value] = line.split('=')
        if (key !== 'out_time_us' || !(request.durationSec > 0)) continue
        const seconds = Number(value) / 1_000_000
        request.onProgress?.(Math.max(0, Math.min(100, (seconds / request.durationSec) * 100)))
      }
    })
    ffmpeg.stderr.on('data', (data) => log.info(`[FFmpeg fallback stderr]: ${data.toString()}`))
    ffmpeg.on('error', (error) => {
      log.error('[ExportManager] Standard fallback failed to start:', error)
      resolve({ ok: false, error: String(error) })
    })
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        request.onProgress?.(100)
        resolve({ ok: true })
        return
      }
      resolve({ ok: false, error: `FFmpeg exited with code ${code}` })
    })
  })
}
