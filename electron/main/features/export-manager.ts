// Contains business logic for video export.

import log from 'electron-log/main'
import { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent, ipcMain } from 'electron'
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { appState } from '../state'
import { getFFmpegPath, calculateExportDimensions } from '../lib/utils'
import { VITE_DEV_SERVER_URL, RENDERER_DIST, PRELOAD_SCRIPT, VITE_PUBLIC } from '../lib/constants'
import { DEFAULT_CLICK_SOUND } from '../../../shared/click-sound'
import {
  buildExportArgs,
  buildChunkExportArgs,
  buildConcatExportArgs,
  computeExportDuration,
  needsBuiltInClickSound,
  type ExportProjectState,
  type ExportSettingsInput,
  buildCloudFallbackArgs,
} from './build-export-args'
import { writeSubtitleSidecar } from './subtitle-sidecar'
import { getEncoderCapabilities } from './encoder-capabilities'
import { selectBestH264Encoder } from '../lib/encoder-capabilities'
import { getEntitlement } from './entitlement'
import { recordExportPerf } from './export-perf'
import {
  cloudStagePercent,
  intermediatePathFor,
  preflightCloudExport,
  rememberActiveJob,
  runCloudExport,
  type CloudExportProgress,
} from './cloud-export'
import { clearCloudCancellation, registerCloudCancellation } from './cloud-cancel'
import type { CloudCancellation, CloudJobCreated } from './cloud-client'
import { isFormatAllowed, selectExportCodec } from '../../../shared/export-codec'
import { maxCameraScale, maxZoomLevel, detectUpscale } from '../../../shared/export-upscale'
import { applyRenderCap, cloudIntermediateSize } from '../../../shared/export-render-cap'

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

function createWorkerWindow(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: {
      preload: PRELOAD_SCRIPT,
      offscreen: false,
      backgroundThrottling: false,
      webSecurity: false,
    },
  })
  if (VITE_DEV_SERVER_URL) {
    const renderUrl = `${VITE_DEV_SERVER_URL}#renderer`
    win.loadURL(renderUrl)
    log.info(`[ExportManager] Loading render worker URL (Dev): ${renderUrl}`)
  } else {
    const renderPath = path.join(RENDERER_DIST, 'index.html')
    win.loadFile(renderPath, { hash: 'renderer' })
    log.info(`[ExportManager] Loading render worker file (Prod): ${renderPath}#renderer`)
  }
  return win
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

interface ChunkSlice {
  index: number
  startFrame: number
  endFrame: number
  chunkFrames: number
  chunkDuration: number
  chunkPath: string
}

interface ParallelExportOptions {
  editorWindow: BrowserWindow
  projectState: ExportProjectState
  exportSettings: ExportSettingsInput
  outputPath: string
  renderWidth: number
  renderHeight: number
  targetWidth: number
  targetHeight: number
  exportDuration: number
  totalFrames: number
  clickSoundPath: string | null
  temporaryFiles: string[]
  perfStartedAt: number
}

interface SingleExportOptions {
  editorWindow: BrowserWindow
  projectState: ExportProjectState
  exportSettings: ExportSettingsInput
  outputPath: string
  renderWidth: number
  renderHeight: number
  targetWidth: number
  targetHeight: number
  exportDuration: number
  useCloud: boolean
  clickSoundPath: string | null
  temporaryFiles: string[]
  perfStartedAt: number
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

  // Whether this export actually upscales the source.
  const videoDimensions = projectState.videoDimensions
  const upscale =
    videoDimensions && videoDimensions.width > 0 && videoDimensions.height > 0
      ? detectUpscale({
          targetWidth,
          targetHeight,
          paddingPercent: Number(projectState.frameStyles?.padding) || 0,
          videoWidth: videoDimensions.width,
          videoHeight: videoDimensions.height,
          maxZoom: maxZoomLevel(projectState.zoomRegions),
          cameraScale: maxCameraScale(projectState.cameraMotions),
        })
      : { isUpscale: false, requiredScale: 1 }

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

  const wantsCloud = Boolean(request.cloud) && upscale.isUpscale
  const cloudRender =
    videoDimensions && videoDimensions.width > 0 && videoDimensions.height > 0
      ? cloudIntermediateSize(targetWidth, targetHeight, videoDimensions.width, videoDimensions.height)
      : null
  const useCloud =
    wantsCloud && cloudRender !== null && (cloudRender.width < targetWidth || cloudRender.height < targetHeight)

