import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseVideoSize } from '../lib/video-size'
import { buildMacMuxArgs } from './build-mux-args'

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

const suite = hasFfmpeg ? describe : describe.skip

let tmpDir: string
let webm: string
let mic: string

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
}, 60_000)

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
