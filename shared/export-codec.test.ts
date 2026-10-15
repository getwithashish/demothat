import { describe, expect, it } from 'vitest'
import { GIF_MAX_HEIGHT, isFormatAllowed, selectExportCodec } from './export-codec'

describe('selectExportCodec', () => {
  it('uses H.264 at 4K and below', () => {
    expect(selectExportCodec(720)).toBe('h264')
    expect(selectExportCodec(1080)).toBe('h264')
    expect(selectExportCodec(1440)).toBe('h264')
    expect(selectExportCodec(2160)).toBe('h264')
  })

  it('uses HEVC above 4K', () => {
    expect(selectExportCodec(2161)).toBe('hevc')
    expect(selectExportCodec(4320)).toBe('hevc')
  })
})

describe('isFormatAllowed', () => {
  it('allows MP4 at any size', () => {
    expect(isFormatAllowed('mp4', 4320)).toBe(true)
    expect(isFormatAllowed('mp4', 1080)).toBe(true)
  })

  it('limits GIF to 2K', () => {
    expect(GIF_MAX_HEIGHT).toBe(1440)
    expect(isFormatAllowed('gif', 720)).toBe(true)
    expect(isFormatAllowed('gif', 1440)).toBe(true)
    expect(isFormatAllowed('gif', 2160)).toBe(false)
    expect(isFormatAllowed('gif', 4320)).toBe(false)
  })
})
