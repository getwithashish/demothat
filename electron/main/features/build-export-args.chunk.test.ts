import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildChunkExportArgs,
  buildConcatExportArgs,
  canUseParallelExport,
  computeChunkWorkerCount,
  planChunkSlices,
  type ExportProjectState,
} from './build-export-args'

describe('buildChunkExportArgs', () => {
  it('builds rawvideo video-only chunk args with fast x264 defaults', () => {
    const args = buildChunkExportArgs({
      renderWidth: 1920,
      renderHeight: 1080,
      targetWidth: 1920,
      targetHeight: 1080,
      fps: 60,
      chunkDuration: 5.5,
      outputPath: '/tmp/chunk_0.mp4',
    })

    expect(args).toContain('-f')
    expect(args).toContain('rawvideo')
    expect(args).toContain('-s')
    expect(args).toContain('1920x1080')
    expect(args).toContain('-framerate')
    expect(args).toContain('-r')
    expect(args).toContain('60')
    expect(args).toContain('-i')
    expect(args).toContain('-')

    // Maps video only
    expect(args).toContain('-map')
    expect(args).toContain('0:v:0')

    // Encoder settings (defaults to fast software preset with zero B-frames and closed GOPs)
    expect(args).toContain('-c:v')
    expect(args).toContain('libx264')
    expect(args).toContain('-preset')
    expect(args).toContain('veryfast')
    expect(args).toContain('-bf')
    expect(args).toContain('0')
    expect(args).toContain('-flags')
    expect(args).toContain('+cgop')

    // Chunk duration limit -t is deliberately omitted to prevent premature EPIPE frame drops
    expect(args).not.toContain('-t')

    // Output path
    expect(args[args.length - 1]).toBe('/tmp/chunk_0.mp4')
  })

  it('inserts Lanczos scale filter when render size differs from target', () => {
    const args = buildChunkExportArgs({
      renderWidth: 1920,
      renderHeight: 1080,
      targetWidth: 3840,
      targetHeight: 2160,
      fps: 30,
      chunkDuration: 10,
      outputPath: '/tmp/chunk_1.mp4',
    })

    expect(args).toContain('-vf')
    expect(args).toContain('scale=3840:2160:flags=lanczos')
  })

  it('supports hardware GPU encoders (e.g. NVENC, VideoToolbox)', () => {
    const nvencArgs = buildChunkExportArgs({
      renderWidth: 1920,
      renderHeight: 1080,
      targetWidth: 1920,
      targetHeight: 1080,
      fps: 60,
      chunkDuration: 4,
      outputPath: '/tmp/chunk_nvenc.mp4',
      encoder: 'h264_nvenc',
      quality: 'high',
    })
    expect(nvencArgs).toContain('h264_nvenc')
    expect(nvencArgs).toContain('-cq')
    expect(nvencArgs).toContain('18')
    expect(nvencArgs).toContain('-bf')
    expect(nvencArgs).toContain('0')
    expect(nvencArgs).toContain('-flags')
    expect(nvencArgs).toContain('+cgop')

    const vtArgs = buildChunkExportArgs({
      renderWidth: 1920,
      renderHeight: 1080,
      targetWidth: 1920,
      targetHeight: 1080,
      fps: 60,
      chunkDuration: 4,
      outputPath: '/tmp/chunk_vt.mp4',
      encoder: 'h264_videotoolbox',
      quality: 'medium',
    })
    expect(vtArgs).toContain('h264_videotoolbox')
    expect(vtArgs).toContain('-q:v')
    expect(vtArgs).toContain('65')
    expect(vtArgs).toContain('-bf')
    expect(vtArgs).toContain('0')
  })
})

