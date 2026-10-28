import { describe, expect, test } from 'vitest'
import { AUDIO_TRACK_TITLES, buildMuxArgs, buildMacMuxArgs } from './build-mux-args'

const SCREEN = '/tmp/screen.mp4'
const SYS = '/tmp/system.webm'
const OUT = '/tmp/final.mp4'
const WEBM = '/tmp/screen.webm'
const MIC = '/tmp/mic.m4a'

/** The stream name for index 0/1, as FFmpeg takes it. */
const title = (index: number, kind: 'mic' | 'system') => [
  '-metadata:s:a:' + String(index),
  'handler_name=' + AUDIO_TRACK_TITLES[kind],
  '-metadata:s:a:' + String(index),
  'title=' + AUDIO_TRACK_TITLES[kind],
]

describe('buildMuxArgs', () => {
  test('mic + system: two streams, mic first, each titled', () => {
    const args = buildMuxArgs({
      screenInput: SCREEN,
      systemAudioInput: SYS,
      output: OUT,
      hasMicAudio: true,
    })

    expect(args).toEqual([
      '-y',
      '-i',
      SCREEN,
      '-i',
      SYS,
      '-filter_complex',
      '[0:a]aresample=async=1,apad[mic];[1:a]aresample=async=1,apad[sys]',
      '-map',
      '0:v',
      '-map',
      '[mic]',
      '-map',
      '[sys]',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      ...title(0, 'mic'),
      ...title(1, 'system'),
      '-shortest',
      OUT,
    ])
  })

  test('mic + system: the mic is stream 0, because the app reads the order', () => {
    const args = buildMuxArgs({ screenInput: SCREEN, systemAudioInput: SYS, output: OUT, hasMicAudio: true })

    // The order of the two -map flags is the order of the streams in the output.
    expect(args.indexOf('[mic]')).toBeLessThan(args.indexOf('[sys]'))
    // Both are padded, so a source that stops early is silence rather than a
    // shorter stream that -shortest would then cut the video down to.
    expect(args[args.indexOf('-filter_complex') + 1]).toContain('apad')
  })

  test('system only: one stream, titled system', () => {
    const args = buildMuxArgs({
      screenInput: SCREEN,
      systemAudioInput: SYS,
      output: OUT,
      hasMicAudio: false,
    })

    expect(args).toEqual([
      '-y',
      '-i',
      SCREEN,
      '-i',
      SYS,
      '-filter_complex',
      '[1:a]aresample=async=1,apad[sys]',
      '-map',
      '0:v',
      '-map',
      '[sys]',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      ...title(0, 'system'),
      '-shortest',
      OUT,
    ])
  })

  test('mic only (no system audio): copies streams, and still names the track', () => {
    const args = buildMuxArgs({
      screenInput: SCREEN,
      systemAudioInput: undefined,
      output: OUT,
      hasMicAudio: true,
    })

    // A stream copy still accepts metadata, so the single track is identifiable.
    expect(args).toEqual(['-y', '-i', SCREEN, '-c', 'copy', ...title(0, 'mic'), OUT])
  })

  test('no audio at all: copies streams without filter graph', () => {
    const args = buildMuxArgs({
      screenInput: SCREEN,
      systemAudioInput: undefined,
      output: OUT,
      hasMicAudio: false,
    })

    // No audio to name: a stream title on a file with no audio streams is noise.
    expect(args).toEqual(['-y', '-i', SCREEN, '-c', 'copy', OUT])
  })

  test('paths with spaces are not pre-quoted (spawn handles them)', () => {
    const args = buildMuxArgs({
      screenInput: '/tmp/with space/screen.mp4',
      systemAudioInput: '/tmp/with space/system.webm',
      output: '/tmp/with space/out.mp4',
      hasMicAudio: false,
    })

    expect(args).toContain('/tmp/with space/screen.mp4')
    expect(args).toContain('/tmp/with space/system.webm')
    expect(args).toContain('/tmp/with space/out.mp4')
    // No bash-style quoting in args
    args.forEach((a) => expect(a).not.toMatch(/^".*"$/))
  })

  test('apad mux is bounded with an explicit -t when the duration is known', () => {
    const args = buildMuxArgs({
      screenInput: SCREEN,
      systemAudioInput: SYS,
      output: OUT,
      hasMicAudio: false,
      durationSec: 7.42,
    })
    const tIndex = args.indexOf('-t')
    expect(tIndex).toBeGreaterThan(-1)
    expect(args[tIndex + 1]).toBe('7.42')
    expect(tIndex).toBeLessThan(args.indexOf(OUT))
  })

  test('dropped when the duration is not known', () => {
    const args = buildMuxArgs({
      screenInput: SCREEN,
      systemAudioInput: SYS,
      output: OUT,
      hasMicAudio: false,
      durationSec: null,
    })
    expect(args).not.toContain('-t')
  })
})

