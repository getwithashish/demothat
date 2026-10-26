// Where the recording can be sped up.
//
// The rules that matter are the ones about what *not* to touch: a region that starts
// a tenth of a second before the speaker does clips the first syllable, and a region
// over a stretch that was never quiet speeds up something the viewer was watching.
// So the padding, the minimum length and the merging get the most attention here.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTO_SPEED,
  mergeRanges,
  suggestSpeedRegions,
  suggestSpeedRegionsFromActivity,
  suggestSpeedRegionsFromSilence,
  type ActivitySample,
} from './auto-speed'

const silence = (start: number, end: number) => ({ start, end })

describe('mergeRanges', () => {
  it('joins ranges that overlap', () => {
    expect(mergeRanges([silence(0, 3), silence(2, 5)], 10)).toEqual([silence(0, 5)])
  })

  it('joins ranges that very nearly touch, because a 10ms gap is not a sound', () => {
    expect(mergeRanges([silence(0, 3), silence(3.01, 5)], 10)).toEqual([silence(0, 5)])
  })

  it('keeps a real gap as two ranges', () => {
    expect(mergeRanges([silence(0, 3), silence(4, 6)], 10)).toEqual([silence(0, 3), silence(4, 6)])
  })

  it('sorts, and clamps to the recording', () => {
    expect(mergeRanges([silence(5, 20), silence(-2, 1)], 10)).toEqual([silence(0, 1), silence(5, 10)])
  })

  it('drops a range with no length', () => {
    expect(mergeRanges([silence(3, 3)], 10)).toEqual([])
  })
})

describe('suggestSpeedRegionsFromSilence', () => {
  it('speeds up a silence, leaving the edges at normal speed', () => {
    const regions = suggestSpeedRegionsFromSilence([silence(2, 6)], 10)

    // The padding is the point: speech does not start where the silence ends.
    expect(regions).toEqual([
      { startTime: 2 + DEFAULT_AUTO_SPEED.paddingSec, duration: 4 - 2 * DEFAULT_AUTO_SPEED.paddingSec, speed: 2 },
    ])
  })

  it('leaves a short silence alone', () => {
    // A pause for breath: speeding it up saves less time than the jump cut costs.
    const regions = suggestSpeedRegionsFromSilence([silence(2, 3)], 10)

    expect(regions).toEqual([])
  })

  it('measures the minimum against the padded length, not the raw silence', () => {
    // 1.6s of silence, 0.5s of padding, so 1.1s is left — under the 1.2s minimum.
    expect(suggestSpeedRegionsFromSilence([silence(2, 3.6)], 10)).toEqual([])
    // A shade longer and it survives.
    expect(suggestSpeedRegionsFromSilence([silence(2, 3.8)], 10)).toHaveLength(1)
  })

  it('merges silences that run together rather than emitting two speed changes', () => {
    const regions = suggestSpeedRegionsFromSilence([silence(2, 4), silence(4.02, 7)], 10)

    expect(regions).toHaveLength(1)
    expect(regions[0]?.startTime).toBeCloseTo(2.25, 6)
    expect(regions[0]?.duration).toBeCloseTo(4.5, 6)
  })

  it('keeps the regions in time order', () => {
    const regions = suggestSpeedRegionsFromSilence([silence(6, 9), silence(1, 4)], 12)

    expect(regions.map((region) => region.startTime)).toEqual([1.25, 6.25])
  })

  it('never proposes a region past the end of the recording', () => {
    for (const region of suggestSpeedRegionsFromSilence([silence(8, 10)], 10)) {
      expect(region.startTime + region.duration).toBeLessThanOrEqual(10)
    }
  })

  it('clamps the speed to what the editor offers', () => {
    expect(suggestSpeedRegionsFromSilence([silence(2, 6)], 10, { speed: 99 })[0]?.speed).toBe(4)
    expect(suggestSpeedRegionsFromSilence([silence(2, 6)], 10, { speed: 0.01 })[0]?.speed).toBe(0.5)
    expect(suggestSpeedRegionsFromSilence([silence(2, 6)], 10, { speed: Number.NaN })[0]?.speed).toBe(1)
  })

  it('keeps the longest when there are more stretches than the cap allows', () => {
    // Twelve silences, three of them long; a cap of three must keep those.
    const silences = Array.from({ length: 12 }, (_, index) => silence(index * 5, index * 5 + 1.5))
    silences.push(silence(70, 80), silence(85, 95), silence(100, 110))

    const regions = suggestSpeedRegionsFromSilence(silences, 120, { maxRegions: 3 })

    expect(regions).toHaveLength(3)
    // Ten seconds of silence, half a second trimmed from each end.
    expect(regions.map((region) => region.duration)).toEqual([9.5, 9.5, 9.5])
    // And they come back in time order, not in the order they were chosen.
    expect(regions.map((region) => region.startTime)).toEqual([70.25, 85.25, 100.25])
  })

  it('has nothing to suggest for a recording with no silence', () => {
    expect(suggestSpeedRegionsFromSilence([], 10)).toEqual([])
    expect(suggestSpeedRegionsFromSilence([silence(1, 2)], 0)).toEqual([])
  })
})

