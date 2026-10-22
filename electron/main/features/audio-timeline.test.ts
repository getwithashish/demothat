// The recording's audio on the export's timeline.
//
// The headline test is the invariant: however the cuts and speed regions are
// arranged, the audio the graph produces is as long as the video the same regions
// produce. That is the whole point — every other assertion here is about how it gets
// there, and that one is about whether it arrives.

import { describe, expect, it } from 'vitest'
import { computeExportDuration, type ExportProjectState } from './build-export-args'
import {
  atempoChain,
  buildAudioTimelineSegments,
  buildRecordingAudioChains,
  timelineDuration,
} from './audio-timeline'

function state(overrides: Partial<ExportProjectState> = {}): ExportProjectState {
  return { aspectRatio: '16:9', duration: 10, ...overrides }
}

const cut = (startTime: number, duration: number) => ({ startTime, duration })
const speed = (startTime: number, duration: number, factor: number) => ({ startTime, duration, speed: factor })

/** Source stretches as `start-end@speed`, for readable expectations. */
const shape = (segments: { sourceStart: number; sourceEnd: number; speed: number }[]) =>
  segments.map((segment) => `${segment.sourceStart}-${segment.sourceEnd}@${segment.speed}`)

describe('atempoChain', () => {
  it('costs nothing at normal speed', () => {
    expect(atempoChain(1)).toEqual([])
  })

  it('is a single filter inside the range atempo can do in one pass', () => {
    expect(atempoChain(2)).toEqual(['atempo=2'])
    expect(atempoChain(0.5)).toEqual(['atempo=0.5'])
    expect(atempoChain(1.5)).toEqual(['atempo=1.5'])
  })

  it('chains for a speed above the range atempo can do in one pass', () => {
    // atempo takes one factor between 0.5 and 2, so 4x is two passes — and 4x is also
    // the fastest the editor offers, so anything beyond it clamps to the same chain.
    expect(atempoChain(4)).toEqual(['atempo=2', 'atempo=2'])
    expect(atempoChain(8)).toEqual(['atempo=2', 'atempo=2'])
  })

  it('clamps to the range the editor offers, and treats nonsense as unchanged', () => {
    // 0.5 is the slowest the editor offers and atempo does it in one pass, so there
    // is no lower chain to build.
    expect(atempoChain(0.25)).toEqual(['atempo=0.5'])
    expect(atempoChain(100)).toEqual(['atempo=2', 'atempo=2'])
    expect(atempoChain(0)).toEqual([])
    expect(atempoChain(Number.NaN)).toEqual([])
  })
})

describe('buildAudioTimelineSegments', () => {
  it('is one segment covering the recording when nothing is cut or sped up', () => {
    expect(shape(buildAudioTimelineSegments(state()))).toEqual(['0-10@1'])
  })

  it('drops the cut stretches and keeps the rest', () => {
    const segments = buildAudioTimelineSegments(state({ cutRegions: { a: cut(2, 3) } }))

    expect(shape(segments)).toEqual(['0-2@1', '5-10@1'])
  })

  it('keeps a speed region as its own stretch, at its own speed', () => {
    const segments = buildAudioTimelineSegments(state({ speedRegions: { a: speed(4, 2, 2) } }))

    expect(shape(segments)).toEqual(['0-4@1', '4-6@2', '6-10@1'])
  })

  it('joins neighbouring stretches that play at the same speed', () => {
    // Two cuts, so the stretch between them is its own stretch — but it is still 1x,
    // and a filter node per stretch would be a node for nothing.
    const segments = buildAudioTimelineSegments(
      state({ cutRegions: { a: cut(2, 1), b: cut(5, 1) } }),
    )

    expect(shape(segments)).toEqual(['0-2@1', '3-5@1', '6-10@1'])
  })

  it('handles a cut and a speed region together', () => {
    const segments = buildAudioTimelineSegments(
      state({ cutRegions: { c: cut(2, 2) }, speedRegions: { s: speed(6, 2, 4) } }),
    )

    expect(shape(segments)).toEqual(['0-2@1', '4-6@1', '6-8@4', '8-10@1'])
  })

  it('has nothing left when the whole recording is cut', () => {
    expect(buildAudioTimelineSegments(state({ cutRegions: { a: cut(0, 10) } }))).toEqual([])
  })

  it('ignores a zero-length region rather than splitting on it', () => {
    expect(shape(buildAudioTimelineSegments(state({ cutRegions: { a: cut(5, 0) } })))).toEqual(['0-10@1'])
  })

  it('has nothing for a recording with no duration', () => {
    expect(buildAudioTimelineSegments(state({ duration: 0 }))).toEqual([])
  })

  it('ignores a region that starts beyond the recording', () => {
    expect(shape(buildAudioTimelineSegments(state({ cutRegions: { a: cut(20, 2) } })))).toEqual(['0-10@1'])
  })
})

