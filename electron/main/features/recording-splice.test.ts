import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import fsPromises from 'node:fs/promises'
import type { Stats } from 'node:fs'

const mockFfmpegEvents: { cmd?: string; args?: string[] }[] = []

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('../lib/utils', () => ({
  getFFmpegPath: vi.fn(() => '/mock/ffmpeg'),
}))

vi.mock('./audio-tracks', () => ({
  probeAudioTracks: vi.fn().mockImplementation(async (filePath: string) => {
    if (filePath.includes('no-audio')) return []
    return [{ index: 0, kind: 'mic', name: 'mic', codec: 'aac', channels: 1, sampleRate: 48000 }]
  }),
}))

vi.mock('node:fs/promises', () => ({
  default: {
    stat: vi.fn().mockResolvedValue({ size: 1024, birthtimeMs: Date.now() }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('{}'),
    unlink: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('node:child_process', () => ({
  spawn: vi.fn((cmd: string, args: string[]) => {
    mockFfmpegEvents.push({ cmd, args })
    const proc = Object.assign(new EventEmitter(), {
      stdin: { write: vi.fn(), end: vi.fn() },
      stderr: new EventEmitter(),
      stdout: new EventEmitter(),
      kill: vi.fn(),
    })
    setTimeout(() => {
      if (args.includes('-hide_banner')) {
        const inputIdx = args.indexOf('-i')
        const inputFile = inputIdx !== -1 ? args[inputIdx + 1] : ''
        if (inputFile.includes('original')) {
          proc.stderr.emit('data', 'Duration: 00:00:10.00, start: 0.000000, bitrate: 1000 kb/s\n')
        } else if (inputFile.includes('new')) {
          proc.stderr.emit('data', 'Duration: 00:00:04.00, start: 0.000000, bitrate: 1000 kb/s\n')
        } else {
          proc.stderr.emit('data', 'Duration: 00:00:05.00, start: 0.000000, bitrate: 1000 kb/s\n')
        }
      }
      proc.emit('close', 0)
    }, 5)
    return proc
  }),
}))

import {
  mergeMetadata,
  mergeReorderedMetadata,
  buildExtractPartArgs,
  buildConcatArgs,
  probeVideoDurationSec,
  runFfmpeg,
  spliceVideoFiles,
  spliceRecordingIntoProject,
  reorderRecordingsInProject,
  type RecordingMetadata,
  type RecordingSegment,
} from './recording-splice'

describe('recording-splice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFfmpegEvents.length = 0
    vi.mocked(fsPromises.stat).mockResolvedValue({ size: 1024, birthtimeMs: Date.now() } as unknown as Stats)
  })

  describe('mergeMetadata', () => {
    it('merges events in milliseconds when timestamps > 100 and insertTime < 100', () => {
      const origMeta: RecordingMetadata = {
        platform: 'linux',
        screenSize: { width: 1920, height: 1080 },
        geometry: { x: 0, y: 0, width: 1920, height: 1080 },
        cursorImages: { cur1: { image: [1] } },
        audioTracks: [{ index: 0, kind: 'mic' }],
        events: [
          { timestamp: 1000, type: 'move', x: 10, y: 10 },
          { timestamp: 2000, type: 'click', x: 20, y: 20 },
          { timestamp: 5000, type: 'move', x: 50, y: 50 },
        ],
      }

      const newMeta: RecordingMetadata = {
        cursorImages: { cur2: { image: [2] } },
        events: [
          { timestamp: 500, type: 'move', x: 100, y: 100 },
          { timestamp: 1500, type: 'click', x: 150, y: 150 },
        ],
      }

      // insertTime: 2.0s, newDuration: 3.0s (both in seconds)
      const merged = mergeMetadata(origMeta, newMeta, 2.0, 3.0)

      expect(merged.platform).toBe('linux')
      expect(merged.screenSize).toEqual({ width: 1920, height: 1080 })
      expect(merged.geometry).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
      expect(merged.cursorImages).toEqual({
        cur1: { image: [1] },
        cur2: { image: [2] },
      })
      expect(merged.audioTracks).toEqual([{ index: 0, kind: 'mic' }])

      // Event timings in ms:
      // Part 1: timestamp <= 2000ms from orig:
      //   - 1000ms -> 1000ms
      //   - 2000ms -> 2000ms
      // Part 2: new events shifted by +2000ms:
      //   - 500ms + 2000ms = 2500ms
      //   - 1500ms + 2000ms = 3500ms
      // Part 3: orig events > 2000ms shifted by +3000ms (newDuration):
      //   - 5000ms + 3000ms = 8000ms
      expect(merged.events).toHaveLength(5)
      expect(merged.events![0]).toMatchObject({ timestamp: 1000, x: 10 })
      expect(merged.events![1]).toMatchObject({ timestamp: 2000, x: 20 })
      expect(merged.events![2]).toMatchObject({ timestamp: 2500, x: 100 })
      expect(merged.events![3]).toMatchObject({ timestamp: 3500, x: 150 })
      expect(merged.events![4]).toMatchObject({ timestamp: 8000, x: 50 })
    })

    it('merges events when timestamps and insertTime are in seconds', () => {
      const origMeta: RecordingMetadata = {
        events: [
          { timestamp: 1.0, type: 'move' },
          { timestamp: 4.0, type: 'move' },
        ],
      }
      const newMeta: RecordingMetadata = {
        events: [{ timestamp: 0.5, type: 'click' }],
      }

      // insertTime: 2.0s, newDuration: 1.5s
      const merged = mergeMetadata(origMeta, newMeta, 2.0, 1.5)
      expect(merged.events).toEqual([
        { timestamp: 1.0, type: 'move' },
        { timestamp: 2.5, type: 'click' }, // 0.5 + 2.0
        { timestamp: 5.5, type: 'move' }, // 4.0 + 1.5
      ])
    })

    it('handles prepend case when insertTime <= 0', () => {
      const origMeta: RecordingMetadata = {
        events: [
          { timestamp: 0, type: 'move' },
          { timestamp: 2000, type: 'click' },
        ],
      }
      const newMeta: RecordingMetadata = {
        events: [{ timestamp: 1000, type: 'move' }],
      }

      const merged = mergeMetadata(origMeta, newMeta, 0, 3.0)
      // insertTime = 0, newDuration = 3000ms
      // orig timestamp 0 <= 0 -> 0
      // new timestamp 1000 + 0 -> 1000
      // orig timestamp 2000 > 0 -> 2000 + 3000 = 5000
      expect(merged.events).toEqual([
        { timestamp: 0, type: 'move' },
        { timestamp: 1000, type: 'move' },
        { timestamp: 5000, type: 'click' },
      ])
    })

    it('handles append case when insertTime >= duration', () => {
      const origMeta: RecordingMetadata = {
        events: [
          { timestamp: 1000, type: 'move' },
          { timestamp: 3000, type: 'click' },
        ],
      }
      const newMeta: RecordingMetadata = {
        events: [{ timestamp: 500, type: 'move' }],
      }

      // insertTime: 10.0s (>= orig duration), newDuration: 2.0s
      const merged = mergeMetadata(origMeta, newMeta, 10.0, 2.0)
      // all orig events <= 10000ms stay as-is
      // new event shifted by +10000ms
      expect(merged.events).toEqual([
        { timestamp: 1000, type: 'move' },
        { timestamp: 3000, type: 'click' },
        { timestamp: 10500, type: 'move' },
      ])
    })

    it('handles empty events lists gracefully', () => {
      const origMeta: RecordingMetadata = { events: [] }
      const newMeta: RecordingMetadata = {}

      const merged = mergeMetadata(origMeta, newMeta, 2.0, 1.0)
      expect(merged.events).toEqual([])
    })

    it('adopts new audioTracks if original has none', () => {
      const origMeta: RecordingMetadata = { audioTracks: [] }
      const newMeta: RecordingMetadata = { audioTracks: [{ kind: 'mic', index: 0 }] }

      const merged = mergeMetadata(origMeta, newMeta, 1.0, 1.0)
      expect(merged.audioTracks).toEqual([{ kind: 'mic', index: 0 }])
    })
  })

  describe('buildExtractPartArgs', () => {
    it('builds args for Part 1 with startTime and duration', () => {
      const args = buildExtractPartArgs({
        inputPath: '/tmp/orig.mp4',
        startTime: 0,
        duration: 3.5,
        outputPath: '/tmp/part1.mp4',
        hasAudio: true,
      })

      expect(args).toContain('-i')
      expect(args).toContain('/tmp/orig.mp4')
      expect(args).toContain('-t')
      expect(args).toContain('3.500')
      expect(args).toContain('-c:v')
      expect(args).toContain('libx264')
      expect(args).toContain('-c:a')
      expect(args).toContain('aac')
      expect(args).toContain('-ar')
      expect(args).toContain('48000')
      expect(args).toContain('/tmp/part1.mp4')
    })

    it('builds args for Part 3 with startTime only and no audio', () => {
      const args = buildExtractPartArgs({
        inputPath: '/tmp/orig.mp4',
        startTime: 3.5,
        outputPath: '/tmp/part3.mp4',
        hasAudio: false,
      })

      expect(args).toContain('-ss')
      expect(args).toContain('3.500')
      expect(args).not.toContain('-t')
      expect(args).toContain('-an')
      expect(args).toContain('/tmp/part3.mp4')
    })
  })

  describe('buildConcatArgs', () => {
    it('builds concat demuxer args with stream copy', () => {
      const args = buildConcatArgs('/tmp/concat.txt', '/tmp/output.mp4')
      expect(args).toEqual([
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        '/tmp/concat.txt',
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        '/tmp/output.mp4',
      ])
    })
  })

  describe('probeVideoDurationSec', () => {
    it('returns parsed seconds from ffmpeg banner', async () => {
      const duration = await probeVideoDurationSec('/tmp/original.mp4')
      expect(duration).toBe(10.0)
    })
  })

  describe('runFfmpeg', () => {
    it('resolves with code 0 on success', async () => {
      const res = await runFfmpeg(['-version'])
      expect(res.code).toBe(0)
    })
  })

  describe('spliceVideoFiles', () => {
    it('executes 3-part middle splice when 0 < insertTime < duration', async () => {
      const result = await spliceVideoFiles({
        originalPath: '/tmp/original.mp4',
        newPath: '/tmp/new.mp4',
        insertTime: 4.0,
        originalDuration: 10.0,
        newDuration: 3.0,
        outputPath: '/tmp/output.mp4',
      })

      expect(result).toBe('/tmp/output.mp4')
      // Splicing produces 3 extract spawns + 1 concat spawn
      const extractCalls = mockFfmpegEvents.filter((e) => e.args?.includes('-c:v'))
      expect(extractCalls).toHaveLength(3)

      const concatCall = mockFfmpegEvents.find((e) => e.args?.includes('concat'))
      expect(concatCall).toBeDefined()
      expect(concatCall?.args).toContain('/tmp/output.mp4')
    })

    it('executes 2-part prepend splice when insertTime <= 0', async () => {
      const result = await spliceVideoFiles({
        originalPath: '/tmp/original.mp4',
        newPath: '/tmp/new.mp4',
        insertTime: 0,
        originalDuration: 10.0,
        newDuration: 3.0,
        outputPath: '/tmp/output.mp4',
      })

      expect(result).toBe('/tmp/output.mp4')
      const extractCalls = mockFfmpegEvents.filter((e) => e.args?.includes('-c:v'))
      expect(extractCalls).toHaveLength(2)
    })

    it('executes 2-part append splice when insertTime >= originalDuration', async () => {
      const result = await spliceVideoFiles({
        originalPath: '/tmp/original.mp4',
        newPath: '/tmp/new.mp4',
        insertTime: 12.0,
        originalDuration: 10.0,
        newDuration: 3.0,
        outputPath: '/tmp/output.mp4',
      })

      expect(result).toBe('/tmp/output.mp4')
      const extractCalls = mockFfmpegEvents.filter((e) => e.args?.includes('-c:v'))
      expect(extractCalls).toHaveLength(2)
    })
  })

  describe('spliceRecordingIntoProject', () => {
    it('splices screen video, merges metadata, and returns result', async () => {
      vi.mocked(fsPromises.readFile).mockImplementation(async (filePath) => {
        if (String(filePath).includes('original')) {
          return JSON.stringify({
            platform: 'linux',
            screenSize: { width: 1920, height: 1080 },
            geometry: { x: 0, y: 0, width: 1920, height: 1080 },
            events: [
              { timestamp: 1000, type: 'move' },
              { timestamp: 5000, type: 'click' },
            ],
          })
        }
        return JSON.stringify({
          events: [{ timestamp: 500, type: 'move' }],
        })
      })

      const outcome = await spliceRecordingIntoProject({
        originalVideoPath: '/recordings/original.mp4',
        originalMetadataPath: '/recordings/original.json',
        newVideoPath: '/recordings/new.mp4',
        newMetadataPath: '/recordings/new.json',
        insertTime: 2.5,
      })

      expect(outcome.screenVideoPath).toContain('spliced-')
      expect(outcome.screenVideoPath).toContain('-screen.mp4')
      expect(outcome.metadataPath).toContain('spliced-')
      expect(outcome.metadataPath).toContain('.json')
      expect(outcome.addedDuration).toBe(4.0) // probed new.mp4 duration is 4.0s
      expect(outcome.webcamVideoPath).toBeUndefined()

      // Verify merged metadata was written to disk
      expect(fsPromises.writeFile).toHaveBeenCalled()
      const writeCall = vi
        .mocked(fsPromises.writeFile)
        .mock.calls.find((c) => String(c[0]).includes('spliced-') && String(c[0]).endsWith('.json'))
      expect(writeCall).toBeDefined()
      const parsed = JSON.parse(writeCall![1] as string)
      expect(parsed.events).toHaveLength(3)
    })

    it('splices webcam video when original and new webcam paths are provided', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue('{"events":[]}')

      const outcome = await spliceRecordingIntoProject({
        originalVideoPath: '/recordings/original.mp4',
        originalMetadataPath: '/recordings/original.json',
        originalWebcamPath: '/recordings/original-webcam.mp4',
        newVideoPath: '/recordings/new.mp4',
        newMetadataPath: '/recordings/new.json',
        newWebcamPath: '/recordings/new-webcam.mp4',
        insertTime: 3.0,
      })

      expect(outcome.webcamVideoPath).toBeDefined()
      expect(outcome.webcamVideoPath).toContain('webcam.mp4')
    })
  })

  describe('mergeReorderedMetadata', () => {
    it('remaps events accurately when segments are reordered', () => {
      const segA: RecordingSegment = {
        id: 'seg-a',
        name: 'Recording 1',
        startTime: 4.0, // moved after B
        duration: 5.0,
        sourceVideoPath: '/path/a.mp4',
        sourceMetadataPath: '/path/a.json',
        sourceStartTime: 0,
      }
      const segB: RecordingSegment = {
        id: 'seg-b',
        name: 'Recording 2',
        startTime: 0, // moved first
        duration: 4.0,
        sourceVideoPath: '/path/b.mp4',
        sourceMetadataPath: '/path/b.json',
        sourceStartTime: 0,
      }

      const metaMap: Record<string, RecordingMetadata> = {
        '/path/a.json': {
          platform: 'linux',
          screenSize: { width: 1920, height: 1080 },
          events: [
            { timestamp: 1000, type: 'move' },
            { timestamp: 3000, type: 'click' },
          ],
        },
        '/path/b.json': {
          platform: 'linux',
          screenSize: { width: 1920, height: 1080 },
          events: [
            { timestamp: 500, type: 'click' },
            { timestamp: 2000, type: 'move' },
          ],
        },
      }

      const merged = mergeReorderedMetadata([segB, segA], metaMap)

      expect(merged.events).toHaveLength(4)
      // B events should be at 0.5s (500ms) and 2.0s (2000ms)
      expect(merged.events![0].timestamp).toBe(500)
      expect(merged.events![1].timestamp).toBe(2000)
      // A events should now start at 4000ms (4.0s) + offset
      expect(merged.events![2].timestamp).toBe(5000) // 1000 + 4000
      expect(merged.events![3].timestamp).toBe(7000) // 3000 + 4000
    })
  })

  describe('reorderRecordingsInProject', () => {
    it('slices and concats multiple segments into seamless reordered output', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify({ events: [{ timestamp: 1000 }] }))

      const seg1: RecordingSegment = {
        id: 'rec-2',
        name: 'Recording 2',
        startTime: 0,
        duration: 4.0,
        sourceVideoPath: '/recordings/new.mp4',
        sourceMetadataPath: '/recordings/new.json',
        sourceStartTime: 0,
      }
      const seg2: RecordingSegment = {
        id: 'rec-1',
        name: 'Recording 1',
        startTime: 4.0,
        duration: 10.0,
        sourceVideoPath: '/recordings/original.mp4',
        sourceMetadataPath: '/recordings/original.json',
        sourceStartTime: 0,
      }

      const res = await reorderRecordingsInProject({
        segments: [seg1, seg2],
        outputDir: '/recordings',
      })

      expect(res.screenVideoPath).toContain('spliced-')
      expect(res.screenVideoPath).toContain('-screen.mp4')
      expect(res.metadataPath).toContain('spliced-')
      expect(res.metadataPath).toContain('.json')

      // Verify concat file was written and ffmpeg called
      expect(fsPromises.writeFile).toHaveBeenCalled()
      const concatCall = vi
        .mocked(fsPromises.writeFile)
        .mock.calls.find((c) => String(c[0]).includes('reorder_') && String(c[0]).endsWith('_concat.txt'))
      expect(concatCall).toBeDefined()
    })
  })
})