describe('buildConcatExportArgs', () => {
  const minimalState: ExportProjectState = {
    aspectRatio: '16:9',
    duration: 10,
    hasAudioTrack: false,
    isMuted: true,
  }

  it('builds concat demuxer args with video stream copy and no audio when muted', () => {
    const args = buildConcatExportArgs({
      concatListPath: '/tmp/concat.txt',
      outputPath: '/final/output.mp4',
      projectState: minimalState,
    })

    expect(args[0]).toBe('-y')
    expect(args).toContain('-fflags')
    expect(args).toContain('+genpts')
    expect(args).toContain('-f')
    expect(args).toContain('concat')
    expect(args).toContain('-safe')
    expect(args).toContain('0')
    expect(args).toContain('-i')
    expect(args).toContain('/tmp/concat.txt')

    // Lossless video copy
    expect(args).toContain('-map')
    expect(args).toContain('0:v:0')
    expect(args).toContain('-c:v')
    expect(args).toContain('copy')

    // No audio flag
    expect(args).toContain('-an')
    // Avoid avoid_negative_ts make_zero which shifts copied video stream forward by AAC priming offset
    expect(args).not.toContain('-avoid_negative_ts')
    expect(args).toContain('-movflags')
    expect(args).toContain('+faststart')
    expect(args[args.length - 1]).toBe('/final/output.mp4')
  })

  it('incorporates audio inputs and full filtergraph when audio is present', () => {
    const stateWithAudio: ExportProjectState = {
      aspectRatio: '16:9',
      duration: 12,
      videoPath: '/path/to/source.mp4',
      hasAudioTrack: true,
      isMuted: false,
      volume: 1,
      audioTracks: [{ index: 0, volume: 1, muted: false }],
      audioClips: [
        {
          filePath: '/path/to/music.mp3',
          startTime: 2,
          duration: 5,
          sourceStart: 0,
          sourceDuration: 5,
          volume: 0.8,
          fadeIn: 0.5,
          fadeOut: 0.5,
          loop: false,
        },
      ],
    }

    const args = buildConcatExportArgs({
      concatListPath: '/tmp/concat.txt',
      outputPath: '/final/with_audio.mp4',
      projectState: stateWithAudio,
      totalFrames: 360,
      fps: 30,
    })

    // Concat input is input 0
    expect(args).toContain('/tmp/concat.txt')
    // Recording video audio input is input 1
    expect(args).toContain('/path/to/source.mp4')
    // Music clip input is input 2
    expect(args).toContain('/path/to/music.mp3')

    // Video stream copied
    expect(args).toContain('-c:v')
    expect(args).toContain('copy')

    // Audio filtergraph and encoded AAC
    expect(args).toContain('-filter_complex')
    expect(args).toContain('-map')
    expect(args).toContain('[aout]')
    expect(args).toContain('-c:a')
    expect(args).toContain('aac')
    expect(args).toContain('-b:a')
    expect(args).toContain('192k')
    // Audio duration aligned to exact video frames (360 / 30 = 12)
    expect(args).toContain('-t')
    expect(args).toContain('12')
    // Avoid avoid_negative_ts make_zero to prevent video stream delay
    expect(args).not.toContain('-avoid_negative_ts')
  })

  it('aligns audio duration to exact totalFrames / fps when exportDuration has fractional frames', () => {
    const state: ExportProjectState = {
      aspectRatio: '16:9',
      duration: 10.05, // 10.05s
      hasAudioTrack: false,
      isMuted: true,
    }
    // At 60 fps, 600 frames = 10.0s exactly
    const args = buildConcatExportArgs({
      concatListPath: '/tmp/concat.txt',
      outputPath: '/final/aligned.mp4',
      projectState: state,
      totalFrames: 600,
      fps: 60,
    })

    const tIndex = args.indexOf('-t')
    expect(tIndex).toBeGreaterThan(-1)
    expect(args[tIndex + 1]).toBe('10')
  })

  it('falls back to computeExportDuration when totalFrames or fps is missing', () => {
    const state: ExportProjectState = {
      aspectRatio: '16:9',
      duration: 10.5,
      hasAudioTrack: false,
      isMuted: true,
    }
    const args = buildConcatExportArgs({
      concatListPath: '/tmp/concat.txt',
      outputPath: '/final/fallback.mp4',
      projectState: state,
    })

    const tIndex = args.indexOf('-t')
    expect(tIndex).toBeGreaterThan(-1)
    expect(args[tIndex + 1]).toBe('10.5')
  })
})

