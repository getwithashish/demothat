/**
 * Dedicated Web Worker for offloading Virtual Studio canvas frame processing
 * from the JavaScript UI thread.
 *
 * Receives ImageBitmap instances from the editor canvas via zero-copy Transferable,
 * renders onto an OffscreenCanvas, extracts pixels, and converts to I420 (YUV420P)
 * on a background worker thread.
 */

export const VIRTUAL_CAMERA_CANVAS_WORKER_CODE = `
function rgbaToI420(rgba, width, height, out) {
  const ySize = width * height
  const uvWidth = width >> 1
  const uvHeight = height >> 1
  const uOffset = ySize
  const vOffset = ySize + (ySize >> 2)

  let rgbaIdx = 0
  for (let y = 0; y < height; y++) {
    const yRow = y * width
    for (let x = 0; x < width; x++) {
      const r = rgba[rgbaIdx]
      const g = rgba[rgbaIdx + 1]
      const b = rgba[rgbaIdx + 2]
      rgbaIdx += 4
      out[yRow + x] = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16
    }
  }

  for (let y = 0; y < uvHeight; y++) {
    const y2 = y << 1
    const uvRow = y * uvWidth
    for (let x = 0; x < uvWidth; x++) {
      const x2 = x << 1
      const idx = (y2 * width + x2) << 2
      const r = rgba[idx]
      const g = rgba[idx + 1]
      const b = rgba[idx + 2]
      out[uOffset + uvRow + x] = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128
      out[vOffset + uvRow + x] = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128
    }
  }
}

let offscreen = null
let ctx = null
let cachedI420Buffer = null

self.onmessage = function (e) {
  const data = e.data
  if (!data || !data.bitmap) return

  const bitmap = data.bitmap
  const width = data.width || bitmap.width
  const height = data.height || bitmap.height
  const isMirrored = Boolean(data.isMirrored)
  const timestamp = data.timestamp

  try {
    if (!offscreen || offscreen.width !== width || offscreen.height !== height) {
      offscreen = new OffscreenCanvas(width, height)
      ctx = offscreen.getContext('2d', { willReadFrequently: true })
    }

    if (ctx) {
      if (isMirrored) {
        ctx.save()
        ctx.translate(width, 0)
        ctx.scale(-1, 1)
      }

      ctx.drawImage(bitmap, 0, 0, width, height)

      if (isMirrored) {
        ctx.restore()
      }

      const imgData = ctx.getImageData(0, 0, width, height)
      const expectedI420Size = Math.floor(width * height * 1.5)
      if (!cachedI420Buffer || cachedI420Buffer.byteLength !== expectedI420Size) {
        cachedI420Buffer = new Uint8Array(expectedI420Size)
      }

      rgbaToI420(imgData.data, width, height, cachedI420Buffer)

      // Make a transferable copy of the I420 buffer to send back to the main thread
      const outBuffer = new Uint8Array(cachedI420Buffer)

      self.postMessage(
        {
          success: true,
          width: width,
          height: height,
          format: 'yuv420p',
          timestamp: timestamp,
          buffer: outBuffer.buffer,
        },
        [outBuffer.buffer]
      )
    }
  } catch (err) {
    self.postMessage({
      success: false,
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
