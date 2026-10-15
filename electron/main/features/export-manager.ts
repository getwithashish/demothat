// Contains business logic for video export.

import log from 'electron-log/main'
import { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { appState } from '../state'
import { getFFmpegPath, calculateExportDimensions } from '../lib/utils'
import type { ResolutionKey } from '../lib/constants'
import { VITE_DEV_SERVER_URL, RENDERER_DIST, PRELOAD_SCRIPT } from '../lib/constants'

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
/** Shapes the renderer sends over IPC for an export. Declared structurally here
 *  (mirroring src/types) so the main process does not depend on renderer types. */
interface ExportRegion {
  startTime: number
  duration: number
}

interface ExportSpeedRegion extends ExportRegion {
  speed: number
}

interface ExportAudioClip {
  filePath: string
  startTime: number
  duration: number
  sourceStart: number
  sourceDuration: number
  volume: number
  fadeIn: number
  fadeOut: number
  loop: boolean
  kind?: 'music' | 'click'
  speed?: number
}

interface ExportProjectState {
  aspectRatio: string
  duration: number
  videoPath?: string
  hasAudioTrack?: boolean
  isMuted?: boolean
  volume?: number
  mouseClickSoundsEnabled?: boolean
  mouseClickSoundPath?: string | null
  mouseClickSoundVolume?: number
  cutRegions?: Record<string, ExportRegion>
  speedRegions?: Record<string, ExportSpeedRegion>
  audioClips?: ExportAudioClip[]
}

interface ExportRequest {
  projectState: ExportProjectState
  exportSettings: { resolution: ResolutionKey; fps: number; format: string }
  outputPath: string
}

function mapSourceTimeToExportTime(sourceTime: number, projectState: ExportProjectState): number {
  let exportTime = Math.max(0, sourceTime)
  for (const region of Object.values(projectState.cutRegions ?? {}) as ExportRegion[]) {
    if (region.startTime + region.duration <= sourceTime) exportTime -= region.duration
    else if (region.startTime < sourceTime) exportTime -= sourceTime - region.startTime
  }
  for (const region of Object.values(projectState.speedRegions ?? {}) as ExportSpeedRegion[]) {
    if (region.startTime + region.duration <= sourceTime) exportTime += region.duration - region.duration / region.speed
    else if (region.startTime < sourceTime) {
      const elapsed = sourceTime - region.startTime
      exportTime += elapsed - elapsed / region.speed
    }
  }
  return Math.max(0, exportTime)
}

export async function startExport(
  event: IpcMainInvokeEvent,
  { projectState, exportSettings, outputPath }: ExportRequest,
) {
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

  const { resolution, fps, format } = exportSettings
  const { width: outputWidth, height: outputHeight } = calculateExportDimensions(resolution, projectState.aspectRatio)

  const ffmpegArgs = [
    '-y',
    '-f',
    'rawvideo',
    '-vcodec',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-s',
    `${outputWidth}x${outputHeight}`,
    '-r',
    fps.toString(),
    '-i',
    '-',
  ]
  const temporaryFiles: string[] = []
  const audioFilterParts: string[] = []
  const audioLabels: string[] = []
  let exportDuration = Math.max(0, Number(projectState.duration) || 0)
  for (const region of Object.values(projectState.cutRegions ?? {}) as ExportRegion[])
    exportDuration -= Number(region.duration) || 0
  for (const region of Object.values(projectState.speedRegions ?? {}) as ExportSpeedRegion[]) {
    exportDuration -= Number(region.duration) || 0
    exportDuration += (Number(region.duration) || 0) / Math.max(0.01, Number(region.speed) || 1)
  }
  exportDuration = Math.max(0, exportDuration)
  const isMp4 = format === 'mp4'

  if (isMp4) {
    let inputIndex = 1
    if (
      projectState.hasAudioTrack &&
      projectState.videoPath &&
      !projectState.isMuted &&
      Number(projectState.volume) > 0
    ) {
      ffmpegArgs.push('-i', projectState.videoPath)
      const originalVolume = Math.max(0, Math.min(1, Number(projectState.volume) || 0))
      audioFilterParts.push(
        `[${inputIndex}:a]atrim=duration=${exportDuration},asetpts=PTS-STARTPTS,volume=${originalVolume}[original]`,
      )
      audioLabels.push('[original]')
      inputIndex++
    }

    const clips = (projectState.audioClips ?? []).filter(
      (clip: ExportAudioClip) =>
        clip.kind !== 'click' &&
        clip.filePath &&
        clip.duration > 0 &&
        clip.volume > 0 &&
        Number(clip.startTime) < Number(projectState.duration),
    )
    clips.forEach((clip: ExportAudioClip, index: number) => {
      const start = mapSourceTimeToExportTime(Math.max(0, Number(clip.startTime) || 0), projectState)
      if (start >= exportDuration) return
      const clipDuration = Math.min(Number(clip.duration) || 0.1, exportDuration - start)
      if (clipDuration <= 0) return
      if (clip.loop) ffmpegArgs.push('-stream_loop', '-1')
      ffmpegArgs.push('-i', clip.filePath)
      const speed = Math.max(0.5, Math.min(2, Number(clip.speed) || 1))
      const fadeIn = Math.max(0, Math.min(clipDuration, Number(clip.fadeIn) || 0))
      const fadeOut = Math.max(0, Math.min(clipDuration, Number(clip.fadeOut) || 0))
      const sourceStart = Math.max(0, Number(clip.sourceStart) || 0)
      const sourceAvailable = Math.max(0.1, (Number(clip.sourceDuration) || clipDuration) - sourceStart)
      const sourceTrimDuration = clip.loop ? clipDuration * speed : Math.min(clipDuration * speed, sourceAvailable)
      const label = `music${index}`
      let filter = `[${inputIndex}:a]atrim=start=${sourceStart}:duration=${sourceTrimDuration},asetpts=PTS-STARTPTS,atempo=${speed},volume=${Math.max(0, Math.min(1, Number(clip.volume) || 0))}`
      if (fadeIn > 0) filter += `,afade=t=in:st=0:d=${fadeIn}`
      if (fadeOut > 0) filter += `,afade=t=out:st=${Math.max(0, clipDuration - fadeOut)}:d=${fadeOut}`
      filter += `,adelay=${Math.round(start * 1000)}|${Math.round(start * 1000)}[${label}]`
      audioFilterParts.push(filter)
      audioLabels.push(`[${label}]`)
      inputIndex++
    })

    const cuts = Object.values(projectState.cutRegions ?? {}) as ExportRegion[]
    // Each click sound is its own timeline clip, so deleting one removes only that event from export.
    const clicks = projectState.mouseClickSoundsEnabled
      ? (projectState.audioClips ?? []).filter(
          (clip: ExportAudioClip) =>
            clip.kind === 'click' &&
            clip.startTime >= 0 &&
            clip.startTime < projectState.duration &&
            clip.volume > 0 &&
            !cuts.some(
              (region) => clip.startTime >= region.startTime && clip.startTime < region.startTime + region.duration,
            ),
        )
      : []
    const mappedClicks = clicks
      .map((click) => ({
        start: mapSourceTimeToExportTime(Number(click.startTime) || 0, projectState),
        clipVolume: Math.max(0, Math.min(1, Number(click.volume) || 0)),
      }))
      .filter((click) => click.start < exportDuration)
    if (mappedClicks.length > 0) {
      let clickPath: string | null = projectState.mouseClickSoundPath ?? null
      if (!clickPath) {
        const generatedClickPath = path.join(os.tmpdir(), `demothat-click-${Date.now()}.wav`)
        clickPath = generatedClickPath
        await fsPromises.writeFile(generatedClickPath, createBuiltInClickWav())
        temporaryFiles.push(generatedClickPath)
      }
      const resolvedClickPath = clickPath as string
      ffmpegArgs.push('-i', resolvedClickPath)
      const splitLabels = mappedClicks.map((_click, index: number) => `[clicksrc${index}]`).join('')
      audioFilterParts.push(`[${inputIndex}:a]asplit=${mappedClicks.length}${splitLabels}`)
      const volume = Math.max(0, Math.min(1, Number(projectState.mouseClickSoundVolume ?? 0.8)))
      mappedClicks.forEach((click, index: number) => {
        const label = `click${index}`
        const delay = Math.round(click.start * 1000)
        audioFilterParts.push(
          `[clicksrc${index}]atrim=duration=0.25,asetpts=PTS-STARTPTS,volume=${volume * click.clipVolume},adelay=${delay}|${delay}[${label}]`,
        )
        audioLabels.push(`[${label}]`)
      })
      inputIndex++
    }
  }

  if (format === 'mp4') {
    ffmpegArgs.push('-map', '0:v:0')
    if (audioLabels.length > 0) {
      const mixInputs = audioLabels.join('')
      audioFilterParts.push(
        `${mixInputs}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95,atrim=duration=${exportDuration}[aout]`,
      )
      ffmpegArgs.push(
        '-filter_complex',
        audioFilterParts.join(';'),
        '-map',
        '[aout]',
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-t',
        exportDuration.toString(),
      )
    } else {
      ffmpegArgs.push('-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-t', exportDuration.toString())
    }
  } else {
    ffmpegArgs.push('-vf', 'split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse')
  }
  ffmpegArgs.push(outputPath)

  log.info('[ExportManager] Spawning FFmpeg with args:', ffmpegArgs.join(' '))
  const ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs)
  let ffmpegClosed = false

  ffmpeg.stderr.on('data', (data) => log.info(`[FFmpeg stderr]: ${data.toString()}`))

  const cancellationHandler = () => {
    log.warn('[ExportManager] Received "export:cancel". Terminating export.')
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

  const frameListener = (_e: IpcMainEvent, { frame, progress }: { frame: Buffer; progress: number }) => {
    if (!ffmpegClosed && ffmpeg.stdin.writable) ffmpeg.stdin.write(frame)
    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('export:progress', { progress, stage: 'Rendering...' })
    }
  }

  const finishListener = () => {
    log.info('[ExportManager] Render finished. Closing FFmpeg stdin.')
    if (!ffmpegClosed && ffmpeg.stdin.writable) {
      ffmpeg.stdin.end()
    }
  }

  ipcMain.on('export:frame-data', frameListener)
  ipcMain.on('export:render-finished', finishListener)
  ipcMain.once('export:cancel', cancellationHandler) // Use once to avoid multiple calls

  ffmpeg.on('close', (code) => {
    ffmpegClosed = true
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
    ipcMain.removeListener('export:frame-data', frameListener)
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
