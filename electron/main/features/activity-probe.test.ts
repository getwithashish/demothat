// Measuring how much the picture changed.
//
// The parsing is matched in pairs because FFmpeg prints the timestamp and the value
// on separate lines; the numbers themselves are only checkable against the real
// binary, which the integration half of this file does.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { buildActivityArgs, parseActivitySamples, probeActivity } from './activity-probe'
import { suggestSpeedRegionsFromActivity } from '../../../shared/auto-speed'

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

process.env.APP_ROOT = repoRoot

/** What FFmpeg prints for a still screen, then one that is moving. */
const REAL_OUTPUT = `[Parsed_metadata_5 @ 0x7f1fdc011640] frame:0    pts:1       pts_time:1
[Parsed_metadata_5 @ 0x7f1fdc011640] lavfi.signalstats.YAVG=0
[Parsed_metadata_5 @ 0x7f1fdc011640] frame:1    pts:2       pts_time:2
[Parsed_metadata_5 @ 0x7f1fdc011640] lavfi.signalstats.YAVG=0.5
[Parsed_metadata_5 @ 0x7f1fdc011640] frame:2    pts:3       pts_time:3
[Parsed_metadata_5 @ 0x7f1fdc011640] lavfi.signalstats.YAVG=126.628
`

describe('buildActivityArgs', () => {
  it('asks for one sample a second, of a difference frame', () => {
    const args = buildActivityArgs('/tmp/rec.mp4')
    const filter = args[args.indexOf('-vf') + 1] ?? ''

    expect(filter).toContain('fps=1')
    expect(filter).toContain('tblend=all_mode=difference')
    expect(filter).toContain('signalstats')
    expect(args).toContain('/tmp/rec.mp4')
  })

  it('writes nothing, because the measurement comes out on stderr', () => {
    const args = buildActivityArgs('/tmp/rec.mp4')

    expect(args.slice(-3)).toEqual(['-f', 'null', '-'])
  })
})

describe('parseActivitySamples', () => {
  it('pairs each timestamp with the value that follows it', () => {
    expect(parseActivitySamples(REAL_OUTPUT)).toEqual([
      { time: 1, activity: 0 },
      { time: 2, activity: 0.5 / 255 },
      { time: 3, activity: 126.628 / 255 },
    ])
  })

  it('normalizes the luma range to 0-1', () => {
    const samples = parseActivitySamples(REAL_OUTPUT)

    expect(samples.every((sample) => sample.activity >= 0 && sample.activity <= 1)).toBe(true)
    // 126.6 of 255 is about half the frame changing.
    expect(samples[2]?.activity).toBeCloseTo(0.497, 3)
  })

  it('has nothing for output with no samples in it', () => {
    expect(parseActivitySamples('')).toEqual([])
    expect(parseActivitySamples('some unrelated error message\n')).toEqual([])
  })

  it('ignores a value with no timestamp before it, rather than misaligning the list', () => {
    const orphan = 'lavfi.signalstats.YAVG=99\n[Parsed] pts_time:4\nlavfi.signalstats.YAVG=10\n'

    expect(parseActivitySamples(orphan)).toEqual([{ time: 4, activity: 10 / 255 }])
  })

  it('keeps the samples it managed when the output stops early', () => {
    // A decode error partway through: the pairs already read are still good.
    const truncated = 'pts_time:1\nlavfi.signalstats.YAVG=0\npts_time:2\n'

    expect(parseActivitySamples(truncated)).toEqual([{ time: 1, activity: 0 }])
  })

  it('cannot report more than the whole frame changing', () => {
    expect(parseActivitySamples('pts_time:1\nlavfi.signalstats.YAVG=900\n')[0]?.activity).toBe(1)
  })
})

const suite = hasFfmpeg ? describe : describe.skip

suite('probeActivity against the bundled ffmpeg', () => {
  let workDir = ''
  let recording = ''

  beforeAll(async () => {
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dthat-activity-'))

    // Three seconds of a still screen, then three of one that is moving — the shape a
    // recording has while someone is reading, then typing.
    recording = path.join(workDir, 'probe.mp4')
    execFileSync(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=black:size=320x180:duration=3:rate=15',
      '-f', 'lavfi', '-i', 'testsrc=size=320x180:duration=3:rate=15',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', recording,
    ])
  }, 120_000)

  afterAll(async () => {
    if (workDir) await fsp.rm(workDir, { recursive: true, force: true })
  })

  it('reads a still screen as still and a moving one as moving', async () => {
    const samples = await probeActivity(recording)

    expect(samples.length).toBeGreaterThanOrEqual(5)
    const still = samples.filter((sample) => sample.time < 3)
    const moving = samples.filter((sample) => sample.time >= 4)

    expect(still.every((sample) => sample.activity === 0)).toBe(true)
    expect(moving.every((sample) => sample.activity > 0.01)).toBe(true)
  }, 60_000)

  it('finds the still stretch as one worth speeding up', async () => {
    // The whole point of the measurement: the quiet seconds come back as a region.
    const samples = await probeActivity(recording)
    const regions = suggestSpeedRegionsFromActivity(samples, 6, { minDurationSec: 1, paddingSec: 0.2 })

    expect(regions).toHaveLength(1)
    // From the first sample, which is at one second — a difference needs two frames —
    // less the padding the detector always trims.
    expect(regions[0]?.startTime).toBeCloseTo(1.2, 6)
    expect((regions[0]?.startTime ?? 0) + (regions[0]?.duration ?? 0)).toBeLessThan(3)
  }, 60_000)

  it('reports nothing for a file that is not there, rather than throwing', async () => {
    expect(await probeActivity(path.join(workDir, 'missing.mp4'))).toEqual([])
  }, 60_000)
})
