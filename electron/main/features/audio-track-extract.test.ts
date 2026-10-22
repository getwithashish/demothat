// Extracting a recording's tracks into files the preview can play.
//
// The part that can only be answered by running FFmpeg is whether `-map 0:a:N`
// picks the stream we think it does — the two tracks of a real recording have to
// come out as two files, each holding its own source. The fixture's tracks differ
// in sample rate for exactly that reason: a test that swapped them would still
// produce two plausible files, and only the rates tell them apart.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const userData = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`unexpected getPath(${name})`)
      return userData.dir
    },
  },
}))

import {
  buildExtractArgs,
  buildReencodeExtractArgs,
  extractAudioTracks,
  trackCacheKey,
  trackCachePath,
} from './audio-track-extract'
import { buildMacMuxArgs } from './build-mux-args'
import { parseAudioStreams } from '../lib/audio-info'
import type { AudioTrack } from '../../../shared/audio-tracks'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')
const platformDir = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'
const binaryName =
  process.platform === 'win32'
    ? 'ffmpeg.exe'
    : process.platform === 'darwin'
      ? process.arch === 'arm64'
        ? 'ffmpeg-arm64'
        : 'ffmpeg-x64'
      : 'ffmpeg'
const FFMPEG = path.resolve(repoRoot, 'binaries', platformDir, binaryName)
const hasFfmpeg = fs.existsSync(FFMPEG)

// The module under test resolves FFmpeg the way the app does.
process.env.APP_ROOT = repoRoot

const track = (index: number, kind: 'mic' | 'system'): AudioTrack => ({
  id: `audio-${kind}-${index}`,
  kind,
  index,
  label: kind === 'mic' ? 'Microphone' : 'System audio',
  volume: 1,
  muted: false,
})

describe('buildExtractArgs', () => {
  it('maps exactly one stream and copies it', () => {
    const args = buildExtractArgs('/tmp/rec.mp4', '/tmp/out.m4a', 1)

    expect(args).toContain('-map')
    expect(args[args.indexOf('-map') + 1]).toBe('0:a:1')
    // A stream copy: the preview must not play audio that has been encoded more
    // times than the export's.
    expect(args[args.indexOf('-c') + 1]).toBe('copy')
    expect(args[args.length - 1]).toBe('/tmp/out.m4a')
  })

  it('names the stream it wants, so two extracts cannot both take the default', () => {
    expect(buildExtractArgs('/tmp/rec.mp4', '/tmp/a.m4a', 0)).toContain('0:a:0')
    expect(buildExtractArgs('/tmp/rec.mp4', '/tmp/b.m4a', 1)).toContain('0:a:1')
  })

  it('re-encodes to AAC in the fallback, for audio the container cannot hold', () => {
    const args = buildReencodeExtractArgs('/tmp/rec.webm', '/tmp/out.m4a', 0)

    expect(args[args.indexOf('-c:a') + 1]).toBe('aac')
    expect(args).not.toContain('copy')
  })
})

describe('trackCacheKey', () => {
  it('is stable for the same recording', () => {
    expect(trackCacheKey('/tmp/rec.mp4', 100, 1000)).toBe(trackCacheKey('/tmp/rec.mp4', 100, 1000))
  })

  it('changes when the recording does', () => {
    const base = trackCacheKey('/tmp/rec.mp4', 100, 1000)

    // A re-recording to the same path must not serve the previous recording's audio.
    expect(trackCacheKey('/tmp/rec.mp4', 100, 2000)).not.toBe(base)
    expect(trackCacheKey('/tmp/rec.mp4', 200, 1000)).not.toBe(base)
    expect(trackCacheKey('/tmp/other.mp4', 100, 1000)).not.toBe(base)
  })

  it('separates tracks of one recording', () => {
    const key = trackCacheKey('/tmp/rec.mp4', 100, 1000)

    expect(trackCachePath(key, 'audio-mic-0')).not.toBe(trackCachePath(key, 'audio-system-1'))
    expect(trackCachePath(key, 'audio-mic-0')).toContain(key)
  })
})

