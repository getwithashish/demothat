// Handlers for desktop-related IPC (displays, sources, cursor).

import { IpcMainEvent, IpcMainInvokeEvent, BrowserWindow, screen, dialog, app, shell, desktopCapturer } from 'electron'
import { exec, spawn } from 'node:child_process'
import log from 'electron-log/main'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getFFmpegPath, getBinaryPath } from '../../lib/utils'
import { getCursorScale, setCursorScale } from '../../features/cursor-manager'
import { loadCursorThemeFromFile } from '../../lib/cursor-theme-parser'
import { mapCursorNameToIDC } from '../../lib/win-cursor-manager'
import { CursorTheme } from '../../types'

export function getDisplays() {
  const primaryDisplay = screen.getPrimaryDisplay()
  return screen.getAllDisplays().map((display, index) => {
    // Fix for #135: Use scaleFactor to get physical pixel dimensions
    // display.bounds returns screen coordinates (scaled), but we need physical pixels
    // for accurate screen capture with FFmpeg
    const scaleFactor = display.scaleFactor
    const physicalBounds = {
      x: Math.round(display.bounds.x * scaleFactor),
      y: Math.round(display.bounds.y * scaleFactor),
      width: Math.round(display.bounds.width * scaleFactor),
      height: Math.round(display.bounds.height * scaleFactor),
    }
    return {
      id: display.id,
      name: `Display ${index + 1} (${physicalBounds.width}x${physicalBounds.height})`,
      bounds: physicalBounds,
      isPrimary: display.id === primaryDisplay.id,
      scaleFactor,
    }
  })
}

export function handleGetCursorScale() {
  return getCursorScale()
}

export function handleSetCursorScale(_event: IpcMainEvent, scale: number) {
  setCursorScale(scale)
}

export function showSaveDialog(_event: IpcMainInvokeEvent, options: Electron.SaveDialogOptions) {
  return dialog.showSaveDialog(options)
}

export function showMessageBox(_event: IpcMainInvokeEvent, options: Electron.MessageBoxOptions) {
  return dialog.showMessageBox(options)
}

export async function checkScreenRecordingPermission(_event: IpcMainInvokeEvent): Promise<'granted' | 'denied' | 'not-determined'> {
  if (process.platform !== 'darwin') return 'granted'

  // getMediaAccessStatus('screen') is unreliable on macOS 14+ (always returns
  // 'granted'). Instead, probe with desktopCapturer: if permission is denied,
  // getSources() returns an empty array on Sequoia.
  let hasPermission = false
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
    log.info('[Permission] desktopCapturer returned', sources.length, 'sources:', sources.map(s => s.name))
    hasPermission = sources.length > 0
  } catch (e) {
    log.warn('[Permission] desktopCapturer.getSources threw:', e)
    hasPermission = false
  }
  log.info('[Permission] screen recording hasPermission:', hasPermission)

  if (!hasPermission) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'Screen Recording Permission Required',
      message: 'ScreenArc needs Screen Recording permission to capture system audio.',
      detail: 'Click "Open Settings" to go to System Settings → Privacy & Security → Screen Recording and enable "Electron". Then restart the app and try again.',
      buttons: ['Open Settings', 'Cancel'],
      defaultId: 0,
    })
    if (response === 0) {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
    }
    return 'denied'
  }

  return 'granted'
}

export async function getVideoFrame(
  _event: IpcMainInvokeEvent,
  { videoPath, time }: { videoPath: string; time: number },
): Promise<string> {
  const FFMPEG_PATH = getFFmpegPath()
  return new Promise((resolve, reject) => {
    const command = `"${FFMPEG_PATH}" -ss ${time} -i "${videoPath}" -vframes 1 -f image2pipe -c:v png -`
    exec(command, { encoding: 'binary', maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        log.error(`[Desktop] FFmpeg frame extraction error: ${stderr}`)
        return reject(error)
      }
      resolve(`data:image/png;base64,${Buffer.from(stdout, 'binary').toString('base64')}`)
    })
  })
}

/**
 * Reports whether a video file contains an audio stream. Chromium (Electron)
 * does not implement HTMLMediaElement.audioTracks / mozHasAudio /
 * webkitHasAudio, so the renderer cannot detect recorded microphone audio on
 * its own. FFmpeg is the source of truth.
 */
export async function videoHasAudio(_event: IpcMainInvokeEvent | null, videoPath: string): Promise<boolean> {
  if (!videoPath) return false
  const FFMPEG_PATH = getFFmpegPath()
  return new Promise<boolean>((resolve) => {
    const proc = spawn(FFMPEG_PATH, ['-hide_banner', '-i', videoPath])
    let stderr = ''
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('error', (err) => {
      log.warn('[Desktop] Failed to probe audio stream:', err)
      resolve(false)
    })
    // `ffmpeg -i file` with no output exits non-zero but lists all streams.
    proc.on('close', () => resolve(/Stream #\d+:\d+.*: Audio:/.test(stderr)))
  })
}

export async function getDshowDevices(): Promise<{
  video: { name: string; alternativeName: string }[]
  audio: { name: string; alternativeName: string }[]
}> {
  if (process.platform !== 'win32') {
    return { video: [], audio: [] }
  }

  const FFMPEG_PATH = getFFmpegPath()
  const command = `"${FFMPEG_PATH}" -hide_banner -list_devices true -f dshow -i dummy`

  return new Promise((resolve) => {
    exec(command, (_error, _stdout, stderr) => {
      // The command is expected to "fail" and output to stderr, which is normal for this command.
      const lines = stderr.split('\n')
      const video: { name: string; alternativeName: string }[] = []
      const audio: { name: string; alternativeName: string }[] = []

      let lastDevice: { name: string; type: 'video' | 'audio' } | null = null

      for (const line of lines) {
        const friendlyNameMatch = line.match(/\[dshow.*\] "([^"]+)" \((video|audio)\)/)
        if (friendlyNameMatch) {
          const [, name, type] = friendlyNameMatch
          lastDevice = { name, type: type as 'video' | 'audio' }
          continue
        }

        const altNameMatch = line.match(/\[dshow.*\]\s+Alternative name "([^"]+)"/)
        if (altNameMatch && lastDevice) {
          const [, alternativeName] = altNameMatch
          if (lastDevice.type === 'video') {
            video.push({ name: lastDevice.name, alternativeName })
          } else {
            audio.push({ name: lastDevice.name, alternativeName })
          }
          lastDevice = null // Reset for the next device
        }
      }

      log.info(`[Desktop] Found dshow devices: ${video.length} video, ${audio.length} audio.`)
      resolve({ video, audio })
    })
  })
}

