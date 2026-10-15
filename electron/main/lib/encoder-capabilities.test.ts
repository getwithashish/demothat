import { describe, expect, it } from 'vitest'
import { parseEncoderCapabilities } from './encoder-capabilities'

// Trimmed sample of `ffmpeg -hide_banner -encoders` from the bundled binary.
const SAMPLE = `Encoders:
 V..... = Video
 A..... = Audio
 ------
 V....D libx265              libx265 H.265 / HEVC (codec hevc)
 V..... hevc_v4l2m2m         V4L2 mem2mem HEVC encoder wrapper (codec hevc)
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 A....D aac                  AAC (Advanced Audio Coding)
`

describe('parseEncoderCapabilities', () => {
  it('finds libx265 and lists every HEVC encoder', () => {
    const capabilities = parseEncoderCapabilities(SAMPLE)
    expect(capabilities.libx265).toBe(true)
    expect(capabilities.hevcEncoders).toEqual(['libx265', 'hevc_v4l2m2m'])
  })

  it('reports no HEVC when the build lacks it', () => {
    const capabilities = parseEncoderCapabilities(' V....D libx264   libx264 H.264 / AVC (codec h264)')
    expect(capabilities.libx265).toBe(false)
    expect(capabilities.hevcEncoders).toEqual([])
  })

  it('detects a hardware-only HEVC build but still reports no libx265', () => {
    const capabilities = parseEncoderCapabilities(' V..... hevc_nvenc   NVIDIA NVENC hevc encoder (codec hevc)')
    expect(capabilities.libx265).toBe(false)
    expect(capabilities.hevcEncoders).toEqual(['hevc_nvenc'])
  })

  it('tolerates empty output', () => {
    expect(parseEncoderCapabilities('')).toEqual({ libx265: false, hevcEncoders: [] })
  })
})
