import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildExportArgs } from './build-export-args'

// These tests drive the REAL bundled FFmpeg end to end: raw RGBA frames in,
// MP4 out. They are skipped when the binary has not been downloaded
// (binaries/ is gitignored; see the README).
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

beforeAll(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dthat-export-'))
})

afterAll(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true })
})

function makeFrame(width: number, height: number, fill: number): Buffer {
  return Buffer.alloc(width * height * 4, fill)
}

/** Pipes frames into FFmpeg stdin, honouring backpressure, and resolves on exit. */
function runFfmpeg(args: string[], frames: Buffer[]): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args)
    let stderr = ''
    let stdout = ''
    proc.stderr.on('data', (data) => (stderr += data.toString()))
    // `-progress pipe:1` writes to stdout: it must be drained or FFmpeg blocks.
    proc.stdout.on('data', (data) => (stdout += data.toString()))
    proc.on('error', reject)
    proc.on('close', (code) => resolve({ code, stderr, stdout }))

    let index = 0
    const writeNext = () => {
      while (index < frames.length) {
        const accepted = proc.stdin.write(frames[index++])
        if (!accepted) {
          proc.stdin.once('drain', writeNext)
          return
        }
      }
      proc.stdin.end()
    }
    writeNext()
  })
}

/** Returns FFmpeg's stream summary for a file (it exits non-zero by design). */
function probe(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-hide_banner', '-i', file])
    let out = ''
    proc.stderr.on('data', (data) => (out += data.toString()))
    proc.on('error', reject)
    proc.on('close', () => resolve(out))
  })
}

suite('export pipeline against the bundled ffmpeg', () => {
  it('encodes a 1080p MP4 at the exact target size that decodes cleanly', async () => {
    const fps = 10
    const frameCount = 3
    const outputPath = path.join(tmpDir, 'out-1080p.mp4')
    const args = buildExportArgs({
      projectState: { aspectRatio: '16:9', duration: frameCount / fps },
      exportSettings: { resolution: '1080p', fps, format: 'mp4', quality: 'medium' },
      outputPath,
      renderWidth: 1920,
      renderHeight: 1080,
      targetWidth: 1920,
      targetHeight: 1080,
      clickSoundPath: null,
    })
    const frames = Array.from({ length: frameCount }, (_, i) => makeFrame(1920, 1080, 40 + i * 40))

    const { code, stderr } = await runFfmpeg(args, frames)
    expect(code, stderr.slice(-2000)).toBe(0)

    const stat = await fs.promises.stat(outputPath)
    expect(stat.size).toBeGreaterThan(0)

    const info = await probe(outputPath)
    expect(info).toContain('1920x1080')
    expect(info).toContain('10 fps')

    // A full decode with no errors proves the file is valid, not just present.
    const decoded = await runFfmpeg(['-v', 'error', '-i', outputPath, '-f', 'null', '-'], [])
    expect(decoded.code, decoded.stderr).toBe(0)
    expect(decoded.stderr.trim()).toBe('')
  }, 90_000)

  it('encodes a 4K MP4 at the exact target size', async () => {
    const fps = 5
    const frameCount = 2
    const outputPath = path.join(tmpDir, 'out-4k.mp4')
    const args = buildExportArgs({
      projectState: { aspectRatio: '16:9', duration: frameCount / fps },
      exportSettings: { resolution: '4k', fps, format: 'mp4', quality: 'low' },
      outputPath,
      renderWidth: 3840,
      renderHeight: 2160,
      targetWidth: 3840,
      targetHeight: 2160,
      clickSoundPath: null,
    })
    const frames = Array.from({ length: frameCount }, (_, i) => makeFrame(3840, 2160, 30 + i * 60))

    const { code, stderr } = await runFfmpeg(args, frames)
    expect(code, stderr.slice(-2000)).toBe(0)

    const info = await probe(outputPath)
    expect(info).toContain('3840x2160')
  }, 180_000)

  it('upscales a capped render to an exact 8K HEVC output', async () => {
    const fps = 2
    const frameCount = 2
    const outputPath = path.join(tmpDir, 'out-8k.mp4')
    const args = buildExportArgs({
      projectState: { aspectRatio: '16:9', duration: frameCount / fps },
      exportSettings: { resolution: '8k', fps, format: 'mp4', quality: 'low' },
      outputPath,
      // The renderer draws at the cap; FFmpeg scales up to the exact target.
      renderWidth: 3840,
      renderHeight: 2160,
      targetWidth: 7680,
      targetHeight: 4320,
      clickSoundPath: null,
    })
    const frames = Array.from({ length: frameCount }, (_, i) => makeFrame(3840, 2160, 20 + i * 40))

    const { code, stderr, stdout } = await runFfmpeg(args, frames)
    expect(code, stderr.slice(-2000)).toBe(0)
    expect(stdout).toContain('progress=')

    const info = await probe(outputPath)
    expect(info).toContain('7680x4320')
    expect(info).toContain('hevc')

    const decoded = await runFfmpeg(['-v', 'error', '-i', outputPath, '-f', 'null', '-'], [])
    expect(decoded.code, decoded.stderr).toBe(0)
  }, 300_000)

  it('mixes audio and scales the video in the same command', async () => {
    const tonePath = path.join(tmpDir, 'tone.wav')
    const tone = await runFfmpeg(
      ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'pcm_s16le', tonePath],
      [],
    )
    expect(tone.code, tone.stderr.slice(-1000)).toBe(0)

    const fps = 4
    const frameCount = 2
    const outputPath = path.join(tmpDir, 'out-audio-scale.mp4')
    const args = buildExportArgs({
      projectState: {
        aspectRatio: '16:9',
        duration: frameCount / fps,
        audioClips: [
          {
            filePath: tonePath,
            startTime: 0,
            duration: 0.5,
            sourceStart: 0,
            sourceDuration: 1,
            volume: 1,
            fadeIn: 0,
            fadeOut: 0,
            loop: false,
            kind: 'music',
          },
        ],
      },
      exportSettings: { resolution: '1080p', fps, format: 'mp4', quality: 'medium' },
      outputPath,
      // Render below the target so the scale filter is active alongside the
      // audio filter graph.
      renderWidth: 960,
      renderHeight: 540,
      targetWidth: 1920,
      targetHeight: 1080,
      clickSoundPath: null,
    })
    const frames = Array.from({ length: frameCount }, (_, i) => makeFrame(960, 540, 60 + i * 40))

    const { code, stderr } = await runFfmpeg(args, frames)
    expect(code, stderr.slice(-2000)).toBe(0)

    const info = await probe(outputPath)
    expect(info).toContain('1920x1080')
    expect(info).toContain('Audio: aac')
  }, 120_000)
})