describe('canUseParallelExport', () => {
  const baseOptions = {
    useCloud: false,
    format: 'mp4',
    exportDuration: 11.0,
    totalFrames: 330,
    cpuCount: 8,
  }

  it('enables parallel chunk export for qualifying MP4 jobs', () => {
    expect(canUseParallelExport(baseOptions)).toBe(true)
  })

  it('disables parallel export for cloud exports', () => {
    expect(canUseParallelExport({ ...baseOptions, useCloud: true })).toBe(false)
  })

  it('disables parallel export for non-mp4 formats (e.g. gif, webm)', () => {
    expect(canUseParallelExport({ ...baseOptions, format: 'gif' })).toBe(false)
    expect(canUseParallelExport({ ...baseOptions, format: 'webm' })).toBe(false)
  })

  it('disables parallel export for short durations (< 4s)', () => {
    expect(canUseParallelExport({ ...baseOptions, exportDuration: 3.9 })).toBe(false)
  })

  it('disables parallel export for low frame counts (< 60 frames)', () => {
    expect(canUseParallelExport({ ...baseOptions, totalFrames: 59 })).toBe(false)
  })

  it('disables parallel export on single-core machines', () => {
    expect(canUseParallelExport({ ...baseOptions, cpuCount: 1 })).toBe(false)
  })
})

describe('computeChunkWorkerCount', () => {
  it('scales worker count based on CPU core count and total frames', () => {
    // 2-4 cores
    expect(computeChunkWorkerCount(2, 600)).toBe(2)
    expect(computeChunkWorkerCount(4, 600)).toBe(3)

    // 6-8 cores
    expect(computeChunkWorkerCount(6, 600)).toBe(4)
    expect(computeChunkWorkerCount(8, 600)).toBe(6)

    // 12+ cores
    expect(computeChunkWorkerCount(12, 600)).toBe(8)
    expect(computeChunkWorkerCount(16, 600)).toBe(8)
  })

  it('respects minimum frame density per worker (45 frames / worker)', () => {
    // With 16 cores, worker count is bounded by totalFrames / 45
    expect(computeChunkWorkerCount(16, 60)).toBe(2) // minimum 2 workers
    expect(computeChunkWorkerCount(16, 90)).toBe(2)
    expect(computeChunkWorkerCount(16, 135)).toBe(3)
    expect(computeChunkWorkerCount(16, 180)).toBe(4)
    expect(computeChunkWorkerCount(16, 270)).toBe(6)
    expect(computeChunkWorkerCount(16, 360)).toBe(8)
  })
})

describe('planChunkSlices', () => {
  it('creates clean, non-overlapping contiguous slices across workers with zero gaps', () => {
    const totalFrames = 330
    const numWorkers = 4
    const fps = 30
    const sessionDir = '/tmp/export-session-123'

    const chunks = planChunkSlices(totalFrames, numWorkers, fps, sessionDir)
    expect(chunks).toHaveLength(4)

    // Verify first chunk starts at 0
    expect(chunks[0].startFrame).toBe(0)
    expect(chunks[0].endFrame).toBe(82)
    expect(chunks[0].chunkFrames).toBe(82)
    expect(chunks[0].chunkPath).toBe('/tmp/export-session-123/chunk_0.mp4')

    // Verify contiguous telescoping boundaries
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startFrame).toBe(chunks[i - 1].endFrame)
      expect(chunks[i].index).toBe(i)
      expect(chunks[i].chunkPath).toBe(`/tmp/export-session-123/chunk_${i}.mp4`)
    }

    // Verify last chunk ends at totalFrames exactly
    expect(chunks[chunks.length - 1].endFrame).toBe(totalFrames)

    // Verify total frames across all slices sums to totalFrames exactly
    const sumFrames = chunks.reduce((acc, c) => acc + c.chunkFrames, 0)
    expect(sumFrames).toBe(totalFrames)
  })

  it('correctly partitions a 60-frame clip across 2 workers', () => {
    const chunks = planChunkSlices(60, 2, 30, '/tmp/session')
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toMatchObject({ startFrame: 0, endFrame: 30, chunkFrames: 30 })
    expect(chunks[1]).toMatchObject({ startFrame: 30, endFrame: 60, chunkFrames: 30 })
  })
})

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
const demoVideo = path.resolve(repoRoot, 'docs/assets/demothat-demo.mp4')
const hasFfmpeg = fs.existsSync(FFMPEG) && fs.existsSync(demoVideo)