  const { width: renderWidth, height: renderHeight } =
    useCloud && cloudRender ? cloudRender : applyRenderCap(targetWidth, targetHeight)
  log.info(`[ExportManager] Target ${targetWidth}x${targetHeight}, rendering at ${renderWidth}x${renderHeight}.`)

  const exportDuration = computeExportDuration(projectState)
  const totalFrames = Math.floor(exportDuration * exportSettings.fps)

  // Materialise the built-in click sound when click sounds are on and no custom
  // sound is set, so buildExportArgs can stay pure.
  const temporaryFiles: string[] = []
  let clickSoundPath: string | null = projectState.mouseClickSoundPath ?? null
  if (needsBuiltInClickSound(projectState)) {
    const bundledClick = path.join(VITE_PUBLIC, DEFAULT_CLICK_SOUND)
    if (fs.existsSync(bundledClick)) {
      clickSoundPath = bundledClick
    } else {
      const generatedClickPath = path.join(os.tmpdir(), `demothat-click-${Date.now()}.wav`)
      await fsPromises.writeFile(generatedClickPath, createBuiltInClickWav())
      temporaryFiles.push(generatedClickPath)
      clickSoundPath = generatedClickPath
    }
  }

  const perfStartedAt = Date.now()

  // Concurrency decision:
  // Parallel export partitions MP4 exports across 2-4 workers.
  // Short exports (<4s or <60 frames), single core machines, and cloud exports use single worker.
  const canParallel =
    !useCloud && exportSettings.format === 'mp4' && exportDuration >= 4.0 && totalFrames >= 60 && os.cpus().length >= 2

  if (canParallel) {
    await runParallelExport({
      editorWindow,
      projectState,
      exportSettings,
      outputPath,
      renderWidth,
      renderHeight,
      targetWidth,
      targetHeight,
      exportDuration,
      totalFrames,
      clickSoundPath,
      temporaryFiles,
      perfStartedAt,
    })
  } else {
    await runSingleExport({
      editorWindow,
      projectState,
      exportSettings,
      outputPath,
      renderWidth,
      renderHeight,
      targetWidth,
      targetHeight,
      exportDuration,
      useCloud,
      clickSoundPath,
      temporaryFiles,
      perfStartedAt,
    })
  }
}

/**
 * Executes a multi-process parallel chunk export.
 */
