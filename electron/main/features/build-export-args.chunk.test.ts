import { describe, expect, it } from 'vitest'
import { buildChunkExportArgs, buildConcatExportArgs, type ExportProjectState } from './build-export-args'

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
    expect(args).toContain('-r')
    expect(args).toContain('60')
    expect(args).toContain('-i')
    expect(args).toContain('-')

    // Maps video only
    expect(args).toContain('-map')
    expect(args).toContain('0:v:0')

    // Encoder settings (defaults to fast software preset)
    expect(args).toContain('-c:v')
    expect(args).toContain('libx264')
    expect(args).toContain('-preset')
    expect(args).toContain('faster')

    // Chunk duration limit
    expect(args).toContain('-t')
    expect(args).toContain('5.5')

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
  })
})
