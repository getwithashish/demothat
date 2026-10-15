import { describe, expect, it } from 'vitest'
import { buildCloudFallbackArgs } from './build-export-args'

// The Standard (Lanczos) fallback for a cloud export that failed: FFmpeg reads
// the intermediate (video + muxed audio) and lands on the exact target.

describe('buildCloudFallbackArgs', () => {
  it('scales the intermediate to the exact target from its own input', () => {
    const args = buildCloudFallbackArgs({
      intermediatePath: '/tmp/intermediate.mp4',
      outputPath: '/tmp/out.mp4',
      targetWidth: 7680,
      targetHeight: 4320,
    })
    expect(args).toContain('/tmp/intermediate.mp4')
    expect(args[args.length - 1]).toBe('/tmp/out.mp4')
    expect(args).toEqual(expect.arrayContaining(['-vf', 'scale=7680:4320:flags=lanczos']))
  })

  it('encodes 8K as HEVC and tags it hvc1, copying the audio it already has', () => {
    const args = buildCloudFallbackArgs({
      intermediatePath: '/tmp/intermediate.mp4',
      outputPath: '/tmp/out.mp4',
      targetWidth: 7680,
      targetHeight: 4320,
    })
    expect(args.join(' ')).toContain('libx265')
    expect(args).toEqual(expect.arrayContaining(['-tag:v', 'hvc1']))
    // Audio was muxed by the render: copy, do not re-encode.
    expect(args).toEqual(expect.arrayContaining(['-map', '0:a?', '-c:a', 'copy']))
    expect(args.join(' ')).toContain('+faststart')
  })

  it('uses H.264 below the 8K threshold and reports progress on stdout', () => {
    const args = buildCloudFallbackArgs({
      intermediatePath: '/tmp/intermediate.mp4',
      outputPath: '/tmp/out.mp4',
      targetWidth: 3840,
      targetHeight: 2160,
    })
    const joined = args.join(' ')
    expect(joined).toContain('libx264')
    expect(joined).not.toContain('libx265')
    expect(args).toEqual(expect.arrayContaining(['-progress', 'pipe:1', '-nostats']))
  })
})
