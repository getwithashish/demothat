import log from 'electron-log/renderer'
import { useEffect, useRef } from 'react'
import { useEditorStore } from '../store/editorStore'
import { EditorState, EditorActions, CursorTheme, CursorFrame, CursorImageBitmap } from '../types'
import { ExportSettings } from '../components/editor/ExportModal'
import { exportDimensions } from '../../shared/export-resolutions'
import { applyRenderCap } from '../../shared/export-render-cap'
import { drawScene, getClipSourceTime, type VideoClipLayer } from '../lib/renderer'
import { prepareCursorBitmaps, mapExportTimeToSourceTime } from '../lib/utils'
import { prepareCursorIcons } from '../lib/cursor-icons'
import type { VideoClip } from '../types'

type RenderStartPayload = {
  projectState: Omit<EditorState, keyof EditorActions>
  exportSettings: ExportSettings
  renderWidth?: number
  renderHeight?: number
  duration?: number
  chunkIndex?: number
  startFrame?: number
  endFrame?: number
  totalFrames?: number
  chunkDuration?: number
}

// These are needed to regenerate bitmaps within the renderer worker context.
async function prepareWindowsCursorBitmaps(theme: CursorTheme, scale: number): Promise<Map<string, CursorImageBitmap>> {
  const bitmapMap = new Map<string, CursorImageBitmap>()
  const cursorSet = theme[scale]
  if (!cursorSet) {
    log.warn(`[RendererPage] No cursor set found for scale ${scale}x`)
    return bitmapMap
  }
  const processingPromises: Promise<void>[] = []
  for (const cursorThemeName in cursorSet) {
    const frames = cursorSet[cursorThemeName]
    processingPromises.push(
      (async () => {
        const idcName = await window.electronAPI.mapCursorNameToIDC(cursorThemeName)
        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i] as CursorFrame
          if (frame.rgba && frame.width > 0 && frame.height > 0) {
            try {
              const buffer = new Uint8ClampedArray(Object.values(frame.rgba))
              const imageData = new ImageData(buffer, frame.width, frame.height)
              const bitmap = await createImageBitmap(imageData)
              const key = `${idcName}-${i}`
              bitmapMap.set(key, { ...frame, imageBitmap: bitmap })
            } catch (e) {
              log.error(`[RendererPage] Failed to create bitmap for ${idcName}-${i}`, e)
            }
          }
        }
      })(),
    )
  }
  await Promise.all(processingPromises)
  return bitmapMap
}

async function prepareMacOSCursorBitmaps(theme: CursorTheme, scale: number): Promise<Map<string, CursorImageBitmap>> {
  const bitmapMap = new Map<string, CursorImageBitmap>()
  const cursorSet = theme[scale]
  if (!cursorSet) {
    log.warn(`[RendererPage] No cursor set found for scale ${scale}x`)
    return bitmapMap
  }
  const processingPromises: Promise<void>[] = []
  for (const cursorThemeName in cursorSet) {
    const frames = cursorSet[cursorThemeName]
    processingPromises.push(
      (async () => {
        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i] as CursorFrame
          if (frame.rgba && frame.width > 0 && frame.height > 0) {
            try {
              const buffer = new Uint8ClampedArray(Object.values(frame.rgba))
              const imageData = new ImageData(buffer, frame.width, frame.height)
              const bitmap = await createImageBitmap(imageData)
              const key = `${cursorThemeName}-${i}`
              bitmapMap.set(key, { ...frame, imageBitmap: bitmap })
            } catch (e) {
              log.error(`[RendererPage] Failed to create bitmap for ${cursorThemeName}-${i}`, e)
            }
          }
        }
      })(),
    )
  }
  await Promise.all(processingPromises)
  return bitmapMap
}

// Helper to pre-load an image for the renderer worker
const loadBackgroundImage = (
  background: EditorState['frameStyles']['background'],
): Promise<HTMLImageElement | null> => {
  return new Promise((resolve) => {
    if ((background.type !== 'image' && background.type !== 'wallpaper') || !background.imageUrl) {
      resolve(null)
      return
    }
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => {
      log.error(`[RendererPage] Failed to load background image for export: ${img.src}`)
      resolve(null) // Resolve with null on error to not block rendering
    }
    const finalUrl = background.imageUrl.startsWith('blob:') ? background.imageUrl : `media://${background.imageUrl}`
    img.src = finalUrl
  })
}

