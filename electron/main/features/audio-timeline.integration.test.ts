// The audio timeline against the real bundled FFmpeg.
//
// Two things can only be answered by running it. The first is whether FFmpeg accepts
// the graph at all — `concat`, `atempo`, and a per-stream label like `[1:a:0]` are
// all things that look plausible and can be rejected outright. The second, and the
// reason this file exists, is whether the audio that comes out is as long as the
// video the same regions produce. The unit tests assert the arithmetic; this
// measures the result.
//
// Skipped when the binary has not been downloaded (binaries/ is gitignored).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAudioTimelineSegments, buildRecordingAudioChains, timelineDuration } from './audio-timeline'
import { computeExportDuration, type ExportProjectState } from './build-export-args'
import { buildMacMuxArgs } from './build-mux-args'

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

function run(args: string[]): { code: number | null; stderr: string } {
  try {
    execFileSync(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    return { code: 0, stderr: '' }
  } catch (error) {
    const failure = error as { status?: number; stderr?: Buffer }
    return { code: failure.status ?? null, stderr: String(failure.stderr ?? '') }
  }
}

/** The duration FFmpeg reports for a file, in seconds. */
function durationOf(file: string): number {
  const result = run(['-hide_banner', '-i', file])
  const match = result.stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/)
  if (!match) return 0
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

const suite = hasFfmpeg ? describe : describe.skip

suite('the audio timeline against the bundled ffmpeg', () => {
  let workDir = ''
  let recording = ''

  beforeAll(async () => {
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dthat-audio-timeline-'))

    // A six-second recording with two audio streams, as the recorder produces.
    const webm = path.join(workDir, 'screen.webm')
    run([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x180:rate=15',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=880:sample_rate=48000:duration=6',
      '-t',
      '6',
      '-c:v',
      'libvpx-vp9',
      '-deadline',
      'realtime',
      '-cpu-used',
      '8',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'libopus',
      webm,
    ])
    const mic = path.join(workDir, 'mic.m4a')
    run([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100:duration=6',
      '-c:a',
      'aac',
      mic,
    ])
    recording = path.join(workDir, 'recording.mp4')
    run(buildMacMuxArgs({ screenWebmInput: webm, micAudioInput: mic, output: recording, webmHasSystemAudio: true }))
    expect(durationOf(recording)).toBeGreaterThan(5.5)
  }, 120_000)

  afterAll(async () => {
    if (workDir) await fsp.rm(workDir, { recursive: true, force: true })
  })

  const state = (overrides: Partial<ExportProjectState> = {}): ExportProjectState => ({
    aspectRatio: '16:9',
    duration: 6,
    ...overrides,
  })

  /** Render one source's audio through its chains and report what came out. */
  function renderAudio(projectState: ExportProjectState, streamIndex = 0): { code: number | null; file: string } {
    const segments = buildAudioTimelineSegments(projectState)
    const chains = buildRecordingAudioChains({
      inputIndex: 0,
      streamIndex,
      segments,
      volume: 1,
      label: 'original',
    })
    const file = path.join(workDir, `out-${Math.random().toString(36).slice(2, 8)}.m4a`)

    const result = run([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      recording,
      '-filter_complex',
      chains.join(';'),
      '-map',
      '[original]',
      '-c:a',
      'aac',
      file,
    ])
    return { code: result.code, file }
  }

  it('accepts the graph for an untouched recording, and the audio is the whole thing', () => {
    const { code, file } = renderAudio(state())

    expect(code).toBe(0)
    expect(durationOf(file)).toBeCloseTo(6, 1)
  }, 60_000)

  it('accepts the graph with a cut, and the audio is as long as the video', () => {
    // One second removed from the middle: the video is 5s, and so is the audio.
    const projectState = state({ cutRegions: { c: { startTime: 2, duration: 1 } } })
    const { code, file } = renderAudio(projectState)

    expect(code).toBe(0)
    const audio = durationOf(file)
    expect(audio).toBeCloseTo(computeExportDuration(projectState), 1)
    expect(audio).toBeCloseTo(5, 1)
  }, 60_000)

  it('accepts the graph with a speed region, and the audio is as long as the video', () => {
    // Two seconds at 2x: one second of export instead of two.
    const projectState = state({ speedRegions: { s: { startTime: 3, duration: 2, speed: 2 } } })
    const { code, file } = renderAudio(projectState)

    expect(code).toBe(0)
    const audio = durationOf(file)
    expect(audio).toBeCloseTo(computeExportDuration(projectState), 1)
    expect(audio).toBeCloseTo(5, 1)
  }, 60_000)

  it('accepts the graph with a cut and a speed region together', () => {
    const projectState = state({
      cutRegions: { c: { startTime: 1, duration: 1 } },
      speedRegions: { s: { startTime: 4, duration: 2, speed: 2 } },
    })
    const { code, file } = renderAudio(projectState)

    expect(code).toBe(0)
    // 6s, minus a second cut, minus a second from the sped-up stretch.
    const audio = durationOf(file)
    expect(audio).toBeCloseTo(computeExportDuration(projectState), 1)
    expect(audio).toBeCloseTo(4, 1)
  }, 60_000)

  it('accepts the graph for the second source, which is a different stream', () => {
    // `[0:a:1]` has to mean the system audio, not the microphone — the two differ in
    // sample rate, and the extraction tests already rely on that.
    const projectState = state({ cutRegions: { c: { startTime: 2, duration: 1 } } })
    const { code, file } = renderAudio(projectState, 1)

    expect(code).toBe(0)
    expect(durationOf(file)).toBeCloseTo(5, 1)
  }, 60_000)

  it('accepts a 4x region, which is a chain of two atempo passes', () => {
    const projectState = state({ speedRegions: { s: { startTime: 2, duration: 4, speed: 4 } } })
    const { code, file } = renderAudio(projectState)

    expect(code).toBe(0)
    // Four seconds of source at 4x is one second of export, plus the two untouched.
    expect(durationOf(file)).toBeCloseTo(computeExportDuration(projectState), 1)
    expect(durationOf(file)).toBeCloseTo(3, 1)
  }, 60_000)

  it('produces the timeline the segments describe', () => {
    // The measured file and the arithmetic have to agree, or one of them is wrong.
    const projectState = state({
      cutRegions: { c: { startTime: 1, duration: 1 } },
      speedRegions: { s: { startTime: 4, duration: 2, speed: 2 } },
    })
    const segments = buildAudioTimelineSegments(projectState)
    const { file } = renderAudio(projectState)

    expect(durationOf(file)).toBeCloseTo(timelineDuration(segments), 1)
  }, 60_000)
})