describe('buildMacMuxArgs', () => {
  test('webm with system audio + mic: two streams, mic first, each titled', () => {
    const args = buildMacMuxArgs({
      screenWebmInput: WEBM,
      micAudioInput: MIC,
      output: OUT,
      webmHasSystemAudio: true,
    })

    expect(args).toEqual([
      '-y',
      '-i',
      WEBM,
      '-i',
      MIC,
      '-filter_complex',
      '[1:a]aresample=async=1,apad[mic];[0:a]aresample=async=1,apad[sys]',
      '-map',
      '0:v',
      '-map',
      '[mic]',
      '-map',
      '[sys]',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      ...title(0, 'mic'),
      ...title(1, 'system'),
      '-shortest',
      OUT,
    ])
  })

  test('webm with system audio only: one stream, titled system', () => {
    const args = buildMacMuxArgs({
      screenWebmInput: WEBM,
      micAudioInput: undefined,
      output: OUT,
      webmHasSystemAudio: true,
    })

    expect(args).toEqual([
      '-y',
      '-i',
      WEBM,
      '-filter_complex',
      '[0:a]aresample=async=1,apad[sys]',
      '-map',
      '0:v',
      '-map',
      '[sys]',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      ...title(0, 'system'),
      '-shortest',
      OUT,
    ])
  })

  test('mic only (no system audio in webm): copy mic stream, named', () => {
    const args = buildMacMuxArgs({
      screenWebmInput: WEBM,
      micAudioInput: MIC,
      output: OUT,
      webmHasSystemAudio: false,
    })

    expect(args).toEqual([
      '-y',
      '-i',
      WEBM,
      '-i',
      MIC,
      '-map',
      '0:v',
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
      ...title(0, 'mic'),
      '-shortest',
      OUT,
    ])
  })

  test('crop with the mic copied: the video link joins the graph and the track is named', () => {
    const args = buildMacMuxArgs({
      screenWebmInput: WEBM,
      micAudioInput: MIC,
      output: OUT,
      webmHasSystemAudio: false,
      crop: { x: 10, y: 20, width: 640, height: 360 },
    })

    expect(args[args.indexOf('-filter_complex') + 1]).toBe('[0:v]crop=640:360:10:20[v]')
    expect(args).toContain('[v]')
    expect(args).toEqual(expect.arrayContaining(title(0, 'mic')))
  })

  test('crop with both sources: the crop joins the two-stream graph', () => {
    const args = buildMacMuxArgs({
      screenWebmInput: WEBM,
      micAudioInput: MIC,
      output: OUT,
      webmHasSystemAudio: true,
      crop: { x: 0, y: 0, width: 1280, height: 720 },
    })

    expect(args[args.indexOf('-filter_complex') + 1]).toBe(
      '[1:a]aresample=async=1,apad[mic];[0:a]aresample=async=1,apad[sys];[0:v]crop=1280:720:0:0[v]',
    )
    expect(args).toContain('[v]')
    // Both audio streams are still mapped, and still in mic-then-system order.
    expect(args.indexOf('[mic]')).toBeLessThan(args.indexOf('[sys]'))
  })

  test('no audio at all: video-only output with -an', () => {
    const args = buildMacMuxArgs({
      screenWebmInput: WEBM,
      micAudioInput: undefined,
      output: OUT,
      webmHasSystemAudio: false,
    })

    expect(args).toEqual([
      '-y',
      '-i',
      WEBM,
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

  test('paths with spaces are not pre-quoted (spawn handles them)', () => {
    const args = buildMacMuxArgs({
      screenWebmInput: '/tmp/with space/screen.webm',
      micAudioInput: '/tmp/with space/mic.m4a',
      output: '/tmp/with space/out.mp4',
      webmHasSystemAudio: true,
    })

    expect(args).toContain('/tmp/with space/screen.webm')
    expect(args).toContain('/tmp/with space/mic.m4a')
    expect(args).toContain('/tmp/with space/out.mp4')
    args.forEach((a) => expect(a).not.toMatch(/^".*"$/))
  })

  test('apad mux is bounded with an explicit -t when the duration is known', () => {
    const args = buildMacMuxArgs({
      screenWebmInput: WEBM,
      micAudioInput: MIC,
      output: OUT,
      webmHasSystemAudio: true,
      durationSec: 8,
    })
    const tIndex = args.indexOf('-t')
    expect(tIndex).toBeGreaterThan(-1)
    expect(args[tIndex + 1]).toBe('8')
    // The bound goes before the output path.
    expect(args.indexOf('8')).toBeLessThan(args.indexOf(OUT))
  })

  test('dropped when the webm duration is unknown (banner says N/A)', () => {
    const args = buildMacMuxArgs({
      screenWebmInput: WEBM,
      micAudioInput: MIC,
      output: OUT,
      webmHasSystemAudio: true,
      durationSec: null,
    })
    expect(args).not.toContain('-t')
  })
})