const integrationSuite = hasFfmpeg ? describe : describe.skip

integrationSuite('bundled FFmpeg parallel chunk export & lossless concat integration', () => {
  it('encodes chunks in parallel and stitches them with 100% continuous PTS and zero frame drops', () => {
    const tmpDir = path.join(os.tmpdir(), `demothat-chunk-test-${Date.now()}`)
    fs.mkdirSync(tmpDir, { recursive: true })

    try {
      const totalFrames = 60
      const fps = 30
      const chunks = planChunkSlices(totalFrames, 2, fps, tmpDir)

      // Encode chunk 0 (frames 0..30) and chunk 1 (frames 30..60)
      for (const chunk of chunks) {
        const chunkArgs = buildChunkExportArgs({
          renderWidth: 64,
          renderHeight: 64,
          targetWidth: 64,
          targetHeight: 64,
          fps,
          chunkDuration: chunk.chunkDuration,
          outputPath: chunk.chunkPath,
          encoder: 'libx264',
          quality: 'medium',
        })

        // Generate rawvideo stream using FFmpeg from demothat-demo.mp4 (64x64 keeps memory < 500KB)
        const rawFrames = execFileSync(FFMPEG, [
          '-y',
          '-ss',
          (chunk.startFrame / fps).toString(),
          '-i',
          demoVideo,
          '-vframes',
          chunk.chunkFrames.toString(),
          '-vf',
          'scale=64:64',
          '-f',
          'rawvideo',
          '-pix_fmt',
          'rgba',
          '-',
        ])

        // Feed rawvideo into chunk encode
        execFileSync(FFMPEG, chunkArgs, { input: rawFrames })
        expect(fs.existsSync(chunk.chunkPath)).toBe(true)
      }

      // Generate concat manifest
      const concatListPath = path.join(tmpDir, 'concat.txt')
      const concatContent = chunks.map((c) => `file '${c.chunkPath.replace(/'/g, "'\\''")}'`).join('\n')
      fs.writeFileSync(concatListPath, concatContent, 'utf8')

      // Stitch chunks
      const outputPath = path.join(tmpDir, 'stitched.mp4')
      const concatArgs = buildConcatExportArgs({
        concatListPath,
        outputPath,
        projectState: { aspectRatio: '16:9', duration: totalFrames / fps, hasAudioTrack: false, isMuted: true },
        totalFrames,
        fps,
      })

      execFileSync(FFMPEG, concatArgs)
      expect(fs.existsSync(outputPath)).toBe(true)

      // Probe stitched video using showinfo
      const probeResult = spawnSync(FFMPEG, ['-i', outputPath, '-vf', 'showinfo', '-f', 'null', '-'])
      expect(probeResult.status).toBe(0)
      const probeOutput = probeResult.stderr.toString()

      // Parse showinfo lines
      const showinfoLines = probeOutput.split('\n').filter((l) => l.includes('Parsed_showinfo_0') && l.includes('n:'))
      expect(showinfoLines.length).toBe(totalFrames) // Exactly 60 frames

      // Verify continuous PTS
      const ptsList: number[] = []
      for (const line of showinfoLines) {
        const ptsMatch = line.match(/pts:\s*(\d+)/)
        if (ptsMatch) {
          ptsList.push(parseInt(ptsMatch[1], 10))
        }
      }

      expect(ptsList.length).toBe(totalFrames)
      for (let i = 1; i < ptsList.length; i++) {
        // Monotonic strictly increasing PTS
        expect(ptsList[i]).toBeGreaterThan(ptsList[i - 1])
        // Continuous frame step (delta is constant)
        const delta = ptsList[i] - ptsList[i - 1]
        expect(delta).toBe(ptsList[1] - ptsList[0])
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
