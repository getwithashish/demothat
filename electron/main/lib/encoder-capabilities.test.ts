import { describe, expect, it } from 'vitest'
import { parseEncoderCapabilities, selectBestH264Encoder } from './encoder-capabilities'

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

const HARDWARE_SAMPLE = `Encoders:
 V..... = Video
 A..... = Audio
 ------
 V..... h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 V..... h264_qsv             Intel Quick Sync Video H.264 (codec h264)
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
`

const MAC_SAMPLE = `Encoders:
 V..... h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
`

const LINUX_VAAPI_SAMPLE = `Encoders:
 V..... h264_vaapi           H.264/AVC (VAAPI) (codec h264)
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
`

describe('parseEncoderCapabilities', () => {
  it('finds libx265 and lists every HEVC and H.264 encoder', () => {
    const capabilities = parseEncoderCapabilities(SAMPLE)
    expect(capabilities.libx265).toBe(true)
    expect(capabilities.hevcEncoders).toEqual(['libx265', 'hevc_v4l2m2m'])
    expect(capabilities.libx264).toBe(true)
    expect(capabilities.h264Encoders).toEqual(['libx264'])
  })

  it('detects H.264 hardware encoders', () => {
    const capabilities = parseEncoderCapabilities(HARDWARE_SAMPLE)
    expect(capabilities.libx264).toBe(true)
    expect(capabilities.h264Encoders).toContain('h264_nvenc')
    expect(capabilities.h264Encoders).toContain('h264_qsv')
    expect(capabilities.h264Encoders).toContain('libx264')
  })

  it('detects macOS videotoolbox encoder', () => {
    const capabilities = parseEncoderCapabilities(MAC_SAMPLE)
    expect(capabilities.h264Encoders).toContain('h264_videotoolbox')
  })

  it('detects Linux VAAPI encoder', () => {
    const capabilities = parseEncoderCapabilities(LINUX_VAAPI_SAMPLE)
    expect(capabilities.h264Encoders).toContain('h264_vaapi')
  })

  it('reports no HEVC when the build lacks it', () => {
    const capabilities = parseEncoderCapabilities(' V....D libx264   libx264 H.264 / AVC (codec h264)')
    expect(capabilities.libx265).toBe(false)
    expect(capabilities.hevcEncoders).toEqual([])
    expect(capabilities.libx264).toBe(true)
    expect(capabilities.h264Encoders).toEqual(['libx264'])
  })

  it('detects a hardware-only HEVC build but still reports no libx265', () => {
    const capabilities = parseEncoderCapabilities(' V..... hevc_nvenc   NVIDIA NVENC hevc encoder (codec hevc)')
    expect(capabilities.libx265).toBe(false)
    expect(capabilities.hevcEncoders).toEqual(['hevc_nvenc'])
  })

  it('tolerates empty output', () => {
    expect(parseEncoderCapabilities('')).toEqual({
      libx265: false,
      hevcEncoders: [],
      libx264: false,
      h264Encoders: [],
    })
  })
})

describe('selectBestH264Encoder', () => {
  it('prefers nvenc over other encoders', () => {
    const caps = parseEncoderCapabilities(HARDWARE_SAMPLE)
    expect(selectBestH264Encoder(caps)).toBe('h264_nvenc')
  })

  it('selects videotoolbox on macOS when present', () => {
    const caps = parseEncoderCapabilities(MAC_SAMPLE)
    expect(selectBestH264Encoder(caps)).toBe('h264_videotoolbox')
  })

  it('selects vaapi on Linux when present', () => {
    const caps = parseEncoderCapabilities(LINUX_VAAPI_SAMPLE)
    expect(selectBestH264Encoder(caps)).toBe('h264_vaapi')
  })

  it('falls back to libx264 when no hardware encoder is available', () => {
    const caps = parseEncoderCapabilities(SAMPLE)
    expect(selectBestH264Encoder(caps)).toBe('libx264')
  })

  it('safely handles undefined or empty capabilities', () => {
    expect(selectBestH264Encoder(null)).toBe('libx264')
    expect(selectBestH264Encoder(undefined)).toBe('libx264')
  })
})
