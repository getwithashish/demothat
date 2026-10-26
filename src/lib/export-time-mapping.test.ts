// The two time mappings, held against each other.
//
// There are two of them, in two places, and they have to agree or the export renders
// the wrong frames for the audio it is mixing:
//
//  - `mapExportTimeToSourceTime` (src/lib/utils.ts) is what the renderer uses, frame
//    by frame, to find the source moment to draw;
//  - `mapSourceTimeToExportTime` (the export's) is what places click sounds and
//    imported audio clips on the export's timeline.
//
// They are inverse functions of one another over the timeline the cuts and speed
// regions define. A round trip through both has to land back where it started — and
// that is only true if they describe the same timeline, which is exactly what the
// double-counting bug broke.

import { describe, expect, it } from 'vitest'
import { mapExportTimeToSourceTime, mapSourceTimeToExportTime as rendererMapSourceToExport } from './utils'
import type { CutRegion, SpeedRegion } from '../types'
import {
  computeExportDuration,
  mapSourceTimeToExportTime,
  type ExportProjectState,
} from '../../electron/main/features/build-export-args'

function state(overrides: Partial<ExportProjectState> = {}): ExportProjectState {
  return { aspectRatio: '16:9', duration: 10, ...overrides }
}

const cut = (startTime: number, duration: number) => ({ startTime, duration })
const speed = (startTime: number, duration: number, factor: number) => ({ startTime, duration, speed: factor })

/** The same state, in the shapes the renderer's mapping takes. */
function regions(projectState: ExportProjectState) {
  return {
    duration: Number(projectState.duration) || 0,
    cutRegions: (projectState.cutRegions ?? {}) as unknown as Record<string, CutRegion>,
    speedRegions: (projectState.speedRegions ?? {}) as unknown as Record<string, SpeedRegion>,
  }
}

const CASES: { name: string; state: ExportProjectState }[] = [
  { name: 'untouched', state: state() },
  { name: 'one cut', state: state({ cutRegions: { a: cut(2, 3) } }) },
  { name: 'a cut at the start', state: state({ cutRegions: { a: cut(0, 2) } }) },
  { name: 'two cuts', state: state({ cutRegions: { a: cut(1, 1), b: cut(6, 2) } }) },
  { name: 'a speed region at 2x', state: state({ speedRegions: { a: speed(3, 4, 2) } }) },
  { name: 'a speed region at 0.5x', state: state({ speedRegions: { a: speed(3, 4, 0.5) } }) },
  { name: 'a speed region at 4x', state: state({ speedRegions: { a: speed(3, 4, 4) } }) },
  { name: 'two speed regions', state: state({ speedRegions: { a: speed(1, 2, 2), b: speed(5, 2, 0.5) } }) },
  {
    name: 'a cut and a speed region',
    state: state({ cutRegions: { c: cut(2, 2) }, speedRegions: { s: speed(6, 2, 4) } }),
  },
  // The overlapping arrangements: the ones that used to disagree.
  {
    name: 'a cut inside a speed region',
    state: state({ speedRegions: { s: speed(2, 4, 2) }, cutRegions: { c: cut(3, 2) } }),
  },
  {
    name: 'a speed region inside a cut',
    state: state({ cutRegions: { c: cut(2, 4) }, speedRegions: { s: speed(3, 2, 2) } }),
  },
  {
    name: 'a speed region straddling a cut',
    state: state({ cutRegions: { c: cut(4, 2) }, speedRegions: { s: speed(3, 4, 0.5) } }),
  },
]

describe('the renderer’s mapping and the export’s are inverses', () => {
  for (const testCase of CASES) {
    it(`round-trips for ${testCase.name}`, () => {
      const { duration, cutRegions, speedRegions } = regions(testCase.state)
      const exportDuration = computeExportDuration(testCase.state)
      expect(exportDuration).toBeGreaterThan(0)

      // Sample the export timeline: every tenth of a second, and the ends.
      const samples = [0, exportDuration, ...Array.from({ length: 19 }, (_, i) => ((i + 1) * exportDuration) / 20)]
      for (const exportTime of samples) {
        const sourceTime = mapExportTimeToSourceTime(exportTime, duration, cutRegions, speedRegions)
        const backToExport = mapSourceTimeToExportTime(sourceTime, testCase.state)
        // Within a frame at 30fps: the two are floating-point walks of the same list.
        expect(Math.abs(backToExport - exportTime)).toBeLessThan(1 / 30)
      }
    })

    it(`has two forward mappings that agree for ${testCase.name}`, () => {
      // The export has one and the renderer has another, because the main process
      // cannot import from the renderer and the renderer should not reach into the
      // main process. Two copies of the same arithmetic is exactly what drifts, so
      // this is the assertion that says they have not.
      const { duration, cutRegions, speedRegions } = regions(testCase.state)

      for (let sourceTime = 0; sourceTime <= duration; sourceTime += duration / 40) {
        expect(rendererMapSourceToExport(sourceTime, duration, cutRegions, speedRegions)).toBeCloseTo(
          mapSourceTimeToExportTime(sourceTime, testCase.state),
          6,
        )
      }
    })
  }
})

describe('what the renderer’s mapping promises', () => {
  it('never lands inside a cut, whatever the export time', () => {
    // The frame the renderer draws must exist in the recording. A source time inside
    // a cut is material the editor removed.
    const testCase = state({ cutRegions: { a: cut(2, 3), b: cut(6, 1) } })
    const { duration, cutRegions, speedRegions } = regions(testCase)

    for (let exportTime = 0; exportTime <= computeExportDuration(testCase); exportTime += 0.1) {
      const sourceTime = mapExportTimeToSourceTime(exportTime, duration, cutRegions, speedRegions)
      const insideCut = [cut(2, 3), cut(6, 1)].some(
        (region) => sourceTime > region.startTime + 1e-6 && sourceTime < region.startTime + region.duration - 1e-6,
      )
      expect(insideCut).toBe(false)
    }
  })

  it('never runs past the end of the recording', () => {
    const testCase = state({ cutRegions: { a: cut(2, 3) }, speedRegions: { s: speed(6, 2, 2) } })
    const { duration, cutRegions, speedRegions } = regions(testCase)

    for (let exportTime = 0; exportTime <= computeExportDuration(testCase) + 1; exportTime += 0.1) {
      const sourceTime = mapExportTimeToSourceTime(exportTime, duration, cutRegions, speedRegions)
      expect(sourceTime).toBeLessThanOrEqual(duration + 1e-6)
      expect(sourceTime).toBeGreaterThanOrEqual(0)
    }
  })

  it('is monotonic, so the picture never runs backwards', () => {
    const testCase = state({ cutRegions: { c: cut(4, 2) }, speedRegions: { s: speed(2, 2, 2) } })
    const { duration, cutRegions, speedRegions } = regions(testCase)

    let previous = -1
    for (let exportTime = 0; exportTime <= computeExportDuration(testCase); exportTime += 0.05) {
      const sourceTime = mapExportTimeToSourceTime(exportTime, duration, cutRegions, speedRegions)
      expect(sourceTime).toBeGreaterThanOrEqual(previous)
      previous = sourceTime
    }
  })
})
