/**
 * High-performance pure-math utilities for Virtual Camera video frames.
 * Shared across renderer process, web workers, and Electron main process.
 */

/**
 * Converts uncompressed RGBA pixel buffer to standard I420 (YUV420P) format.
 * Uses integer fixed-point math with bit-shifts for sub-5ms conversion on 1080p frames.
 *
 * @param rgba - Source RGBA pixels (length = width * height * 4)
 * @param width - Frame width in pixels (must be even)
 * @param height - Frame height in pixels (must be even)
 * @param out - Destination I420 buffer (length = width * height * 1.5)
 */
export function rgbaToI420(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, out: Uint8Array): void {
  if (width <= 0 || height <= 0) return
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

/**
 * Horizontally flips an I420 (YUV420P) video frame in-place with zero heap allocations.
 * Reverses each row of the Y, U, and V planar planes.
 *
 * @param data - In-place I420 buffer (length = width * height * 1.5)
 * @param width - Frame width in pixels
 * @param height - Frame height in pixels
 */
export function flipI420Horizontal(data: Uint8Array, width: number, height: number): void {
  if (width <= 0 || height <= 0) return

  // Flip Y plane (luma)
  for (let y = 0; y < height; y++) {
    const row = y * width
    let i = row
    let j = row + width - 1
    while (i < j) {
      const tmp = data[i]
      data[i] = data[j]
      data[j] = tmp
      i++
      j--
    }
  }

  // Flip U and V planes (chroma subsampled 2x2)
  const halfW = width >> 1
  const halfH = height >> 1
  const ySize = width * height
  const uSize = halfW * halfH

  for (let y = 0; y < halfH; y++) {
    const rowU = ySize + y * halfW
    const rowV = ySize + uSize + y * halfW
    let i = 0
    let j = halfW - 1
    while (i < j) {
      const tmpU = data[rowU + i]
      data[rowU + i] = data[rowU + j]
      data[rowU + j] = tmpU

      const tmpV = data[rowV + i]
      data[rowV + i] = data[rowV + j]
      data[rowV + j] = tmpV
      i++
      j--
    }
  }
}

/**
 * Creates a dark charcoal standby slate in I420 (YUV420P) format matching #17181b.
 * Y = 24, U = 128, V = 128.
 */
export function createStandbySlateI420(width: number, height: number): Uint8Array {
  const size = Math.floor(width * height * 1.5)
  const buf = new Uint8Array(size)
  const ySize = width * height
  buf.fill(24, 0, ySize)
  buf.fill(128, ySize)
  return buf
}