export async function getCursorThemes(): Promise<string[]> {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return []
  }
  log.info('[IPC] Received request to get cursor themes')
  try {
    const platform = process.platform === 'win32' ? 'windows' : 'darwin'
    let themesDir: string

    if (app.isPackaged) {
      themesDir = path.join(process.resourcesPath, 'app.asar.unpacked', 'binaries', platform, 'cursor-themes')
    } else {
      themesDir = path.join(process.env.APP_ROOT!, 'binaries', platform, 'cursor-themes')
    }

    const files = await fs.readdir(themesDir)
    const themeNames = files.filter((file) => file.endsWith('.theme')).map((file) => path.parse(file).name)
    log.info(`[IPC] Found cursor themes: ${themeNames.join(', ')}`)
    return themeNames
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.error('[IPC] Failed to list cursor themes:', error)
    } else {
      log.warn('[IPC] Cursor themes directory not found.')
    }
    return ['default'] // Always return at least default if an error occurs
  }
}

export async function loadCursorTheme(
  _event: IpcMainInvokeEvent,
  themeName: string | undefined,
): Promise<CursorTheme | null> {
  const themeToLoad = themeName || 'default'
  log.info(`[IPC] Received request to parse cursor theme: ${themeToLoad}`)
  try {
    const cursorThemePath = getBinaryPath(path.join('cursor-themes', `${themeToLoad}.theme`))
    const cursorTheme = await loadCursorThemeFromFile(cursorThemePath)
    return cursorTheme
  } catch (error) {
    log.error(`[IPC] Failed to parse cursor theme file '${themeToLoad}.theme':`, error)
    return null
  }
}

export function handleMapCursorNameToIDC(_event: IpcMainInvokeEvent, name: string) {
  return mapCursorNameToIDC(name)
}


export async function handleOpenAudioFile(event: IpcMainInvokeEvent): Promise<{ canceled: boolean; filePath?: string; fileName?: string }> {
  const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
  const result = await dialog.showOpenDialog(parent, {
    title: 'Import audio file',
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'aiff', 'wma'] }],
  })
  if (result.canceled || result.filePaths.length === 0) return { canceled: true }
  const sourcePath = result.filePaths[0]
  const assetDirectory = path.join(app.getPath('userData'), 'audio-assets')
  await fs.mkdir(assetDirectory, { recursive: true })
  const importedPath = path.join(assetDirectory, `${Date.now()}-${path.basename(sourcePath)}`)
  await fs.copyFile(sourcePath, importedPath)
  return { canceled: false, filePath: importedPath, fileName: path.basename(sourcePath) }
}


export async function handleOpenVideoFiles(event: IpcMainInvokeEvent): Promise<{ canceled: boolean; files?: { filePath: string; fileName: string }[] }> {
  const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
  const result = await dialog.showOpenDialog(parent, {
    title: 'Import video clips', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }],
  })
  if (result.canceled || result.filePaths.length === 0) return { canceled: true }
  const assetDirectory = path.join(app.getPath('userData'), 'video-assets')
  await fs.mkdir(assetDirectory, { recursive: true })
  const files: { filePath: string; fileName: string }[] = []
  for (const sourcePath of result.filePaths) {
    const importedPath = path.join(assetDirectory, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${path.basename(sourcePath)}`)
    await fs.copyFile(sourcePath, importedPath)
    files.push({ filePath: importedPath, fileName: path.basename(sourcePath) })
  }
  return { canceled: false, files }
}

export async function handleDetectSilence(_event: IpcMainInvokeEvent, videoPath: string): Promise<{ start: number; end: number; duration: number }[]> {
  const ffmpegPath = getFFmpegPath()
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-i', videoPath, '-vn', '-af', 'silencedetect=noise=-35dB:d=0.45', '-f', 'null', '-'])
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0 && !stderr.includes('silence_end')) return reject(new Error('FFmpeg could not analyze this video audio track.'))
      const silences: { start: number; end: number; duration: number }[] = []
      let pendingStart: number | null = null
      for (const line of stderr.split(/\r?\n/)) {
        const startMatch = line.match(/silence_start:\s*(-?[\d.]+)/)
        if (startMatch) pendingStart = Math.max(0, Number(startMatch[1]))
        const endMatch = line.match(/silence_end:\s*([\d.]+).*silence_duration:\s*([\d.]+)/)
        if (endMatch) {
          const end = Number(endMatch[1]); const duration = Number(endMatch[2]); const start = pendingStart ?? Math.max(0, end - duration)
          if (duration >= 0.45) silences.push({ start, end, duration })
          pendingStart = null
        }
      }
      resolve(silences)
    })
  })
}
