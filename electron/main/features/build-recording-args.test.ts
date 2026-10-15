import { describe, expect, test } from 'vitest'
import { buildFfmpegArgs } from './build-recording-args'

describe('buildFfmpegArgs', () => {
  test('overwrites stale recording outputs without prompting', () => {
    const args = buildFfmpegArgs(
      ['-f', 'gdigrab', '-i', 'desktop'],
      false,
      false,
      'DemoThat-recording-screen.mp4',
    )

    expect(args[0]).toBe('-y')
    expect(args).toContain('DemoThat-recording-screen.mp4')
  })

  test('maps microphone audio into the same output as screen video', () => {
    const args = buildFfmpegArgs(
      ['-f', 'alsa', '-i', 'default', '-f', 'x11grab', '-i', ':0.0'],
      false,
      true,
      'screen.mp4',
    )

    const screenOutputIndex = args.lastIndexOf('screen.mp4')
    expect(args.filter((arg) => arg === 'screen.mp4')).toHaveLength(1)
    expect(args.slice(0, screenOutputIndex)).toContain('1:v')
    expect(args.slice(0, screenOutputIndex)).toContain('0:a')
    expect(args.slice(0, screenOutputIndex)).toContain('aac')
  })

  test('keeps webcam output separate while recording microphone audio', () => {
    const args = buildFfmpegArgs(
      ['mic-input', 'webcam-input', 'screen-input'],
      true,
      true,
      'screen.mp4',
      'webcam.mp4',
    )

    expect(args.filter((arg) => arg === 'screen.mp4')).toHaveLength(1)
    expect(args.filter((arg) => arg === 'webcam.mp4')).toHaveLength(1)
    expect(args).toContain('2:v')
    expect(args).toContain('0:a')
    expect(args).toContain('1:v')
  })
})
