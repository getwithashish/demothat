import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseVideoSize } from '../lib/video-size'
import { buildMacMuxArgs } from './build-mux-args'
import { probeAudioTracks } from './audio-tracks'

// Drives the REAL bundled FFmpeg. The Wayland area crop adds a filter to the mux
// arguments, and the only way to know FFmpeg accepts them — and that `crop=` means
// what this code thinks it means — is to run it against a real file. Skipped when
// the binary has not been downloaded (binaries/ is gitignored; see the README).

const here = path.dirname(fileURLToPath(import.meta.url))
const platformDir = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'
const binaryName =
  process.platform === 'win32'
    ? 'ffmpeg.exe'
    : process.platform === 'darwin'
      ? process.arch === 'arm64'
        ? 'ffmpeg-arm64'
        : 'ffmpeg-x64'
      : 'ffmpeg'
const FFMPEG = path.resolve(here, '../../..', 'binaries', platformDir, binaryName)
const hasFfmpeg = fs.existsSync(FFMPEG)

// The app's own probe resolves FFmpeg through APP_ROOT, so the suite that runs it
// has to look like the app does. The direct FFMPEG path above is for the mux runs.
process.env.APP_ROOT = path.resolve(here, '../../..')

const suite = hasFfmpeg ? describe : describe.skip

let tmpDir: string
let webm: string
let mic: string
/** A WebM that carries Opus audio of its own, i.e. a renderer system-audio capture. */
let webmWithAudio: string
/** A mic track much shorter than the video, to prove the video is not cut to it. */
let shortMic: string

/**
 * The audio streams of a file, in order, as `{ index, name }`.
 *
 * Parsed from the banner: FFmpeg lists each stream as `Stream #0:N` followed by
 * its metadata block, and the mux names each one. `handler_name` is the one that
 * survives the MP4 muxer — it is the QuickTime track name — so that is what this
 * reads, which is also what the app reads.
 */
function audioStreamTitles(info: string): { index: number; title: string | null }[] {
  const blocks = info.split(/Stream #\d+:/).slice(1)
  const streams: { index: number; title: string | null }[] = []
  blocks.forEach((block, position) => {
    if (!/Audio:/.test(block)) return
    const match = block.match(/handler_name\s*:\s*([A-Za-z0-9_-]+)/)
    streams.push({ index: position, title: match ? match[1] : null })
  })
  return streams
}

/** The duration FFmpeg reports for a file, in seconds. */
function durationOf(info: string): number {
  const match = info.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/)
  if (!match) return 0
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

function run(args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, args)
    let stderr = ''
    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })
    proc.on('error', () => resolve({ code: null, stderr }))
    proc.on('close', (code) => resolve({ code, stderr }))
  })
}

/** FFmpeg's own banner for a file, which is where the stream details are. */
async function inspect(file: string): Promise<string> {
  return (await run(['-hide_banner', '-i', file])).stderr
}

beforeAll(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dthat-mux-'))
  webm = path.join(tmpDir, 'screen.webm')
  mic = path.join(tmpDir, 'mic.m4a')

  // Stands in for the renderer's MediaRecorder output: VP9 in WebM at 640x360.
  const video = await run([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=640x360:rate=30',
    '-t',
    '1',
    '-c:v',
    'libvpx-vp9',
    '-deadline',
    'realtime',
    '-cpu-used',
    '8',
    '-pix_fmt',
    'yuv420p',
    webm,
  ])
  expect(video.code, video.stderr.slice(-500)).toBe(0)

  const audio = await run(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', mic])
  expect(audio.code, audio.stderr.slice(-500)).toBe(0)

  // A WebM carrying its own Opus audio: what the renderer's loopback capture
  // produces, and the only way to exercise the two-source path for real.
  webmWithAudio = path.join(tmpDir, 'screen-with-audio.webm')
  const withAudio = await run([
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2',
    '-t', '2',
    '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p',
    '-c:a', 'libopus',
    webmWithAudio,
  ])
  expect(withAudio.code, withAudio.stderr.slice(-500)).toBe(0)

  shortMic = path.join(tmpDir, 'short-mic.m4a')
  const short = await run(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-c:a', 'aac', shortMic])
  expect(short.code, short.stderr.slice(-500)).toBe(0)
}, 120_000)

afterAll(async () => {
  if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true })
})

