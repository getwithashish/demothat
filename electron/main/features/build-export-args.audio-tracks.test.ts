// The recording's audio sources in the export graph.
//
// The recording file holds one stream per source, and `[N:a]` addresses only the
// first of them. Mapping it once — which is what this did before the sources were
// separated — silently exports the microphone and drops the system audio, with no
// error and no sign in the output that anything is missing.
//
// So the assertions here are mostly about what is *in* the graph, and about the
// input indices staying lined up when a source is dropped: a source that is muted
// must not shift the imported clips' input numbers, or a music track would be
// mapped from the recording's file.

import { describe, expect, it } from 'vitest'
import { buildExportArgs, type ExportAudioClip, type ExportProjectState } from './build-export-args'

function state(overrides: Partial<ExportProjectState> = {}): ExportProjectState {
  return { aspectRatio: '16:9', duration: 10, ...overrides }
}

function args(projectState: ExportProjectState, extra: Partial<Parameters<typeof buildExportArgs>[0]> = {}) {
  return buildExportArgs({
    projectState,
    exportSettings: { resolution: '1080p', fps: 30, format: 'mp4', quality: 'high' },
    outputPath: '/out.mp4',
    renderWidth: 1920,
    renderHeight: 1080,
    targetWidth: 1920,
    targetHeight: 1080,
    clickSoundPath: null,
    ...extra,
  })
}

/** The filter graph, which is where the audio chains live. */
function graph(argv: string[]): string {
  const index = argv.indexOf('-filter_complex')
  return index === -1 ? '' : (argv[index + 1] ?? '')
}

const music: ExportAudioClip = {
  filePath: '/music.mp3',
  startTime: 1,
  duration: 4,
  sourceStart: 0,
  sourceDuration: 4,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  loop: false,
  kind: 'music',
}

const RECORDING = { videoPath: '/rec.mp4', hasAudioTrack: true }

describe('the recording’s audio sources', () => {
  it('gives each source its own chain, with its own gain', () => {
    const argv = args(
      state({
        ...RECORDING,
        volume: 1,
        audioTracks: [
          { index: 0, volume: 1, muted: false },
          { index: 1, volume: 0.25, muted: false },
        ],
      }),
    )

    const g = graph(argv)
    // Both streams, named, not just the first one.
    expect(g).toContain('[1:a:0]')
    expect(g).toContain('[1:a:1]')
    expect(g).toContain('volume=1[original]')
    expect(g).toContain('volume=0.25[original1]')
  })

  it('multiplies the master volume into each source', () => {
    const argv = args(
      state({
        ...RECORDING,
        volume: 0.5,
        audioTracks: [
          { index: 0, volume: 0.5, muted: false },
          { index: 1, volume: 1, muted: false },
        ],
      }),
    )

    expect(graph(argv)).toContain('volume=0.25[original]')
    expect(graph(argv)).toContain('volume=0.5[original1]')
  })

  it('leaves out a muted source entirely', () => {
    const argv = args(
      state({
        ...RECORDING,
        volume: 1,
        audioTracks: [
          { index: 0, volume: 1, muted: true },
          { index: 1, volume: 1, muted: false },
        ],
      }),
    )

    const g = graph(argv)
    expect(g).not.toContain('[1:a:0]')
    expect(g).toContain('[1:a:1]')
    // The kept source is the first chain, so it keeps the primary label.
    expect(g).toContain('volume=1[original]')
    expect(g).not.toContain('[original1]')
  })

  it('leaves out a source turned all the way down', () => {
    const argv = args(
      state({
        ...RECORDING,
        volume: 1,
        audioTracks: [
          { index: 0, volume: 0, muted: false },
          { index: 1, volume: 1, muted: false },
        ],
      }),
    )

    // A chain that multiplies by zero is a pass over the whole recording for no
    // audio at all.
    expect(graph(argv)).not.toContain('[1:a:0]')
    expect(graph(argv)).toContain('[1:a:1]')
  })

  it('carries no recording audio at all when every source is muted', () => {
    const argv = args(
      state({
        ...RECORDING,
        volume: 1,
        audioTracks: [
          { index: 0, volume: 1, muted: true },
          { index: 1, volume: 1, muted: true },
        ],
      }),
    )

    expect(graph(argv)).toBe('')
    // And the recording is not added as an input, so nothing downstream shifts.
    expect(argv.filter((value) => value === '/rec.mp4')).toHaveLength(0)
  })

  it('keeps the imported clips’ input index when a source is dropped', () => {
    const argv = args(
      state({
        ...RECORDING,
        volume: 1,
        audioClips: [music],
        audioTracks: [
          { index: 0, volume: 1, muted: true },
          { index: 1, volume: 1, muted: false },
        ],
      }),
    )

    const g = graph(argv)
    // The recording is still input 1, so the music is input 2 — not 1, which is the
    // recording's own file.
    expect(g).toContain('[1:a:1]')
    expect(g).toContain('[2:a]')
    expect(argv.filter((value) => value === '/music.mp3')).toHaveLength(1)
  })

  it('carries no recording audio when the whole recording is muted', () => {
    const argv = args(
      state({
        ...RECORDING,
        isMuted: true,
        audioTracks: [{ index: 0, volume: 1, muted: false }],
      }),
    )

    expect(graph(argv)).toBe('')
    expect(argv.filter((value) => value === '/rec.mp4')).toHaveLength(0)
  })

  it('takes a project without audioTracks as one source, which is what it has', () => {
    // A project saved before the sources were separated.
    const argv = args(state({ ...RECORDING, volume: 0.8 }))

    const g = graph(argv)
    expect(g).toContain('[1:a:0]')
    expect(g).toContain('volume=0.8[original]')
    expect(g).not.toContain('[original1]')
  })

  it('does not treat an empty track list as a source', () => {
    // An empty list means the recording has no audio, not that it has one unnamed
    // stream — so nothing is mapped.
    const argv = args(state({ ...RECORDING, volume: 1, audioTracks: [] }))

    expect(graph(argv)).toBe('')
    expect(argv.filter((value) => value === '/rec.mp4')).toHaveLength(0)
  })

  it('still mixes the sources with the imported clips', () => {
    const argv = args(
      state({
        ...RECORDING,
        volume: 1,
        audioClips: [music],
        audioTracks: [
          { index: 0, volume: 1, muted: false },
          { index: 1, volume: 0.5, muted: false },
        ],
      }),
    )

    const g = graph(argv)
    expect(g).toContain('[original]')
    expect(g).toContain('[original1]')
    expect(g).toContain('[music0]')
    // All three reach the mix.
    expect(g).toMatch(/amix=inputs=3/)
  })
})
