import { describe, expect, it } from 'vitest'
import { qualityToX264Args, fastX264Args, encoderToH264Args } from './export-video-args'

describe('qualityToX264Args', () => {
  it('maps each quality level to its documented CRF and preset', () => {
    expect(qualityToX264Args('low')).toEqual([
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '28',
      '-pix_fmt',
      'yuv420p',
    ])
    expect(qualityToX264Args('medium')).toEqual([
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
    ])
    expect(qualityToX264Args('high')).toEqual([
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
    ])
  })

  it('reproduces the previous behaviour for medium (libx264, preset medium, CRF 23)', () => {
    const args = qualityToX264Args('medium')
    expect(args[args.indexOf('-c:v') + 1]).toBe('libx264')
    expect(args[args.indexOf('-preset') + 1]).toBe('medium')
    expect(args[args.indexOf('-crf') + 1]).toBe('23')
  })

  it('uses a slower preset for high quality', () => {
    const presets = ['low', 'medium', 'high'].map(
      (q) => qualityToX264Args(q)[qualityToX264Args(q).indexOf('-preset') + 1],
    )
    expect(presets).toEqual(['medium', 'medium', 'slow'])
  })

  it('always encodes yuv420p for player compatibility', () => {
    for (const quality of ['low', 'medium', 'high'] as const) {
      const args = qualityToX264Args(quality)
      expect(args[args.indexOf('-pix_fmt') + 1]).toBe('yuv420p')
    }
  })

  it('falls back to medium for an unknown or missing quality', () => {
    expect(qualityToX264Args(undefined)).toEqual(qualityToX264Args('medium'))
    expect(qualityToX264Args(null)).toEqual(qualityToX264Args('medium'))
    expect(qualityToX264Args('bogus')).toEqual(qualityToX264Args('medium'))
  })
})

describe('fastX264Args', () => {
  it('maps to faster presets for parallel chunk encoding', () => {
    expect(fastX264Args('low')).toEqual(['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p'])
    expect(fastX264Args('medium')).toEqual([
      '-c:v',
      'libx264',
      '-preset',
      'faster',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
    ])
    expect(fastX264Args('high')).toEqual(['-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p'])
  })
})

describe('encoderToH264Args', () => {
  it('builds NVENC args with preset and cq', () => {
    const args = encoderToH264Args('h264_nvenc', 'medium')
    expect(args).toEqual(['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23', '-pix_fmt', 'yuv420p'])
  })

  it('builds VideoToolbox args with q:v', () => {
    const args = encoderToH264Args('h264_videotoolbox', 'high')
    expect(args).toEqual(['-c:v', 'h264_videotoolbox', '-q:v', '80', '-pix_fmt', 'yuv420p'])
  })

  it('builds QSV args with global_quality and preset', () => {
    const args = encoderToH264Args('h264_qsv', 'medium')
    expect(args).toEqual(['-c:v', 'h264_qsv', '-global_quality', '23', '-preset', 'faster', '-pix_fmt', 'nv12'])
  })

  it('builds VAAPI args with qp', () => {
    const args = encoderToH264Args('h264_vaapi', 'low')
    expect(args).toEqual(['-c:v', 'h264_vaapi', '-qp', '28'])
  })

  it('falls back to fast libx264 for software encoder', () => {
    expect(encoderToH264Args('libx264', 'medium')).toEqual(fastX264Args('medium'))
    expect(encoderToH264Args(undefined, 'medium')).toEqual(fastX264Args('medium'))
  })
})