// The invariant. If this fails, the audio and the picture are on different clocks —
// which is the failure the whole feature exists to prevent, and the one a viewer
// notices within seconds and cannot unsee.
describe('the audio is as long as the video', () => {
  const cases: { name: string; state: ExportProjectState }[] = [
    { name: 'untouched', state: state() },
    { name: 'one cut', state: state({ cutRegions: { a: cut(2, 3) } }) },
    { name: 'two cuts', state: state({ cutRegions: { a: cut(1, 1), b: cut(6, 2) } }) },
    { name: 'a cut at the start', state: state({ cutRegions: { a: cut(0, 2) } }) },
    { name: 'a cut at the end', state: state({ cutRegions: { a: cut(8, 2) } }) },
    { name: 'one speed region', state: state({ speedRegions: { a: speed(3, 4, 2) } }) },
    { name: 'a slowing region', state: state({ speedRegions: { a: speed(3, 4, 0.5) } }) },
    { name: 'a 4x region', state: state({ speedRegions: { a: speed(3, 4, 4) } }) },
    { name: 'two speed regions', state: state({ speedRegions: { a: speed(1, 2, 2), b: speed(5, 2, 0.5) } }) },
    { name: 'a cut and a speed region', state: state({ cutRegions: { c: cut(2, 2) }, speedRegions: { s: speed(6, 2, 4) } }) },
    { name: 'a cut between two speed regions', state: state({ cutRegions: { c: cut(4, 2) }, speedRegions: { a: speed(1, 2, 2), b: speed(7, 2, 2) } }) },
  ]

  for (const testCase of cases) {
    it(`matches for ${testCase.name}`, () => {
      const segments = buildAudioTimelineSegments(testCase.state)

      expect(timelineDuration(segments)).toBeCloseTo(computeExportDuration(testCase.state), 6)
    })
  }
})

describe('buildRecordingAudioChains', () => {
  const base = { inputIndex: 1, streamIndex: 0, volume: 1, label: 'original' }

  it('is a single chain when there is nothing to cut or warp', () => {
    const segments = buildAudioTimelineSegments(state())
    const chains = buildRecordingAudioChains({ ...base, segments })

    // No concat and no atempo: the common case costs exactly what it did before.
    expect(chains).toEqual(['[1:a:0]atrim=start=0:end=10,asetpts=PTS-STARTPTS,volume=1[original]'])
  })

  it('reads the stream it was told to, not the input’s default', () => {
    const segments = buildAudioTimelineSegments(state())
    const chains = buildRecordingAudioChains({ ...base, streamIndex: 1, segments })

    expect(chains[0]).toContain('[1:a:1]')
  })

  it('applies the gain it was given', () => {
    const segments = buildAudioTimelineSegments(state())
    const chains = buildRecordingAudioChains({ ...base, volume: 0.35, segments })

    expect(chains[0]).toContain('volume=0.35')
  })

  it('cuts the audio where the video is cut, and joins the pieces', () => {
    const segments = buildAudioTimelineSegments(state({ cutRegions: { a: cut(2, 3) } }))
    const chains = buildRecordingAudioChains({ ...base, segments })

    expect(chains).toHaveLength(3)
    expect(chains[0]).toBe('[1:a:0]atrim=start=0:end=2,asetpts=PTS-STARTPTS[seg0]')
    expect(chains[1]).toBe('[1:a:0]atrim=start=5:end=10,asetpts=PTS-STARTPTS[seg1]')
    expect(chains[2]).toBe('[seg0][seg1]concat=n=2:v=0:a=1,volume=1[original]')
  })

  it('speeds the audio up over a speed region', () => {
    const segments = buildAudioTimelineSegments(state({ speedRegions: { a: speed(4, 2, 2) } }))
    const chains = buildRecordingAudioChains({ ...base, segments })

    // Three stretches, so three chains and then the join.
    expect(chains).toHaveLength(4)
    expect(chains[1]).toContain('atempo=2')
    expect(chains[3]).toBe('[seg0][seg1][seg2]concat=n=3:v=0:a=1,volume=1[original]')
  })

  it('has no chains at all when every stretch is cut away', () => {
    const segments = buildAudioTimelineSegments(state({ cutRegions: { a: cut(0, 10) } }))

    expect(buildRecordingAudioChains({ ...base, segments })).toEqual([])
  })
})

// A region can overlap another, and the two regions disagree about how long the
// result is. Documented rather than hidden: the audio timeline is the one that is
// right, because inside a cut there is no picture for the audio to be out of step
// with — and `computeExportDuration` counts the speed region's whole duration even
// where the cut removed it.
describe('regions that overlap each other', () => {
  it('drops the overlapping stretch rather than warping it', () => {
    // A 4s speed region at 2x, with a 2s cut inside it. The cut wins for the part it
    // covers: there are no frames there to play audio against.
    const segments = buildAudioTimelineSegments(
      state({ speedRegions: { s: speed(2, 4, 2) }, cutRegions: { c: cut(3, 2) } }),
    )

    expect(shape(segments)).toEqual(['0-2@1', '2-3@2', '5-6@2', '6-10@1'])
  })

  it('is longer than what computeExportDuration claims, and that is the video’s bug', () => {
    const overlapping = state({ speedRegions: { s: speed(2, 4, 2) }, cutRegions: { c: cut(3, 2) } })

    // In export terms: 2s at 1x, then 1s of source at 2x, then 2s of source cut away
    // — 1s of the sped-up stretch — then 0.5s, then 4s. Seven seconds.
    expect(timelineDuration(buildAudioTimelineSegments(overlapping))).toBe(7)

    // `computeExportDuration` counts the speed region's whole four seconds as sped up
    // and the cut's two seconds as removed, double-counting the overlap: it says six.
    // The frame count the renderer is given is therefore wrong for overlapping
    // regions, and the audio timeline is the one that is right — inside a cut there
    // is no picture for the audio to be out of step with. Asserted as known rather
    // than fixed here, so the discrepancy cannot change unnoticed.
    expect(computeExportDuration(overlapping)).toBe(6)
  })
})