const suite = hasFfmpeg ? describe : describe.skip

suite('extractAudioTracks against the bundled ffmpeg', () => {
  let workDir = ''
  let recording = ''

  beforeAll(async () => {
    userData.dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dthat-audio-'))
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dthat-extract-'))

    // A recording with two tracks that differ: the microphone at 44100 Hz, the
    // system audio at 48000. Swapping them would still yield two playable files.
    const webm = path.join(workDir, 'screen.webm')
    execFileSync(FFMPEG, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15',
      '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=2',
      '-t', '2', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8',
      '-pix_fmt', 'yuv420p', '-c:a', 'libopus', webm,
    ])
    const mic = path.join(workDir, 'mic.m4a')
    execFileSync(FFMPEG, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=2',
      '-c:a', 'aac', mic,
    ])
    recording = path.join(workDir, 'recording.mp4')
    execFileSync(FFMPEG, buildMacMuxArgs({
      screenWebmInput: webm,
      micAudioInput: mic,
      output: recording,
      webmHasSystemAudio: true,
    }))
  }, 120_000)

  afterAll(async () => {
    for (const dir of [userData.dir, workDir]) {
      if (dir) await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  /** The banner of an extracted file, which is where its sample rate is. */
  function inspect(file: string): string {
    try {
      execFileSync(FFMPEG, ['-hide_banner', '-i', file])
    } catch (error) {
      // No output file: FFmpeg prints the banner and exits non-zero.
      return String((error as { stderr?: Buffer }).stderr ?? '')
    }
    return ''
  }

  it('extracts each track into its own file, holding its own source', async () => {
    const tracks = [track(0, 'mic'), track(1, 'system')]
    const extracted = await extractAudioTracks(recording, tracks)

    expect(extracted).toHaveLength(2)

    const micStreams = parseAudioStreams(inspect(extracted[0]!.filePath))
    const systemStreams = parseAudioStreams(inspect(extracted[1]!.filePath))
    expect(micStreams).toHaveLength(1)
    expect(systemStreams).toHaveLength(1)

    // The sample rates are what proves the mapping: mic 44100, system 48000.
    expect(micStreams[0]?.sampleRate).toBe(44100)
    expect(systemStreams[0]?.sampleRate).toBe(48000)
  }, 120_000)

  it('extracts the tracks in the order they were asked for', async () => {
    const extracted = await extractAudioTracks(recording, [track(1, 'system'), track(0, 'mic')])

    expect(extracted.map((entry) => entry.index)).toEqual([1, 0])
  }, 120_000)

  it('reuses a cached extraction instead of doing the work again', async () => {
    const first = await extractAudioTracks(recording, [track(0, 'mic')])
    const written = (await fsp.stat(first[0]!.filePath)).mtimeMs

    // Touch nothing and ask again: the file must not be rewritten.
    const second = await extractAudioTracks(recording, [track(0, 'mic')])

    expect(second[0]?.filePath).toBe(first[0]?.filePath)
    expect((await fsp.stat(second[0]!.filePath)).mtimeMs).toBe(written)
  }, 120_000)

  it('reports nothing for a recording with no audio, rather than an empty file', async () => {
    expect(await extractAudioTracks(recording, [])).toEqual([])
  }, 60_000)

  it('omits a track that cannot be extracted', async () => {
    // a:7 does not exist. The caller gets no entry for it, so the lane is visibly
    // missing rather than silently a zero-length file.
    const extracted = await extractAudioTracks(recording, [track(7, 'system')])

    expect(extracted).toEqual([])
  }, 60_000)

  it('reports nothing for a file that is not there', async () => {
    expect(await extractAudioTracks(path.join(workDir, 'missing.mp4'), [track(0, 'mic')])).toEqual([])
  }, 60_000)
})