export function RendererPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const webcamVideoRef = useRef<HTMLVideoElement>(null)
  const clipContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    log.info('[RendererPage] Component mounted. Setting up listeners.')

    const cleanup = window.electronAPI.onRenderStart(async (payload: RenderStartPayload) => {
      const { projectState, exportSettings, renderWidth, renderHeight } = payload
      const canvas = canvasRef.current
      const video = videoRef.current
      const webcamVideo = webcamVideoRef.current

      try {
        log.info('[RendererPage] Received "render:start" event.', { exportSettings })
        if (!canvas || !video) throw new Error('Canvas or Video ref is not available.')

        // --- 1. SETUP CANVAS AND CONTEXT ---
        const { resolution, fps } = exportSettings
        // Never allocate a canvas at the full target size (an 8K RGBA frame is
        // ~132 MB). Draw at the render cap; FFmpeg scales up to the target.
        const target = exportDimensions(resolution, projectState.aspectRatio)
        // The main process picks the render size (the source resolution for a
        // cloud intermediate, the capped target otherwise) and declares it to
        // FFmpeg's raw input. The canvas must match exactly, or the piped frames
        // are read at the wrong size and the intermediate comes out corrupted.
        const { width: outputWidth, height: outputHeight } =
          renderWidth && renderHeight
            ? { width: renderWidth, height: renderHeight }
            : applyRenderCap(target.width, target.height)

        canvas.width = outputWidth
        canvas.height = outputHeight
        const ctx = canvas.getContext('2d', {
          alpha: false,
          desynchronized: true,
          willReadFrequently: true,
        })
        if (!ctx) throw new Error('Failed to get 2D context from canvas.')

        // --- 2. PREPARE STATE AND ASSETS ---
        useEditorStore.setState(projectState)
        let finalCursorBitmaps = new Map<string, CursorImageBitmap>()
        if (projectState.platform === 'win32' || projectState.platform === 'darwin') {
          if (projectState.cursorTheme) {
            const scale = (await window.electronAPI.getSetting<number>('recorder.cursorScale')) || 2
            log.info(`[RendererPage] Regenerating bitmaps for ${projectState.platform} at scale ${scale}x`)
            if (projectState.platform === 'win32') {
              finalCursorBitmaps = await prepareWindowsCursorBitmaps(projectState.cursorTheme, scale)
            } else {
              finalCursorBitmaps = await prepareMacOSCursorBitmaps(projectState.cursorTheme, scale)
            }
          }
        } else {
          // Linux: the cursor is captured from the OS. Apply the same post-processing
          // scale the editor uses (recorder.cursorScale), so preview and export draw
          // the cursor at the same size.
          const linuxScale = (await window.electronAPI.getSetting<number>('recorder.cursorScale')) || 1
          log.info(`[RendererPage] Preparing Linux bitmaps from project state at ${linuxScale}x.`)
          finalCursorBitmaps = await prepareCursorBitmaps(projectState.cursorImages, linuxScale)
        }
        // Icon picker glyphs come from the bundled theme pack (shipped on every
        // platform including Linux), so the export shows the same cursor icons
        // the preview does. Load the theme in this (renderer-worker) window too.
        const iconScale = (await window.electronAPI.getSetting<number>('recorder.cursorScale')) || 1
        const iconTheme = await window.electronAPI.loadCursorTheme('default')
        const finalCursorIcons = await prepareCursorIcons(iconTheme, iconScale)
        const projectStateWithCursorBitmaps = {
          ...projectState,
          cursorBitmapsToRender: finalCursorBitmaps,
          cursorIconsToRender: finalCursorIcons,
        }
        const bgImage = await loadBackgroundImage(projectState.frameStyles.background)

        // --- 3. LOAD VIDEO SOURCES ---
        const loadVideo = (videoElement: HTMLVideoElement, source: string, path: string): Promise<void> =>
          new Promise((resolve, reject) => {
            videoElement.onloadedmetadata = () => {
              log.info(`[RendererPage] ${source} metadata loaded.`)
              resolve()
            }
            videoElement.onerror = (e) => reject(new Error(`Failed to load ${source}: ${e}`))
            videoElement.src = `media://${path}`
            videoElement.muted = true
            videoElement.load()
          })

        const loadPromises: Promise<void>[] = [loadVideo(video, 'Main video', projectStateWithCursorBitmaps.videoPath!)]
        const hasWebcam = Boolean(
          projectStateWithCursorBitmaps.webcamVideoPath &&
          typeof projectStateWithCursorBitmaps.webcamVideoPath === 'string',
        )
        if (hasWebcam && webcamVideo) {
          loadPromises.push(loadVideo(webcamVideo, 'Webcam video', projectStateWithCursorBitmaps.webcamVideoPath!))
        }
        await Promise.all(loadPromises)

        // --- 3b. LOAD IMPORTED VIDEO CLIPS ---
        const clipContainer = clipContainerRef.current
        if (clipContainer) clipContainer.innerHTML = ''
        const clipVideos: { clip: VideoClip; element: HTMLVideoElement }[] = []
        const waitForMetadata = (element: HTMLVideoElement, label: string): Promise<void> =>
          new Promise((resolve) => {
            if (element.readyState >= 1) {
              resolve()
              return
            }
            const cleanup = () => {
              clearTimeout(timeout)
              element.removeEventListener('loadedmetadata', onLoaded)
              element.removeEventListener('error', onError)
            }
            const onLoaded = () => {
              cleanup()
              resolve()
            }
            const onError = () => {
              cleanup()
              log.error(`[RendererPage] Failed to load ${label}`)
              resolve()
            }
            const timeout = setTimeout(() => {
              cleanup()
              log.warn(`[RendererPage] Timed out loading ${label}`)
              resolve()
            }, 8000)
            element.addEventListener('loadedmetadata', onLoaded)
            element.addEventListener('error', onError)
          })

        for (const clip of projectState.videoClips ?? []) {
          const element = document.createElement('video')
          element.muted = true
          element.preload = 'auto'
          element.style.display = 'none'
          element.src = `media://${clip.filePath}`
          clipContainer?.appendChild(element)
          await waitForMetadata(element, `clip ${clip.name || clip.filePath}`)
          clipVideos.push({ clip, element })
        }
        // Bottom-most layer first, matching the preview and the timeline rows.
        clipVideos.sort((a, b) => (a.clip.order ?? 0) - (b.clip.order ?? 0))

        // --- 4. CALCULATE EXPORT DURATION AND FRAMES ---
        let exportDuration: number
        if (typeof payload.duration === 'number' && Number.isFinite(payload.duration)) {
          exportDuration = payload.duration
        } else {
          let calculated = Number(projectState.duration) || 0
          Object.values(projectState.cutRegions).forEach((region) => (calculated -= region.duration))
          Object.values(projectState.speedRegions).forEach((region) => {
            calculated -= region.duration
            calculated += region.duration / region.speed
          })
          exportDuration = calculated
        }
        exportDuration = Math.max(0, exportDuration)
        const fullTotalFrames = Math.floor(exportDuration * fps)

        const isChunked = typeof payload.chunkIndex === 'number' && typeof payload.startFrame === 'number'
        const startFrame = isChunked ? Math.max(0, payload.startFrame!) : 0
        const endFrame =
          isChunked && typeof payload.endFrame === 'number'
            ? Math.min(payload.endFrame, fullTotalFrames)
            : fullTotalFrames
        const chunkTotalFrames = Math.max(1, endFrame - startFrame)

        log.info(
          `[RendererPage] Starting seek-driven rendering. ${
            isChunked
              ? `Chunk #${payload.chunkIndex} [frames ${startFrame}..${endFrame}), slice count: ${chunkTotalFrames}`
              : `Total frames: ${fullTotalFrames}`
          }, Export duration: ${exportDuration.toFixed(2)}s`,
        )

        // --- 5. SETUP SEEK-DRIVEN RENDER LOOP ---
        const seekVideo = (videoElement: HTMLVideoElement, targetTime: number): Promise<void> => {
          const maxDuration =
            Number.isFinite(videoElement.duration) && videoElement.duration > 0 ? videoElement.duration : Infinity
          const clampedTarget = Math.max(0, Math.min(targetTime, maxDuration))

          if (Math.abs(videoElement.currentTime - clampedTarget) < 0.001) {
            return Promise.resolve()
          }
          return new Promise<void>((resolve) => {
            let timeout: NodeJS.Timeout | null = null
            const onDone = () => {
              if (timeout) clearTimeout(timeout)
              videoElement.removeEventListener('seeked', onDone)
              videoElement.removeEventListener('error', onDone)
              resolve()
            }
            timeout = setTimeout(onDone, 300)
            videoElement.addEventListener('seeked', onDone, { once: true })
            videoElement.addEventListener('error', onDone, { once: true })
            const prevTime = videoElement.currentTime
            videoElement.currentTime = clampedTarget
            if (videoElement.currentTime === prevTime && !videoElement.seeking) {
              onDone()
            }
          })
        }

        // Bounded pipeline for in-flight frame writes. This keeps Chromium's render engine
        // and FFmpeg's encoding process running in parallel without unbounded memory growth.
        const MAX_IN_FLIGHT = 3
        const inFlightWrites: Promise<{ aborted: boolean }>[] = []
        let isAborted = false

        for (let frame = startFrame; frame < endFrame; frame++) {
          if (inFlightWrites.length >= MAX_IN_FLIGHT) {
            const earliest = await inFlightWrites.shift()!
            if (earliest.aborted) {
              log.info('[RendererPage] Export aborted by the main process; stopping render loop.')
              isAborted = true
              break
            }
          }

          const exportTimestamp = frame / fps
          const sourceTimestamp = mapExportTimeToSourceTime(
            exportTimestamp,
            projectState.duration,
            projectState.cutRegions,
            projectState.speedRegions,
          )

          // Create seek promises for all video elements
          const mainSeek = seekVideo(video, sourceTimestamp)
          const webcamSeek = hasWebcam && webcamVideo ? seekVideo(webcamVideo, sourceTimestamp) : Promise.resolve()

          // Imported clips only contribute frames while the playhead is inside
          // their range; each one is seeked to its own source time.
          const activeClipLayers: VideoClipLayer[] = []
          const clipSeeks: Promise<void>[] = []
          for (const { clip, element } of clipVideos) {
            const clipSourceTime = sourceTimestamp - clip.startTime
            if (clipSourceTime < 0 || clipSourceTime >= clip.duration) continue
            const clamped = getClipSourceTime(clip, sourceTimestamp, clip.sourceDuration || element.duration || 0)
            clipSeeks.push(seekVideo(element, clamped))
            activeClipLayers.push({ clip, element })
          }

          // Wait for all seeks to complete
          await Promise.all([mainSeek, webcamSeek, ...clipSeeks])

          // Now that videos are at the correct time, draw the scene
          await drawScene(
            ctx,
            projectStateWithCursorBitmaps,
            video,
            webcamVideo,
            sourceTimestamp, // Use the precise source timestamp for drawing
            outputWidth,
            outputHeight,
            bgImage,
            activeClipLayers,
          )

          // Send the rendered frame to the main process. Direct view on buffer avoids re-allocation.
          const imageData = ctx.getImageData(0, 0, outputWidth, outputHeight)
          const frameBuffer = new Uint8Array(
            imageData.data.buffer,
            imageData.data.byteOffset,
            imageData.data.byteLength,
          )
          const progress = ((frame - startFrame + 1) / chunkTotalFrames) * 100
          inFlightWrites.push(
            window.electronAPI
              .sendFrameToMain({ frame: frameBuffer, progress, chunkIndex: payload.chunkIndex })
              .catch(() => ({ aborted: true })),
          )
        }

        // Drain remaining in-flight writes
        for (const pending of inFlightWrites) {
          const res = await pending
          if (res.aborted) {
            isAborted = true
            break
          }
        }

        if (isAborted) {
          log.info('[RendererPage] Render aborted; skipping finishRender signal.')
          return
        }

        // --- 6. FINISH ---
        log.info(
          `[RendererPage] Render loop finished${isChunked ? ` for chunk #${payload.chunkIndex}` : ''}. Sending "finishRender" signal.`,
        )
        window.electronAPI.finishRender(isChunked ? { chunkIndex: payload.chunkIndex } : undefined)
      } catch (error) {
        log.error('[RendererPage] CRITICAL ERROR during render process:', error)
      }
    })

    log.info('[RendererPage] Sending "render:ready" signal to main process.')
    window.electronAPI.rendererReady()

    return () => {
      log.info('[RendererPage] Component unmounted. Cleaning up listener.')
      if (typeof cleanup === 'function') cleanup()
    }
  }, [])

  return (
    <div>
      <h1>Renderer Worker</h1>
      <p>This page is hidden and used for video exporting.</p>
      <canvas ref={canvasRef}></canvas>
      <video ref={videoRef} style={{ display: 'none' }}></video>
      <video ref={webcamVideoRef} style={{ display: 'none' }}></video>
      <div ref={clipContainerRef} style={{ display: 'none' }} />
    </div>
  )
}
