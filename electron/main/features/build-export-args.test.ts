import { describe, expect, it } from 'vitest'
import {
  buildExportArgs,
  computeExportDuration,
  mapSourceTimeToExportTime,
  needsBuiltInClickSound,
  type ExportAudioClip,
  type ExportProjectState,
} from './build-export-args'

function state(overrides: Partial<ExportProjectState> = {}): ExportProjectState {
  return { aspectRatio: '16:9', duration: 10, ...overrides }
}

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

/** Like argValue but for output-side flags that also appear on the input side. */
function lastArgValue(args: string[], flag: string): string | undefined {
  const index = args.lastIndexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

const musicClip: ExportAudioClip = {
  filePath: '/music.mp3',
  startTime: 1,
  duration: 4,
  sourceStart: 0,
  sourceDuration: 4,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  loop: false,
  kind: 'music',
}

const clickClip: ExportAudioClip = {
  filePath: '',
  startTime: 2,
  duration: 0.25,
  sourceStart: 0,
  sourceDuration: 0.25,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  loop: false,
  kind: 'click',
}

const mp4 = (overrides = {}) => ({
  resolution: '1080p' as const,
  fps: 30,
  format: 'mp4',
  quality: 'medium' as const,
  ...overrides,
})

function build(projectState: ExportProjectState, exportSettings = mp4(), extra: Record<string, unknown> = {}) {
  return buildExportArgs({
    projectState,
    exportSettings,
    outputPath: '/out.mp4',
    renderWidth: 1920,
    renderHeight: 1080,
    targetWidth: 1920,
    targetHeight: 1080,
    clickSoundPath: null,
    ...extra,
  })
}

describe('buildExportArgs', () => {
  it('builds a silent 1080p MP4 from the rawvideo input', () => {
    const args = build(state())

    expect(argValue(args, '-s')).toBe('1920x1080')
    expect(argValue(args, '-r')).toBe('30')
    expect(lastArgValue(args, '-pix_fmt')).toBe('yuv420p')
    expect(lastArgValue(args, '-c:v')).toBe('libx264')
    expect(lastArgValue(args, '-preset')).toBe('medium')
    expect(lastArgValue(args, '-crf')).toBe('23')
    expect(argValue(args, '-t')).toBe('10')
    expect(args).toContain('0:v:0')
    expect(args).not.toContain('-filter_complex')
    expect(args[args.length - 1]).toBe('/out.mp4')
  })

  it('honours the quality setting', () => {
    const args = build(state(), mp4({ quality: 'high' }))
    expect(lastArgValue(args, '-preset')).toBe('slow')
    expect(lastArgValue(args, '-crf')).toBe('18')
  })

  it('adds the original audio track and mixes it to [aout]', () => {
    const args = build(state({ hasAudioTrack: true, videoPath: '/screen.mp4', volume: 0.5 }))

    expect(args).toContain('/screen.mp4')
    expect(args).toContain('-filter_complex')
    expect(args).toContain('[aout]')
    expect(argValue(args, '-c:a')).toBe('aac')
    expect(args.join(' ')).toContain('volume=0.5')
  })

  it('adds music clips as inputs, delayed to their export time', () => {
    const args = build(state({ audioClips: [musicClip] }))

    expect(args).toContain('/music.mp3')
    expect(args.join(' ')).toContain('adelay=1000|1000')
    expect(args.join(' ')).toContain('amix=inputs=1')
  })

  it('adds click sounds only when a click path is provided', () => {
    const withClicks = state({ mouseClickSoundsEnabled: true, audioClips: [clickClip], mouseClickSoundVolume: 0.8 })

    expect(needsBuiltInClickSound(withClicks)).toBe(true)
    const args = build(withClicks, mp4(), { clickSoundPath: '/click.wav' })
    expect(args).toContain('/click.wav')
    expect(args.join(' ')).toContain('asplit=1[clicksrc0]')
    expect(args.join(' ')).toContain('adelay=2000|2000')

    // Without a resolved path the builder must not reference a missing file.
    expect(build(withClicks).join(' ')).not.toContain('asplit')
  })

  it('does not ask for a built-in click when a custom sound is configured', () => {
    const withCustom = state({
      mouseClickSoundsEnabled: true,
      audioClips: [clickClip],
      mouseClickSoundPath: '/custom.wav',
    })
    expect(needsBuiltInClickSound(withCustom)).toBe(false)
  })

  it('builds a GIF with the palette filter and no H.264', () => {
    const args = build(state(), mp4({ format: 'gif' }))

    expect(argValue(args, '-vf')).toBe('split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse')
    expect(args).not.toContain('libx264')
    expect(args).not.toContain('-c:v')
    expect(args[args.length - 1]).toBe('/out.mp4')
  })

  it('shortens the output for cuts and stretches it for slow-motion', () => {
    const args = build(
      state({
        cutRegions: { c1: { startTime: 0, duration: 2 } },
        speedRegions: { s1: { startTime: 4, duration: 2, speed: 2 } },
      }),
    )
    // 10s - 2s cut (=> 8s) then a 2s region at 2x (-2s + 1s) = 7s
    expect(argValue(args, '-t')).toBe('7')
  })

  it('renders at the cap and scales to the exact 8K target with HEVC', () => {
    const args = build(state(), mp4({ resolution: '8k' }), {
      renderWidth: 3840,
      renderHeight: 2160,
      targetWidth: 7680,
      targetHeight: 4320,
    })

    // Raw frames arrive at the capped render size, not the target.
    expect(argValue(args, '-s')).toBe('3840x2160')
    expect(lastArgValue(args, '-vf')).toBe('scale=7680:4320:flags=lanczos')
    expect(lastArgValue(args, '-c:v')).toBe('libx265')
    expect(lastArgValue(args, '-tag:v')).toBe('hvc1')
    expect(lastArgValue(args, '-pix_fmt')).toBe('yuv420p')
  })

  it('keeps H.264 with no scaling for targets inside the cap', () => {
    const args = build(state(), mp4({ resolution: '4k' }), {
      renderWidth: 3840,
      renderHeight: 2160,
      targetWidth: 3840,
      targetHeight: 2160,
    })

    expect(argValue(args, '-s')).toBe('3840x2160')
    expect(lastArgValue(args, '-c:v')).toBe('libx264')
    expect(args).not.toContain('-vf')
    expect(args).not.toContain('hvc1')
  })

  it('keeps the audio filter graph and the scale filter together at 8K', () => {
    const args = build(state({ audioClips: [musicClip] }), mp4({ resolution: '8k' }), {
      renderWidth: 3840,
      renderHeight: 2160,
      targetWidth: 7680,
      targetHeight: 4320,
    })

    expect(lastArgValue(args, '-vf')).toBe('scale=7680:4320:flags=lanczos')
    expect(args).toContain('-filter_complex')
    expect(args).toContain('[aout]')
    expect(lastArgValue(args, '-c:v')).toBe('libx265')
  })

  it('asks FFmpeg to report its own progress on stdout', () => {
    const args = build(state())
    expect(argValue(args, '-progress')).toBe('pipe:1')
    expect(args).toContain('-nostats')
  })
})

describe('computeExportDuration', () => {
  it('is the source duration when there are no regions', () => {
    expect(computeExportDuration(state({ duration: 12 }))).toBe(12)
  })

  it('subtracts cuts and applies speed regions', () => {
    const projectState = state({
      duration: 10,
      cutRegions: { c: { startTime: 0, duration: 3 } },
      speedRegions: { s: { startTime: 3, duration: 4, speed: 2 } },
    })
    // 10 - 3 (cut) = 7, then a 4s region at 2x (-4s + 2s) = 5
    expect(computeExportDuration(projectState)).toBe(5)
  })
})

describe('mapSourceTimeToExportTime', () => {
  it('shifts times down after a cut', () => {
    const projectState = state({ duration: 10, cutRegions: { c: { startTime: 2, duration: 3 } } })
    expect(mapSourceTimeToExportTime(1, projectState)).toBe(1)
    expect(mapSourceTimeToExportTime(5, projectState)).toBe(2)
  })
})
