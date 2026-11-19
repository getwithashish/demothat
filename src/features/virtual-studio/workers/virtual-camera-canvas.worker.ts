/**
 * Dedicated Web Worker for offloading Virtual Studio canvas frame processing
 * from the JavaScript UI thread.
 *
 * Receives ImageBitmap instances from the editor canvas via zero-copy Transferable,
 * scales cleanly with aspect-fit onto an OffscreenCanvas, and extracts 1920x1080 RGBA pixels
 * on background worker threads with <0.5ms UI thread footprint.
 */

export const VIRTUAL_CAMERA_CANVAS_WORKER_CODE = `
let offscreen = null
let ctx = null
let workerFrameCount = 0
let lastDevLogTime = 0

self.onmessage = function (e) {
  const renderStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const data = e.data
  if (!data || !data.bitmap) return

  const bitmap = data.bitmap
  const targetW = data.width || 1920
  const targetH = data.height || 1080
  const isMirrored = Boolean(data.isMirrored)
  const timestamp = data.timestamp
  const sequenceId = data.sequenceId
  const workerIndex = data.workerIndex
  const postMessageTime = data.postMessageTime || timestamp

  try {
    if (!offscreen || offscreen.width !== targetW || offscreen.height !== targetH) {
      offscreen = new OffscreenCanvas(targetW, targetH)
      ctx = offscreen.getContext('2d', { willReadFrequently: true })
    }

    if (ctx) {
      const bw = bitmap.width
      const bh = bitmap.height
      const isExact1080p = bw === targetW && bh === targetH

      // When dimensions match 1:1, disable smoothing for fastest blit and crisp text
      ctx.imageSmoothingEnabled = !isExact1080p
      if (!isExact1080p) {
        ctx.imageSmoothingQuality = 'medium'
      }

      if (isMirrored) {
        ctx.save()
        ctx.translate(targetW, 0)
        ctx.scale(-1, 1)
      }

      if (isExact1080p) {
        ctx.drawImage(bitmap, 0, 0, targetW, targetH)
      } else {
        const scale = Math.min(targetW / bw, targetH / bh)
        const dw = bw * scale
        const dh = bh * scale
        const dx = (targetW - dw) / 2
        const dy = (targetH - dh) / 2
        ctx.fillStyle = data.fallbackColor || 'black'
        ctx.fillRect(0, 0, targetW, targetH)
        ctx.drawImage(bitmap, dx, dy, dw, dh)
      }

      if (isMirrored) {
        ctx.restore()
      }

      const imgData = ctx.getImageData(0, 0, targetW, targetH)
      const renderEndTime = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const renderDurationMs = renderEndTime - renderStartTime
      workerFrameCount++

      // Throttled logging in dev (every ~60 frames or at least 2 seconds)
      if (typeof console !== 'undefined' && console.debug) {
        if (renderEndTime - lastDevLogTime >= 2000 || workerFrameCount % 60 === 0) {
          lastDevLogTime = renderEndTime
          const tag = workerIndex !== undefined ? ' #' + workerIndex : ''
          console.debug(
            \`[VirtualCameraCanvasWorker\${tag}] Frame #\${workerFrameCount}: render \${renderDurationMs.toFixed(2)}ms (\${targetW}x\${targetH})\`
          )
        }
      }

      // Zero-copy transfer of the exact 1920x1080 RGBA buffer back to main thread
      self.postMessage(
        {
          success: true,
          sequenceId: sequenceId,
          workerIndex: workerIndex,
          width: targetW,
          height: targetH,
          format: 'rgba',
          timestamp: timestamp,
          postMessageTime: postMessageTime,
          renderDurationMs: renderDurationMs,
          buffer: imgData.data.buffer,
        },
        [imgData.data.buffer]
      )
    }
  } catch (err) {
    self.postMessage({
      success: false,
      sequenceId: sequenceId,
      workerIndex: workerIndex,
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    try {
      bitmap.close()
    } catch {
      // Ignore close errors
    }
  }
}
`

export function createVirtualCameraCanvasWorkerUrl(): string {
  if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const blob = new Blob([VIRTUAL_CAMERA_CANVAS_WORKER_CODE], { type: 'application/javascript' })
    return URL.createObjectURL(blob)
  }
  return ''
}
