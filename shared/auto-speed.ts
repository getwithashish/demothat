// Where the recording can be sped up without anyone minding.
//
// Two kinds of stretch are worth compressing, and they are found differently:
//
//  - **silence**, which the audio knows about directly — nothing is being said, so
//    nothing is lost by playing it faster;
//  - **low activity**, which is everything else that is not going anywhere: typing,
//    a spinner, a progress bar, a page loading. There is no keyboard telemetry to
//    read (the recorder tracks the mouse), so this is measured from the picture:
//    stretches where the screen is barely changing.
//
// The second kind is deliberately generous. A spinner and a progress bar are exactly
// the things worth speeding up, and they look the same as typing to any measure of
// "how much did the screen change" — which is fine, because all three are dead time.
//
// What is not generous is the padding. A speed change is a jump cut in the audio, and
// a region that starts a tenth of a second before the speaker does clips the first
// syllable. Every region is pulled back from both ends so the words sit outside it.

export interface TimeRange {
  start: number
  end: number
}

/** A speed region, in the shape the timeline and the export both use. */
export interface SpeedRegionSpec {
  startTime: number
  duration: number
  speed: number
}

export interface AutoSpeedOptions {
  /**
   * The shortest stretch worth speeding up.
   *
   * Below roughly a second the region saves less time than the jump cut costs in
   * attention: the viewer notices the change and gains almost nothing.
   */
  minDurationSec: number
  /**
   * How much of each end to leave at normal speed.
   *
   * Speech does not start exactly where the silence ends — there is a breath, a
   * keyboard click, an intake of air — and a region that runs right up to it clips
   * the first sound the viewer was waiting for.
   */
  paddingSec: number
  /** What to speed those stretches up to. */
  speed: number
  /** The most regions to propose; a timeline covered in them is unusable. */
  maxRegions: number
}

export const DEFAULT_AUTO_SPEED: AutoSpeedOptions = {
  minDurationSec: 1.2,
  paddingSec: 0.25,
  speed: 2,
  maxRegions: 40,
}

/** The speed range the editor offers, which `atempo` can also render. */
export const MIN_SPEED = 0.5
export const MAX_SPEED = 4

function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return 1
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed))
}

/** Ranges that touch or very nearly touch are one range, not two. */
const ADJACENT_GAP_SEC = 0.05

/** Sort, clamp to the recording, and join the ranges that overlap or abut. */
export function mergeRanges(ranges: TimeRange[], duration: number): TimeRange[] {
  const ordered = ranges
    .map((range) => ({
      start: Math.max(0, Math.min(range.start, range.end)),
      end: Math.min(duration, Math.max(range.start, range.end)),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start)

  const merged: TimeRange[] = []
  for (const range of ordered) {
    const last = merged[merged.length - 1]
    if (last && range.start - last.end <= ADJACENT_GAP_SEC) {
      last.end = Math.max(last.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }
  return merged
}

/** Pull both ends in, and keep only what is still long enough to be worth it. */
function toRegions(
  ranges: TimeRange[],
  options: AutoSpeedOptions,
): SpeedRegionSpec[] {
  const speed = clampSpeed(options.speed)
  const regions: SpeedRegionSpec[] = []

  for (const range of ranges) {
    const start = range.start + options.paddingSec
    const end = range.end - options.paddingSec
    if (end - start < options.minDurationSec) continue
    regions.push({ startTime: start, duration: end - start, speed })
  }

  return regions
}

/**
 * Keep the longest stretches when there are more than the cap allows.
 *
 * The longest are the ones that save the most time, and dropping by position instead
 * would keep a scattering of short ones across the whole recording.
 */
function capRegions(regions: SpeedRegionSpec[], maxRegions: number): SpeedRegionSpec[] {
  if (regions.length <= maxRegions) return regions
  return [...regions]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, maxRegions)
    .sort((a, b) => a.startTime - b.startTime)
}

/**
 * The stretches worth speeding up, from the silences in the recording.
 *
 * The silences come from the audio itself, so this is the case that can be trusted
 * completely: nobody is speaking, and nothing is lost.
 */
export function suggestSpeedRegionsFromSilence(
  silences: TimeRange[],
  duration: number,
  options: Partial<AutoSpeedOptions> = {},
): SpeedRegionSpec[] {
  const settings = { ...DEFAULT_AUTO_SPEED, ...options }
  if (!(duration > 0) || silences.length === 0) return []

  const merged = mergeRanges(silences, duration)
  return capRegions(toRegions(merged, settings), settings.maxRegions)
}

export interface ActivitySample {
  /** When, in the recording's own time. */
  time: number
  /**
   * How much the picture changed at that moment, 0 to 1.
   *
   * Anything consistent works — a difference between consecutive frames, a count of
   * changed blocks — because only the comparison between moments matters.
   */
  activity: number
}

/**
 * The stretches worth speeding up, from how much the screen was changing.
 *
 * Typing, a spinner and a progress bar all sit below any sensible threshold, which is
 * what makes this useful: they are all time the viewer is waiting rather than
 * watching. The threshold is the caller's to choose, because what counts as "barely
 * moving" depends on the recording.
 */
export function suggestSpeedRegionsFromActivity(
  samples: ActivitySample[],
  duration: number,
  options: Partial<AutoSpeedOptions> & { threshold?: number } = {},
): SpeedRegionSpec[] {
  const settings = { ...DEFAULT_AUTO_SPEED, ...options }
  const threshold = options.threshold ?? 0.02
  if (!(duration > 0) || samples.length < 2) return []

  const ordered = [...samples].sort((a, b) => a.time - b.time)
  const quiet: TimeRange[] = []
  let runStart: number | null = null

  for (let index = 0; index < ordered.length; index += 1) {
    const sample = ordered[index] as ActivitySample
    const quietHere = Number(sample.activity) <= threshold

    if (quietHere && runStart === null) runStart = Math.max(0, sample.time)
    // A run ends where the activity returns, and it ends *at the previous sample* —
    // the moment the screen started moving again is already the busy part.
    if (!quietHere && runStart !== null) {
      quiet.push({ start: runStart, end: sample.time })
      runStart = null
    }
  }
  // Still quiet at the last sample: the run goes to the end of the recording.
  if (runStart !== null) quiet.push({ start: runStart, end: duration })

  return capRegions(toRegions(mergeRanges(quiet, duration), settings), settings.maxRegions)
}

/**
 * The two kinds together, as one list.
 *
 * Silence and low activity overlap heavily — nobody is typing while they are talking
 * — so the result is merged: two regions over the same stretch would be two speed
 * changes where the viewer expects one.
 */
export function suggestSpeedRegions(
  input: { silences?: TimeRange[]; samples?: ActivitySample[]; duration: number },
  options: Partial<AutoSpeedOptions> & { threshold?: number } = {},
): SpeedRegionSpec[] {
  const settings = { ...DEFAULT_AUTO_SPEED, ...options }
  const fromSilence = suggestSpeedRegionsFromSilence(input.silences ?? [], input.duration, settings)
  const fromActivity = suggestSpeedRegionsFromActivity(input.samples ?? [], input.duration, settings)

  const ranges: TimeRange[] = [...fromSilence, ...fromActivity].map((region) => ({
    start: region.startTime,
    end: region.startTime + region.duration,
  }))

  // No padding here: both sources have already trimmed their own ends, and trimming
  // again would pull every region back twice — 0.5s off a stretch that only had a
  // quarter second to spare, which is how a merged region ends up starting after the
  // sound it was supposed to avoid.
  return capRegions(toRegions(mergeRanges(ranges, input.duration), { ...settings, paddingSec: 0 }), settings.maxRegions)
}
