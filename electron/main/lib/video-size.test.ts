import { describe, expect, it } from 'vitest'
import { parseVideoSize } from './video-size'

// Trimmed from a real `ffmpeg -i` banner for a renderer-produced WebM.
const WEBM_BANNER = `Input #0, matroska,webm, from 'DemoThat-recording-screen.webm':
  Metadata:
    encoder         : Chrome
  Duration: N/A, start: 0.000000, bitrate: N/A
  Stream #0:0(eng): Video: vp9 (Profile 0), yuv420p(tv, bt709), 2560x1440, SAR 1:1 DAR 16:9, 60 fps, 60 tbr, 1k tbn
  Stream #0:1(eng): Audio, none
`

const MP4_BANNER = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'screen.mp4':
  Duration: 00:00:07.42, start: 0.000000, bitrate: 4210 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080 [SAR 1:1 DAR 16:9], 4000 kb/s, 30 fps
`

describe('parseVideoSize', () => {
  it('reads the dimensions of a WebM', () => {
    expect(parseVideoSize(WEBM_BANNER)).toEqual({ width: 2560, height: 1440 })
  })

  it('reads the dimensions of an MP4 with a sample aspect ratio', () => {
    expect(parseVideoSize(MP4_BANNER)).toEqual({ width: 1920, height: 1080 })
  })

  it('reads a small capture size', () => {
    expect(parseVideoSize('  Stream #0:0: Video: h264, yuv420p, 320x240, 30 fps')).toEqual({
      width: 320,
      height: 240,
    })
  })

  it('has nothing to report without a video stream', () => {
    expect(parseVideoSize('  Stream #0:0: Audio: opus, 48000 Hz, stereo, fltp')).toBeNull()
    expect(parseVideoSize('')).toBeNull()
    expect(parseVideoSize('No such file or directory')).toBeNull()
  })

  it('is not fooled by a resolution mentioned outside the video stream line', () => {
    // Attached cover art, or the output banner, both mention sizes.
    const noisy = `  Duration: 00:01:00.00, bitrate: 100 kb/s
  Stream #0:1: Audio: mp3, 44100 Hz, stereo, fltp, 128 kb/s
  Stream #0:0: Video: mjpeg  1280x720
`
    expect(parseVideoSize(noisy)).toEqual({ width: 1280, height: 720 })
  })

  it('takes the first video stream when there are several', () => {
    const two = `  Stream #0:0: Video: vp9, yuv420p, 800x600, 30 fps
  Stream #0:1: Video: vp9, yuv420p, 1600x1200, 30 fps
`
    expect(parseVideoSize(two)).toEqual({ width: 800, height: 600 })
  })
})
