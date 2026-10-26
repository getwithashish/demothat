// Audio probing and extraction: the two steps that happen before anything is
// uploaded, so a mistake here is a wasted upload or a rejected job.

import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildAudioExtractArgs,
  extractAudioForTranscription,
  progressPercentFromOutTime,
  TRANSCRIBE_SAMPLE_RATE,
} from './audio-extract'
import { parseAudioInfo, parseDuration, parseHasAudio } from '../lib/audio-info'
import { getFFmpegPath } from '../lib/utils'

// A real `ffmpeg -i` banner for an MP4 with H.264 video and AAC audio.
const BANNER_WITH_AUDIO = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'recording.mp4':
  Metadata:
    major_brand     : isom
  Duration: 00:10:04.32, start: 0.000000, bitrate: 1234 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1920x1080, 4000 kb/s, 30 fps
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 192 kb/s
`

const BANNER_VIDEO_ONLY = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'silent.mp4':
  Duration: 00:00:02.00, start: 0.000000, bitrate: 200 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 640x360, 200 kb/s, 15 fps
`

describe('parseAudioInfo', () => {
  it('reads the duration and finds the audio stream', () => {
    expect(parseAudioInfo(BANNER_WITH_AUDIO)).toEqual({ hasAudio: true, durationSec: 604.32 })
  })

  it('reports no audio for a video-only file', () => {
    expect(parseAudioInfo(BANNER_VIDEO_ONLY)).toEqual({ hasAudio: false, durationSec: 2 })
  })

  it('does not mistake a video line for audio', () => {
    // "Audio:" is the discriminator, so a codec named like one cannot fool it.
    expect(parseHasAudio('  Stream #0:0: Video: h264, yuv420p, 1920x1080')).toBe(false)
    expect(parseHasAudio('  Stream #0:1: Audio: aac, 48000 Hz, stereo')).toBe(true)
  })

  it('returns null for a duration it cannot read', () => {
    expect(parseDuration('Duration: N/A, start: 0.000000, bitrate: N/A')).toBeNull()
    expect(parseDuration('no banner here')).toBeNull()
    // A zero-length file is "nothing to transcribe", not a duration of zero.
    expect(parseDuration('Duration: 00:00:00.00, start: 0.000000')).toBeNull()
  })
})

describe('buildAudioExtractArgs', () => {
  const args = buildAudioExtractArgs({ sourcePath: '/tmp/in.mp4', outputPath: '/tmp/out.m4a' })

  it('takes only the audio', () => {
    expect(args).toContain('-vn')
  })

  it('converts to the rate and channel count Whisper wants', () => {
    expect(args[args.indexOf('-ar') + 1]).toBe(String(TRANSCRIBE_SAMPLE_RATE))
    expect(args[args.indexOf('-ac') + 1]).toBe('1')
  })

  it('writes an MP4-family container, which is what the worker accepts', () => {
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac')
    expect(args[args.length - 1]).toBe('/tmp/out.m4a')
    expect(args).toContain('+faststart')
  })

  it('reports progress on stdout without waiting for a prompt', () => {
    expect(args).toContain('-progress')
    expect(args).toContain('-nostdin')
    expect(args).toContain('-y')
  })
})

describe('progressPercentFromOutTime', () => {
  it('turns FFmpeg clock output into a percentage', () => {
    expect(progressPercentFromOutTime('out_time_us=5000000', 10)).toBe(50)
    expect(progressPercentFromOutTime('out_time_us=10000000', 10)).toBe(100)
  })

  it('clamps and ignores what it cannot read', () => {
    expect(progressPercentFromOutTime('out_time_us=99000000', 10)).toBe(100)
    expect(progressPercentFromOutTime('frame=12', 10)).toBeNull()
    expect(progressPercentFromOutTime('out_time_us=5000000', null)).toBeNull()
  })
})

// The bundled FFmpeg is gitignored, so the real extraction only runs where it
// exists. `getFFmpegPath()` resolves through APP_ROOT in development (the app sets
// it at startup; a plain vitest run does not), so it is set here to the repo root —
// the same path the app would use, which is the point of exercising it.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
process.env.APP_ROOT = repoRoot

const ffmpegPath = (() => {
  try {
    const candidate = getFFmpegPath()
    return fs.existsSync(candidate) ? candidate : null
  } catch {
    return null
  }
})()

describe.skipIf(ffmpegPath === null)('extractAudioForTranscription (real ffmpeg)', () => {
  it('produces a 16 kHz mono file the worker will accept', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'demothat-audio-'))
    const source = path.join(work, 'source.mp4')
    const output = path.join(work, 'audio.m4a')

    // Two seconds of video with a tone: the shape a recording has.
    execFileSync(ffmpegPath as string, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=160x90:rate=15',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      source,
    ])

    const seen: number[] = []
    const result = await extractAudioForTranscription({
      sourcePath: source,
      outputPath: output,
      durationSec: 2,
      onProgress: (percent) => seen.push(percent),
    })

    expect(result.path).toBe(output)
    expect(result.bytes).toBeGreaterThan(0)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[seen.length - 1]).toBeLessThanOrEqual(100)

    // The extracted file is audio-only, 16 kHz, mono — read back through the same
    // banner parser the app uses, so the assertion is about the file, not the argv.
    // `spawnSync` rather than `execFileSync`: FFmpeg exits non-zero for an
    // input-only probe, and the banner goes to stderr.
    const probe = spawnSync(ffmpegPath as string, ['-hide_banner', '-i', output, '-f', 'null', '-'], {
      encoding: 'utf8',
    })
    const info = parseAudioInfo(probe.stderr ?? '')
    expect(info.hasAudio).toBe(true)
    expect(info.durationSec).toBeCloseTo(2, 1)
    expect(probe.stderr).toContain('16000 Hz')
    expect(probe.stderr).toContain('mono')
    expect(probe.stderr).not.toContain('Video:')
  }, 60_000)

  it('rejects a file with no audio track instead of writing an empty one', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'demothat-noaudio-'))
    const source = path.join(work, 'video-only.mp4')
    execFileSync(ffmpegPath as string, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=160x90:rate=15',
      '-t',
      '1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-an',
      source,
    ])

    await expect(
      extractAudioForTranscription({ sourcePath: source, outputPath: path.join(work, 'out.m4a') }),
    ).rejects.toThrow(/audio track/i)
  }, 60_000)
})