describe('suggestSpeedRegionsFromActivity', () => {
  const samples = (values: number[]): ActivitySample[] => values.map((activity, index) => ({ time: index, activity }))

  it('speeds up a stretch where the screen barely changes', () => {
    // Busy, then quiet for four seconds, then busy again.
    const regions = suggestSpeedRegionsFromActivity(samples([0.5, 0.5, 0.01, 0.01, 0.01, 0.01, 0.5, 0.5]), 8)

    expect(regions).toHaveLength(1)
    expect(regions[0]?.startTime).toBeCloseTo(2.25, 6)
  })

  it('counts typing and a spinner as quiet, which is the point', () => {
    // Small but non-zero changes: a few characters appearing, a spinner turning.
    const typing = samples([0.5, 0.01, 0.012, 0.008, 0.011, 0.009, 0.5])

    expect(suggestSpeedRegionsFromActivity(typing, 7)).toHaveLength(1)
  })

  it('leaves a busy stretch alone', () => {
    expect(suggestSpeedRegionsFromActivity(samples([0.5, 0.6, 0.7, 0.8]), 4)).toEqual([])
  })

  it('ends a quiet run where the activity returns, not after it', () => {
    // Quiet from t=1 to t=4, busy again at t=4. The busy sample is the first frame of
    // the new material, so it is not part of the quiet stretch.
    const regions = suggestSpeedRegionsFromActivity(samples([0.5, 0.01, 0.01, 0.01, 0.5, 0.5, 0.5]), 7)

    expect(regions[0]?.startTime).toBeCloseTo(1.25, 6)
    expect((regions[0]?.startTime ?? 0) + (regions[0]?.duration ?? 0)).toBeCloseTo(4 - 0.25, 6)
  })

  it('runs to the end when the recording finishes quiet', () => {
    const regions = suggestSpeedRegionsFromActivity(samples([0.5, 0.01, 0.01]), 3)

    expect(regions[0]?.startTime).toBeCloseTo(1.25, 6)
    // To the end of the recording, less the padding both sources always trim.
    expect((regions[0]?.startTime ?? 0) + (regions[0]?.duration ?? 0)).toBeCloseTo(2.75, 6)
  })

  it('takes the threshold from the caller', () => {
    const values = [0.5, 0.1, 0.1, 0.1, 0.1, 0.1, 0.5]

    // 0.1 is busy at a threshold of 0.02 and quiet at one of 0.2.
    expect(suggestSpeedRegionsFromActivity(samples(values), 7, { threshold: 0.02 })).toEqual([])
    expect(suggestSpeedRegionsFromActivity(samples(values), 7, { threshold: 0.2 })).toHaveLength(1)
  })

  it('does not care what order the samples arrive in', () => {
    const shuffled = [samples([0.5, 0.01, 0.01, 0.01, 0.5, 0.5, 0.5])[0] as ActivitySample]
    const all = samples([0.5, 0.01, 0.01, 0.01, 0.5, 0.5, 0.5])
    shuffled.push(...[...all].reverse())

    expect(suggestSpeedRegionsFromActivity(shuffled, 7)).toHaveLength(1)
  })

  it('has nothing to suggest without enough samples to tell quiet from busy', () => {
    expect(suggestSpeedRegionsFromActivity([], 10)).toEqual([])
    expect(suggestSpeedRegionsFromActivity(samples([0.01]), 10)).toEqual([])
  })
})

describe('suggestSpeedRegions', () => {
  it('merges the two sources, so a silent stretch is one speed change and not two', () => {
    // Silence from 2 to 6, and the same stretch is also barely changing.
    const samples: ActivitySample[] = Array.from({ length: 12 }, (_, index) => ({
      time: index * 0.5,
      activity: index * 0.5 >= 2 && index * 0.5 <= 6 ? 0.001 : 0.5,
    }))

    const regions = suggestSpeedRegions({ silences: [silence(2, 6)], samples, duration: 6 })

    expect(regions).toHaveLength(1)
    expect(regions[0]?.startTime).toBeCloseTo(2.25, 6)
  })

  it('takes the silence on its own when there is no activity to read', () => {
    const regions = suggestSpeedRegions({ silences: [silence(2, 6)], duration: 10 })

    expect(regions).toHaveLength(1)
  })

  it('has nothing to suggest for a recording that is busy and noisy throughout', () => {
    const samples: ActivitySample[] = Array.from({ length: 10 }, (_, index) => ({ time: index, activity: 0.8 }))

    expect(suggestSpeedRegions({ silences: [], samples, duration: 10 })).toEqual([])
  })
})