async function runParallelExport(options: ParallelExportOptions) {
  const {
    editorWindow,
    projectState,
    exportSettings,
    outputPath,
    renderWidth,
    renderHeight,
    targetWidth,
    targetHeight,
    exportDuration,
    totalFrames,
    clickSoundPath,
    temporaryFiles,
    perfStartedAt,
  } = options

  const cpuCount = os.cpus().length
  const idealWorkers = Math.min(4, Math.max(2, Math.floor(cpuCount / 2)))
  const numWorkers = Math.max(2, Math.min(idealWorkers, Math.floor(totalFrames / 30)))
  log.info(`[ExportManager] Launching parallel export with ${numWorkers} chunk workers (CPU cores: ${cpuCount}).`)

  const capabilities = await getEncoderCapabilities()
  const bestEncoder = selectBestH264Encoder(capabilities)
  log.info(`[ExportManager] Parallel chunk encoder selected: ${bestEncoder}`)

  const sessionDir = path.join(os.tmpdir(), `demothat-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  await fsPromises.mkdir(sessionDir, { recursive: true })

  const chunks: ChunkSlice[] = []
  for (let i = 0; i < numWorkers; i++) {
    const startFrame = Math.floor((i * totalFrames) / numWorkers)
    const endFrame = Math.floor(((i + 1) * totalFrames) / numWorkers)
    const chunkFrames = endFrame - startFrame
    const chunkDuration = chunkFrames / exportSettings.fps
    const chunkPath = path.join(sessionDir, `chunk_${i}.mp4`)
    chunks.push({ index: i, startFrame, endFrame, chunkFrames, chunkDuration, chunkPath })
  }

  // Spawn FFmpeg chunk processes
  const chunkProcesses: ChildProcessWithoutNullStreams[] = []
  for (const chunk of chunks) {
    const chunkArgs = buildChunkExportArgs({
      renderWidth,
      renderHeight,
      targetWidth,
      targetHeight,
      fps: exportSettings.fps,
      chunkDuration: chunk.chunkDuration,
      outputPath: chunk.chunkPath,
      encoder: bestEncoder,
      quality: exportSettings.quality,
    })
    log.info(`[ExportManager] Spawning chunk proc #${chunk.index} with args:`, chunkArgs.join(' '))
    const proc = spawn(FFMPEG_PATH, chunkArgs)
    chunkProcesses.push(proc)
  }

  // Spawn worker BrowserWindow instances
  const workerWindows: BrowserWindow[] = []
  const workerChunkBySenderId = new Map<number, number>()
  for (const chunk of chunks) {
    const win = createWorkerWindow()
    workerWindows.push(win)
    workerChunkBySenderId.set(win.webContents.id, chunk.index)
  }
  appState.renderWorkers = workerWindows

  let exportAborted = false
  let concatProcess: ChildProcessWithoutNullStreams | null = null
  const unblockPendingChunkWrites: Array<(() => void) | null> = Array(numWorkers).fill(null)

  const chunkWriteQueues: Promise<void>[] = Array(numWorkers).fill(Promise.resolve())
  const chunkFramesWritten: number[] = Array(numWorkers).fill(0)
  const chunkFinished: boolean[] = Array(numWorkers).fill(false)

  const writeChunkFrame = (chunkIndex: number, frame: Uint8Array): Promise<FrameWriteResult> =>
    new Promise((resolve) => {
      const proc = chunkProcesses[chunkIndex]
      const stdin = proc?.stdin
      const done = (aborted: boolean) => {
        unblockPendingChunkWrites[chunkIndex] = null
        stdin?.off('drain', onDrain)
        stdin?.off('error', onError)
        resolve({ aborted })
      }
      const onDrain = () => done(false)
      const onError = () => done(true)

      if (exportAborted || !stdin?.writable) {
        done(true)
        return
      }
      try {
        if (stdin.write(frame)) {
          done(false)
          return
        }
        stdin.once('drain', onDrain)
        stdin.once('error', onError)
        unblockPendingChunkWrites[chunkIndex] = () => done(true)
      } catch (err) {
        log.warn(`[ExportManager] Error writing frame to chunk #${chunkIndex} stdin:`, err)
        done(true)
      }
    })

  let lastProgressEmitTime = 0
  const emitParallelProgress = (overrideStage?: string, overridePercent?: number) => {
    if (!editorWindow || editorWindow.isDestroyed()) return
    const now = Date.now()
    if (overridePercent === undefined && now - lastProgressEmitTime < 100) return
    lastProgressEmitTime = now

    const totalWritten = chunkFramesWritten.reduce((a, b) => a + b, 0)
    const percent =
      overridePercent !== undefined
        ? overridePercent
        : Math.min(95, Math.round((totalWritten / Math.max(1, totalFrames)) * 95))
    const stage = overrideStage ?? (totalWritten >= totalFrames ? 'Encoding' : 'Rendering (Parallel)')

    editorWindow.webContents.send('export:progress', {
      progress: percent,
      stage,
      framesDone: totalWritten,
      totalFrames,
    })
  }

  const abortParallelExport = (reason: string) => {
    if (exportAborted) return
    exportAborted = true
    log.warn(`[ExportManager] Aborting parallel export: ${reason}`)

    for (let i = 0; i < unblockPendingChunkWrites.length; i++) {
      const unblock = unblockPendingChunkWrites[i]
      unblockPendingChunkWrites[i] = null
      unblock?.()
    }

    for (const proc of chunkProcesses) {
      if (proc && !proc.killed) {
        proc.kill('SIGKILL')
      }
    }
    if (concatProcess && !concatProcess.killed) {
      concatProcess.kill('SIGKILL')
    }
    for (const win of workerWindows) {
      if (win && !win.isDestroyed()) {
        win.close()
      }
    }
    appState.renderWorkers = []

    fsPromises.rm(sessionDir, { recursive: true, force: true }).catch(() => {})
    for (const f of temporaryFiles) {
      fsPromises.unlink(f).catch(() => {})
    }
    if (fs.existsSync(outputPath)) {
      fsPromises.unlink(outputPath).catch((err) => log.error('Failed to delete cancelled export file:', err))
    }

    ipcMain.removeHandler('export:frame-data')
    ipcMain.removeListener('export:render-finished', finishListener)
    ipcMain.removeListener('export:cancel', cancellationHandler)
    ipcMain.removeListener('render:ready', renderReadyListener)

    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('export:complete', { success: false, error: 'Export cancelled.' })
    }
  }

  chunkProcesses.forEach((proc, idx) => {
    proc.stderr?.on('data', (data) => log.info(`[FFmpeg chunk #${idx} stderr]: ${data.toString()}`))
    proc.stdin?.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'EPIPE') {
        log.info(`[ExportManager] Chunk #${idx} FFmpeg closed stdin after reaching chunk duration.`)
        return
      }
      log.error(`[ExportManager] Chunk #${idx} FFmpeg stdin error:`, err)
      abortParallelExport(`chunk #${idx} stdin error`)
    })
  })

  const frameHandler = async (
    _event: IpcMainInvokeEvent,
    { frame, chunkIndex }: { frame: Uint8Array; progress: number; chunkIndex?: number },
  ): Promise<FrameWriteResult> => {
    const idx = typeof chunkIndex === 'number' && chunkIndex >= 0 && chunkIndex < numWorkers ? chunkIndex : 0
    const currentWrite = chunkWriteQueues[idx].then(() => writeChunkFrame(idx, frame))
    chunkWriteQueues[idx] = currentWrite.then(
      () => {},
      () => {},
    )
    const result = await currentWrite
    if (!result.aborted) {
      chunkFramesWritten[idx] += 1
    }
    emitParallelProgress()
    return result
  }

  const finishListener = async (_event: IpcMainEvent, data?: { chunkIndex?: number }) => {
    const idx =
      typeof data?.chunkIndex === 'number' && data.chunkIndex >= 0 && data.chunkIndex < numWorkers ? data.chunkIndex : 0
    log.info(`[ExportManager] Chunk #${idx} finished frame render. Waiting for write queue.`)
    chunkFinished[idx] = true
    await chunkWriteQueues[idx].catch(() => {})
    const proc = chunkProcesses[idx]
    if (proc && !proc.killed && proc.stdin?.writable) {
      proc.stdin.end()
    }
  }

  const cancellationHandler = () => {
    log.warn('[ExportManager] Received "export:cancel". Terminating parallel export.')
    abortParallelExport('cancelled by user')
  }

  const renderReadyListener = (event: IpcMainEvent) => {
    const chunkIndex = workerChunkBySenderId.get(event.sender.id)
    if (chunkIndex === undefined) return
    const worker = workerWindows[chunkIndex]
    const chunk = chunks[chunkIndex]
    log.info(
      `[ExportManager] Worker for chunk #${chunkIndex} ready. Sending render:start slice [${chunk.startFrame}..${chunk.endFrame}).`,
    )
    if (worker && !worker.isDestroyed()) {
      worker.webContents.send('render:start', {
        projectState,
        exportSettings,
        renderWidth,
        renderHeight,
        duration: exportDuration,
        chunkIndex,
        startFrame: chunk.startFrame,
        endFrame: chunk.endFrame,
        totalFrames,
        chunkDuration: chunk.chunkDuration,
      })
    }
  }

  ipcMain.handle('export:frame-data', frameHandler)
  ipcMain.on('export:render-finished', finishListener)
  ipcMain.once('export:cancel', cancellationHandler)
  ipcMain.on('render:ready', renderReadyListener)

  const chunkPromises = chunkProcesses.map((proc, index) => {
    return new Promise<void>((resolve, reject) => {
      proc.on('close', (code) => {
        log.info(`[ExportManager] Chunk #${index} FFmpeg process exited with code ${code}.`)
        if (workerWindows[index] && !workerWindows[index].isDestroyed()) {
          workerWindows[index].close()
        }
        if (code === 0) resolve()
        else reject(new Error(`Chunk #${index} FFmpeg exited with code ${code}`))
      })
      proc.on('error', (err) => reject(err))
    })
  })

  try {
    await Promise.all(chunkPromises)
  } catch (err) {
    if (!exportAborted) {
      abortParallelExport(String(err))
    }
    return
  }

  if (exportAborted) return

  // All chunk files have been encoded. Proceed to FFmpeg concat demuxer lossless stitch + audio mux.
  emitParallelProgress('Stitching & Muxing Audio', 96)
  log.info('[ExportManager] All chunks encoded. Generating concat manifest...')

  const concatListPath = path.join(sessionDir, 'concat.txt')
  const concatContent = chunks.map((c) => `file '${c.chunkPath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n')
  await fsPromises.writeFile(concatListPath, concatContent, 'utf8')

  const concatArgs = buildConcatExportArgs({
    concatListPath,
    outputPath,
    projectState,
    clickSoundPath,
  })
  log.info('[ExportManager] Spawning concat FFmpeg with args:', concatArgs.join(' '))
  concatProcess = spawn(FFMPEG_PATH, concatArgs)

  concatProcess.stderr.on('data', (data) => log.info(`[FFmpeg concat stderr]: ${data.toString()}`))

  const concatCode = await new Promise<number | null>((resolve) => {
    concatProcess!.on('close', resolve)
    concatProcess!.on('error', (err) => {
      log.error('[ExportManager] Concat FFmpeg failed to spawn:', err)
      resolve(-1)
    })
  })

  // Cleanup session directory and temporary files
  await fsPromises.rm(sessionDir, { recursive: true, force: true }).catch(() => {})
  for (const temporaryFile of temporaryFiles) {
    fsPromises.unlink(temporaryFile).catch((err) => log.warn('Could not remove temporary audio asset:', err))
  }

  ipcMain.removeHandler('export:frame-data')
  ipcMain.removeListener('export:render-finished', finishListener)
  ipcMain.removeListener('export:cancel', cancellationHandler)
  ipcMain.removeListener('render:ready', renderReadyListener)
  appState.renderWorkers = []

  if (editorWindow && !editorWindow.isDestroyed()) {
    if (concatCode === 0) {
      const elapsedSeconds = Math.max(0.001, (Date.now() - perfStartedAt) / 1000)
      const totalWritten = chunkFramesWritten.reduce((a, b) => a + b, 0)
      if (totalWritten > 0) {
        recordExportPerf({
          resolution: exportSettings.resolution,
          codec: selectExportCodec(targetHeight),
          settingFps: exportSettings.fps,
          width: targetWidth,
          height: targetHeight,
          throughput: totalWritten / elapsedSeconds,
        })
      }
      void writeSubtitleSidecar({
        outputPath,
        cues: projectState.subtitleCues ?? [],
        format: projectState.subtitleFormat ?? 'srt',
        enabled: projectState.subtitlesEnabled === true,
      }).finally(() => {
        editorWindow.webContents.send('export:complete', { success: true, outputPath })
      })
    } else {
      editorWindow.webContents.send('export:complete', {
        success: false,
        error: `Stitch process failed with code ${concatCode}`,
      })
    }
  }
}

/**
 * Sequential single-process export (used for GIF, Cloud intermediates, and short clips).
 */
async function runSingleExport(options: SingleExportOptions) {
  const {
    editorWindow,
    projectState,
    exportSettings,
    outputPath,
    renderWidth,
    renderHeight,
    targetWidth,
    targetHeight,
    exportDuration,
    useCloud,
    clickSoundPath,
    temporaryFiles,
    perfStartedAt,
  } = options

  const cloudCancellation: CloudCancellation = { cancelled: false }
  registerCloudCancellation(cloudCancellation)
  let cloudJob: CloudJobCreated | null = null
  let cloudMinChargeCredits = 0
  let intermediatePath: string | null = null

  if (useCloud) {
    const preflight = await preflightCloudExport({
      targetWidth,
      targetHeight,
      renderWidth,
      renderHeight,
      fps: exportSettings.fps,
      durationSec: exportDuration,
    })
    if (!preflight.ok) {
      log.warn(`[ExportManager] Cloud preflight refused: ${preflight.error}`)
      editorWindow.webContents.send('export:complete', {
        success: false,
        error: preflight.error,
        cloudReason: preflight.code,
        cost: preflight.cost,
        balance: preflight.balance,
      })
      return
    }
    cloudJob = preflight.job
    cloudMinChargeCredits = preflight.capabilities.minChargeCredits ?? 0
    intermediatePath = intermediatePathFor(os.tmpdir(), Date.now())
    await fsPromises.mkdir(path.dirname(intermediatePath), { recursive: true })
    rememberActiveJob(cloudJob.jobId, outputPath, intermediatePath, targetWidth, targetHeight)
    log.info(
      `[ExportManager] Cloud job ${cloudJob.jobId}: rendering the intermediate at ${renderWidth}x${renderHeight}.`,
    )
  }

  if (appState.renderWorker && !appState.renderWorker.isDestroyed()) {
    appState.renderWorker.close()
  }
  appState.renderWorker = createWorkerWindow()

  const ffmpegArgs = buildExportArgs({
    projectState,
    exportSettings,
    outputPath: intermediatePath ?? outputPath,
    renderWidth,
    renderHeight,
    targetWidth,
    targetHeight,
    clickSoundPath,
    intermediate: useCloud,
  })

  log.info('[ExportManager] Spawning single FFmpeg with args:', ffmpegArgs.join(' '))
  const ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs)

  let ffmpegClosed = false
  let exportAborted = false
  let unblockPendingWrite: (() => void) | null = null

  let framesWritten = 0
  let cloudContinuation: (() => void) | null = null

  ffmpeg.stderr.on('data', (data) => log.info(`[FFmpeg stderr]: ${data.toString()}`))

  let frameProgress = 0
  let encodeProgress = 0
  let renderFinished = false

  const emitCloudProgress = (progress: CloudExportProgress) => {
    if (!editorWindow || editorWindow.isDestroyed()) return
    editorWindow.webContents.send('export:progress', {
      progress: cloudStagePercent(progress.stage, progress.stagePercent),
      stage: progress.stage,
      framesDone: progress.framesDone,
      totalFrames: progress.totalFrames,
      reserved: progress.reserved,
      consumed: progress.consumed,
      etaSeconds: progress.etaSeconds ?? null,
      minChargeCredits: cloudMinChargeCredits,
    })
  }

  let lastProgressEmitTime = 0
  const emitProgress = (force = false) => {
    if (!editorWindow || editorWindow.isDestroyed()) return
    const now = Date.now()
    if (!force && now - lastProgressEmitTime < 100) return
    lastProgressEmitTime = now

    const percent = Math.min(100, Math.max(frameProgress, encodeProgress))
    if (useCloud) {
      emitCloudProgress({ stage: 'Rendering locally', stagePercent: percent })
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

  ffmpeg.stdin?.on('error', (error) => {
    if ((error as NodeJS.ErrnoException).code === 'EPIPE') {
      log.info('[ExportManager] FFmpeg closed stdin after the export length; render loop will stop.')
      return
    }
    log.error('[ExportManager] FFmpeg stdin error:', error)
    abortExport('stdin error')
  })

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
      try {
        if (stdin.write(frame)) {
          done(false)
          return
        }
        stdin.once('drain', onDrain)
        stdin.once('error', onError)
        unblockPendingWrite = () => done(true)
      } catch (err) {
        log.warn('[ExportManager] Error writing frame to stdin:', err)
        done(true)
      }
    })

  let writeQueue: Promise<void> = Promise.resolve()

  const frameHandler = async (
    _event: IpcMainInvokeEvent,
    { frame, progress }: { frame: Uint8Array; progress: number },
  ): Promise<FrameWriteResult> => {
    const currentWrite = writeQueue.then(() => writeFrame(frame))
    writeQueue = currentWrite.then(
      () => {},
      () => {},
    )
    const result = await currentWrite
    if (!result.aborted) framesWritten += 1
    frameProgress = Math.max(frameProgress, Number(progress) || 0)
    emitProgress()
    return result
  }

  const cancellationHandler = () => {
    log.warn('[ExportManager] Received "export:cancel". Terminating export.')
    cloudCancellation.cancelled = true
    abortExport('cancelled by user')
    if (ffmpeg && !ffmpeg.killed) {
      ffmpeg.kill('SIGKILL')
    }
    if (appState.renderWorker && !appState.renderWorker.isDestroyed()) {
      appState.renderWorker.close()
    }
    if (cloudContinuation === null && intermediatePath) {
      fsPromises.unlink(intermediatePath).catch(() => undefined)
    }
    if (intermediatePath === null && fs.existsSync(outputPath)) {
      fsPromises.unlink(outputPath).catch((err) => log.error('Failed to delete cancelled export file:', err))
    }
    for (const temporaryFile of temporaryFiles) fsPromises.unlink(temporaryFile).catch(() => undefined)
  }

  const finishListener = async () => {
    log.info('[ExportManager] Render finished. Closing FFmpeg stdin.')
    renderFinished = true
    emitProgress(true)
    await writeQueue.catch(() => {})
    if (!ffmpegClosed && ffmpeg.stdin?.writable) {
      ffmpeg.stdin.end()
    }
  }

  ipcMain.handle('export:frame-data', frameHandler)
  ipcMain.on('export:render-finished', finishListener)
  ipcMain.once('export:cancel', cancellationHandler)

  ffmpeg.on('close', (code) => {
    ffmpegClosed = true
    if (code !== 0) abortExport(`FFmpeg exited with code ${code}`)
    log.info(`[ExportManager] FFmpeg process exited with code ${code}.`)
    if (appState.renderWorker && !appState.renderWorker.isDestroyed()) {
      appState.renderWorker.close()
    }
    appState.renderWorker = null
    for (const temporaryFile of temporaryFiles) {
      fsPromises.unlink(temporaryFile).catch((err) => log.warn('Could not remove temporary audio asset:', err))
    }

    if (editorWindow && !editorWindow.isDestroyed()) {
      if (code === null) {
        editorWindow.webContents.send('export:complete', { success: false, error: 'Export cancelled.' })
      } else if (code === 0 && cloudJob && intermediatePath) {
        const job = cloudJob
        const intermediate = intermediatePath
        const minCharge = cloudMinChargeCredits
        cloudContinuation = () => {
          void runCloudExport({
            job,
            intermediatePath: intermediate,
            outputPath,
            cancel: cloudCancellation,
            minChargeCredits: minCharge,
            onProgress: emitCloudProgress,
          }).then((outcome) => {
            clearCloudCancellation(cloudCancellation)
            if (editorWindow.isDestroyed()) return
            if (outcome.ok) {
              editorWindow.webContents.send('export:complete', {
                success: true,
                outputPath,
                charge: outcome.charge,
                refund: outcome.refund,
              })
              return
            }
            editorWindow.webContents.send('export:complete', {
              success: false,
              error: outcome.error,
              cloudReason: outcome.reason,
              charge: outcome.charge,
              refund: outcome.refund,
              cost: outcome.cost,
              intermediatePath: outcome.intermediatePath,
              canRetryCloud: outcome.canRetryCloud,
              cloudRetry: {
                targetWidth,
                targetHeight,
                fps: exportSettings.fps,
                durationSec: exportDuration,
              },
            })
          })
        }
      } else if (code === 0) {
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
        void writeSubtitleSidecar({
          outputPath,
          cues: projectState.subtitleCues ?? [],
          format: projectState.subtitleFormat ?? 'srt',
          enabled: projectState.subtitlesEnabled === true,
        }).finally(() => {
          editorWindow.webContents.send('export:complete', { success: true, outputPath })
        })
      } else {
        editorWindow.webContents.send('export:complete', { success: false, error: `FFmpeg exited with code ${code}` })
      }
    } else {
      log.warn('[ExportManager] Editor window was destroyed. Could not send export:complete message.')
    }

    ipcMain.removeHandler('export:frame-data')
    ipcMain.removeListener('export:render-finished', finishListener)
    ipcMain.removeListener('export:cancel', cancellationHandler)

    if (cloudContinuation) cloudContinuation()
    else clearCloudCancellation(cloudCancellation)
  })

  ipcMain.once('render:ready', () => {
    log.info('[ExportManager] Worker ready. Sending project state.')
    if (appState.renderWorker && !appState.renderWorker.isDestroyed()) {
      appState.renderWorker.webContents.send('render:start', {
        projectState,
        exportSettings,
        renderWidth,
        renderHeight,
        duration: exportDuration,
      })
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
