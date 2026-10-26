// The caption sidecar.
//
// The path is the part that has to be exactly right: a sidecar named `holiday.mp4.srt`
// is invisible to the players that would auto-load `holiday.srt`, so the export would
// look like it had produced captions and the user would see none.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { sidecarPath, writeSubtitleSidecar } from './subtitle-sidecar'
import type { SubtitleCue } from '../../../shared/subtitles'

const cue = (id: string, start: number, end: number, text: string): SubtitleCue => ({ id, start, end, text })

describe('sidecarPath', () => {
  it('replaces the video’s extension rather than adding to it', () => {
    // `holiday.mp4.srt` is not what a player looks for when it auto-loads captions.
    expect(sidecarPath('/videos/holiday.mp4', 'srt')).toBe('/videos/holiday.srt')
    expect(sidecarPath('/videos/holiday.mov', 'vtt')).toBe('/videos/holiday.vtt')
  })

  it('puts it beside the video, in the same folder', () => {
    expect(path.dirname(sidecarPath('/a/b/c/out.mp4', 'srt'))).toBe('/a/b/c')
  })

  it('handles a path with no extension', () => {
    expect(sidecarPath('/videos/holiday', 'srt')).toBe('/videos/holiday.srt')
  })

  it('does not mistake a dot in a folder name for an extension', () => {
    expect(sidecarPath('/my.videos/holiday', 'vtt')).toBe('/my.videos/holiday.vtt')
  })

  it('keeps a multi-dot name, replacing only the last part', () => {
    expect(sidecarPath('/videos/holiday.2024.final.mp4', 'srt')).toBe('/videos/holiday.2024.final.srt')
  })
})

describe('writeSubtitleSidecar', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dthat-sidecar-'))
  })

  afterEach(async () => {
    if (dir) await fsp.rm(dir, { recursive: true, force: true })
  })

  const options = (overrides: Partial<Parameters<typeof writeSubtitleSidecar>[0]> = {}) => ({
    outputPath: path.join(dir, 'out.mp4'),
    cues: [cue('a', 0, 2, 'Hello there.')],
    format: 'srt' as const,
    enabled: true,
    ...overrides,
  })

  it('writes the file beside the video, and says where', async () => {
    const result = await writeSubtitleSidecar(options())

    expect(result.written).toBe(true)
    expect(result.path).toBe(path.join(dir, 'out.srt'))
    expect(fs.existsSync(result.path as string)).toBe(true)
  })

  it('writes captions a player can read', async () => {
    const result = await writeSubtitleSidecar(options({ cues: [cue('a', 0, 1.5, 'Hello there.')] }))

    expect(await fsp.readFile(result.path as string, 'utf8')).toBe('1\n00:00:00,000 --> 00:00:01,500\nHello there.\n')
  })

  it('writes WebVTT when that is the format', async () => {
    const result = await writeSubtitleSidecar(options({ format: 'vtt' }))

    expect(result.path).toBe(path.join(dir, 'out.vtt'))
    expect(await fsp.readFile(result.path as string, 'utf8')).toContain('WEBVTT')
  })

  it('writes nothing when the user has not asked for captions', async () => {
    const result = await writeSubtitleSidecar(options({ enabled: false }))

    expect(result.written).toBe(false)
    expect(fs.existsSync(path.join(dir, 'out.srt'))).toBe(false)
  })

  it('writes no file for an empty caption list', async () => {
    // An empty file would be offered by the player as an empty caption track.
    const result = await writeSubtitleSidecar(options({ cues: [] }))

    expect(result.written).toBe(false)
    expect(fs.existsSync(path.join(dir, 'out.srt'))).toBe(false)
  })

  it('normalizes on the way out, not just on the way in', async () => {
    // The editor lets a cue be dragged into an overlap after it was created; the file
    // format's guarantees are about what is written.
    const result = await writeSubtitleSidecar(options({ cues: [cue('a', 0, 5, 'first'), cue('b', 2, 6, 'second')] }))

    const written = await fsp.readFile(result.path as string, 'utf8')
    const ranges = [...written.matchAll(/(\d\d:\d\d:\d\d,\d\d\d) --> (\d\d:\d\d:\d\d,\d\d\d)/g)]
    expect(ranges).toHaveLength(2)
    // The first ends where the second begins: no overlap in the file.
    expect(ranges[0]?.[2]).toBe(ranges[1]?.[1])
  })

  it('reports a failure instead of throwing, because the video is already written', async () => {
    // A path whose directory does not exist.
    const result = await writeSubtitleSidecar(options({ outputPath: path.join(dir, 'missing-folder', 'out.mp4') }))

    expect(result.written).toBe(false)
    expect(result.error).toBeTruthy()
  })
})
