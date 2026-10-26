// Wayland area recording: the portal hands over a whole monitor, so the user's
// selection is cropped out of the renderer's WebM in the same pass that
// transcodes it. These tests pin the argument shapes that pass makes, and in
// particular that the crop never collides with the audio filter graph.
import { describe, expect, test } from 'vitest'
import { buildMacMuxArgs } from './build-mux-args'

const WEBM = '/tmp/screen.webm'
const MIC = '/tmp/mic.m4a'
const OUT = '/tmp/final.mp4'

const CROP = { x: 10, y: 20, width: 640, height: 480 }
const FILTER = 'crop=640:480:10:20'

const audioCombos: Array<{ name: string; mic: string | undefined; webmAudio: boolean }> = [
  { name: 'no audio', mic: undefined, webmAudio: false },
  { name: 'mic only', mic: MIC, webmAudio: false },
  { name: 'webm system audio only', mic: undefined, webmAudio: true },
  { name: 'webm system audio + mic', mic: MIC, webmAudio: true },
]

describe('buildMacMuxArgs — Wayland area crop', () => {
  test('video-only: crops with -vf, keeping the output audio-free', () => {
    const args = buildMacMuxArgs({
      screenWebmInput: WEBM,
      micAudioInput: undefined,
      output: OUT,
      webmHasSystemAudio: false,
      crop: CROP,
    })

    expect(args).toEqual([
      '-y',
      '-i',
      WEBM,
      '-vf',
      FILTER,
      '-map',
      '0:v',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-an',
      OUT,
    ])
  })

  test('mic only: the crop joins the filter graph and the video is mapped from it', () => {
    const args = buildMacMuxArgs({
      screenWebmInput: WEBM,
      micAudioInput: MIC,
      output: OUT,
      webmHasSystemAudio: false,
      crop: CROP,
    })

    expect(args).toEqual([
      '-y',
      '-i',
      WEBM,
      '-i',
      MIC,
      '-filter_complex',
      `[0:v]${FILTER}[v]`,
      '-map',
      '[v]',
      '-map',
      '1:a',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'copy',
      '-metadata:s:a:0',
      'handler_name=mic',
      '-metadata:s:a:0',
      'title=mic',
      '-shortest',
      OUT,
    ])
  })

  test('webm system audio: the crop link is appended to the audio graph', () => {
    const args = buildMacMuxArgs({
      screenWebmInput: WEBM,
      micAudioInput: undefined,
      output: OUT,
      webmHasSystemAudio: true,
      crop: CROP,
    })

    const graph = args[args.indexOf('-filter_complex') + 1]
    expect(graph).toBe(`[0:a]aresample=async=1,apad[sys];[0:v]${FILTER}[v]`)
    expect(args[args.indexOf('-map') + 1]).toBe('[v]')
  })

  test('webm system audio + mic: crop and both audio streams share one graph', () => {
    const args = buildMacMuxArgs({
      screenWebmInput: WEBM,
      micAudioInput: MIC,
      output: OUT,
      webmHasSystemAudio: true,
      crop: CROP,
    })

    const graph = args[args.indexOf('-filter_complex') + 1]
    // Two separate streams, not a mix: the crop is just a third link in the graph.
    expect(graph).toContain('[1:a]aresample=async=1,apad[mic]')
    expect(graph).toContain('[0:a]aresample=async=1,apad[sys]')
    expect(graph).toContain(`[0:v]${FILTER}[v]`)
    expect(args[args.indexOf('-map') + 1]).toBe('[v]')
    // Both streams are mapped, mic first.
    expect(args).toContain('[mic]')
    expect(args.indexOf('[mic]')).toBeLessThan(args.indexOf('[sys]'))
  })

  test('never passes -vf and -filter_complex to the same output', () => {
    for (const combo of audioCombos) {
      const args = buildMacMuxArgs({
        screenWebmInput: WEBM,
        micAudioInput: combo.mic,
        output: OUT,
        webmHasSystemAudio: combo.webmAudio,
        crop: CROP,
      })
      const hasVf = args.includes('-vf')
      const hasComplex = args.includes('-filter_complex')
      expect(hasVf && hasComplex, `${combo.name} passed both`).toBe(false)
      expect(hasVf || hasComplex, `${combo.name} passed neither`).toBe(true)
    }
  })

  test('no crop leaves the arguments untouched', () => {
    for (const crop of [undefined, null]) {
      const withCrop = buildMacMuxArgs({
        screenWebmInput: WEBM,
        micAudioInput: MIC,
        output: OUT,
        webmHasSystemAudio: true,
        crop,
      })
      const withoutCrop = buildMacMuxArgs({
        screenWebmInput: WEBM,
        micAudioInput: MIC,
        output: OUT,
        webmHasSystemAudio: true,
      })
      expect(withCrop).toEqual(withoutCrop)
      expect(withCrop).not.toContain('-vf')
      expect(withCrop.join(' ')).not.toContain('crop=')
    }
  })
})