suite('the Wayland area crop against the bundled ffmpeg', () => {
  const CROP = { x: 16, y: 8, width: 320, height: 180 }

  it('produces a frame of exactly the cropped size', async () => {
    const out = path.join(tmpDir, 'cropped.mp4')
    const result = await run(
      buildMacMuxArgs({
        screenWebmInput: webm,
        micAudioInput: undefined,
        output: out,
        webmHasSystemAudio: false,
        crop: CROP,
      }),
    )

    expect(result.code, result.stderr.slice(-500)).toBe(0)
    expect(parseVideoSize(await inspect(out))).toEqual({ width: CROP.width, height: CROP.height })
  }, 60_000)

  it('crops and keeps the audio in one filter graph', async () => {
    const out = path.join(tmpDir, 'cropped-with-mic.mp4')
    const result = await run(
      buildMacMuxArgs({
        screenWebmInput: webm,
        micAudioInput: mic,
        output: out,
        webmHasSystemAudio: false,
        crop: CROP,
      }),
    )

    expect(result.code, result.stderr.slice(-500)).toBe(0)
    const info = await inspect(out)
    expect(parseVideoSize(info)).toEqual({ width: CROP.width, height: CROP.height })
    expect(info).toMatch(/Audio: aac/)
  }, 60_000)

  it('leaves the frame untouched when there is no crop', async () => {
    const out = path.join(tmpDir, 'uncropped.mp4')
    const result = await run(
      buildMacMuxArgs({
        screenWebmInput: webm,
        micAudioInput: undefined,
        output: out,
        webmHasSystemAudio: false,
      }),
    )

    expect(result.code, result.stderr.slice(-500)).toBe(0)
    expect(parseVideoSize(await inspect(out))).toEqual({ width: 640, height: 360 })
  }, 60_000)
})

// The recording's contract with the editor: one stream per audio source, in a
// known order, each named. Everything downstream — the per-track lanes, the
// per-track mute and volume, the auto-speed pass reading the mic and the desktop
// separately — depends on this being true of the real file.
suite('separate mic and system audio streams', () => {
  it('keeps both sources as two streams, mic first, each titled', async () => {
    const out = path.join(tmpDir, 'two-streams.mp4')
    const result = await run(
      buildMacMuxArgs({
        screenWebmInput: webmWithAudio,
        micAudioInput: mic,
        output: out,
        webmHasSystemAudio: true,
      }),
    )

    expect(result.code, result.stderr.slice(-500)).toBe(0)
    const streams = audioStreamTitles(await inspect(out))
    expect(streams.map((s) => s.title)).toEqual(['mic', 'system'])
  }, 60_000)

  it('reads back through the app’s own probe as mic and system', async () => {
    // The mux writes the names and the editor reads them; this is the one place
    // both ends run against the same real file, so a change to either that the
    // other does not know about fails here rather than in the timeline.
    const out = path.join(tmpDir, 'probed.mp4')
    const result = await run(
      buildMacMuxArgs({
        screenWebmInput: webmWithAudio,
        micAudioInput: mic,
        output: out,
        webmHasSystemAudio: true,
      }),
    )
    expect(result.code, result.stderr.slice(-500)).toBe(0)

    const tracks = await probeAudioTracks(out)
    expect(tracks.map((t) => t.kind)).toEqual(['mic', 'system'])
    expect(tracks.map((t) => t.index)).toEqual([0, 1])
    expect(tracks.every((t) => t.codec === 'aac')).toBe(true)
  }, 60_000)

  it('titles a lone source for what it actually is', async () => {
    const systemOnly = path.join(tmpDir, 'system-only.mp4')
    const systemResult = await run(
      buildMacMuxArgs({
        screenWebmInput: webmWithAudio,
        micAudioInput: undefined,
        output: systemOnly,
        webmHasSystemAudio: true,
      }),
    )
    expect(systemResult.code, systemResult.stderr.slice(-500)).toBe(0)
    expect(audioStreamTitles(await inspect(systemOnly)).map((s) => s.title)).toEqual(['system'])

    const micOnly = path.join(tmpDir, 'mic-only.mp4')
    const micResult = await run(
      buildMacMuxArgs({
        screenWebmInput: webm,
        micAudioInput: mic,
        output: micOnly,
        webmHasSystemAudio: false,
      }),
    )
    expect(micResult.code, micResult.stderr.slice(-500)).toBe(0)
    // Copied, not re-encoded — and still named, which is what the app reads.
    expect(audioStreamTitles(await inspect(micOnly)).map((s) => s.title)).toEqual(['mic'])
  }, 60_000)

  it('does not cut the video down to the shorter audio source', async () => {
    // A 2s recording whose mic stops after 0.5s. Without padding each stream to the
    // video's length, `-shortest` would end the output at the mic — a recording
    // that silently loses three quarters of itself.
    const out = path.join(tmpDir, 'short-mic.mp4')
    const result = await run(
      buildMacMuxArgs({
        screenWebmInput: webmWithAudio,
        micAudioInput: shortMic,
        output: out,
        webmHasSystemAudio: true,
      }),
    )

    expect(result.code, result.stderr.slice(-500)).toBe(0)
    const info = await inspect(out)
    expect(durationOf(info)).toBeGreaterThan(1.8)
    expect(audioStreamTitles(info).map((s) => s.title)).toEqual(['mic', 'system'])
  }, 60_000)
})
