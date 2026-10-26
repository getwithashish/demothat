// The recording's audio, on the export's timeline.
//
// The video is rendered frame by frame for export time and each frame is mapped back
// to the source recording; cuts remove stretches of source time and speed regions
// compress them. The audio was not doing any of that: it was one `atrim` for the
// export's duration, taken from the *start of the source*. With a cut, the audio
// kept playing through material the video had removed, and from that point on the
// two ran on different clocks — permanently out of step, and worse with every later
// cut. With a speed region the audio stayed at 1x while the picture moved faster.
//
// So the audio is cut and warped the same way the picture is. The source timeline is
// split at every cut and speed boundary, the pieces inside cuts are dropped, each
// surviving piece is played at its own speed, and the pieces are joined back
// together. The invariant that matters, and the one the tests assert: the result is
// as long as the video the same regions produce.
//
// This is pure: it takes the project state and returns filter strings. Whether
// FFmpeg accepts them is a separate question, answered against the real binary in the
// integration suite.

import type { ExportProjectState, ExportRegion, ExportSpeedRegion } from './build-export-args'

/** The speeds the editor offers, and the range `atempo` can do in one pass. */
const MIN_SPEED = 0.5
const MAX_SPEED = 4

/** One stretch of the recording, played at one speed. */
export interface AudioTimelineSegment {
  /** Where the stretch starts in the recording's own timeline, in seconds. */
  sourceStart: number
  /** Where it ends. */
  sourceEnd: number
  /** 1 plays it as recorded; 2 plays it twice as fast. */
  speed: number
}

/** Trim a float to something readable in a filter graph. */
function round(value: number): string {
  return String(Math.round(value * 1e6) / 1e6)
}

function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return 1
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed))
}

/**
 * `atempo` takes one factor between 0.5 and 2, so anything above that is a chain:
 * 4x is `atempo=2,atempo=2`.
 *
 * There is no chain below 1x, because there is nothing for it to do: the slowest
 * speed the editor offers is 0.5, which `atempo` handles in a single pass, and the
 * clamp guarantees a lower value never reaches here.
 *
 * Returns nothing for 1x, so an unchanged stretch costs no filter at all.
 */
export function atempoChain(speed: number): string[] {
  let remaining = clampSpeed(speed)
  const parts: string[] = []

  while (remaining > 2 + 1e-9) {
    parts.push('atempo=2')
    remaining /= 2
  }
  if (Math.abs(remaining - 1) > 1e-6) parts.push(`atempo=${round(remaining)}`)

  return parts
}

function cutRegions(projectState: ExportProjectState): ExportRegion[] {
  return (Object.values(projectState.cutRegions ?? {}) as ExportRegion[])
    .filter((region) => Number(region.duration) > 0)
    .map((region) => ({ startTime: Math.max(0, Number(region.startTime) || 0), duration: Number(region.duration) }))
    .sort((a, b) => a.startTime - b.startTime)
}

function speedRegions(projectState: ExportProjectState): ExportSpeedRegion[] {
  return (Object.values(projectState.speedRegions ?? {}) as ExportSpeedRegion[])
    .filter((region) => Number(region.duration) > 0)
    .map((region) => ({
      startTime: Math.max(0, Number(region.startTime) || 0),
      duration: Number(region.duration),
      speed: clampSpeed(Number(region.speed) || 1),
    }))
    .sort((a, b) => a.startTime - b.startTime)
}

/**
 * The stretches of the recording that survive the cuts, each with the speed it plays
 * at, in order.
 *
 * Adjacent stretches at the same speed are joined, so a recording with no cuts and
 * no speed regions comes back as one segment — which keeps the common case's filter
 * graph as small as it was before any of this existed.
 */
export function buildAudioTimelineSegments(projectState: ExportProjectState): AudioTimelineSegment[] {
  const duration = Math.max(0, Number(projectState.duration) || 0)
  if (duration === 0) return []

  const cuts = cutRegions(projectState)
  const speeds = speedRegions(projectState)

  // Every cut edge and every speed edge, so a stretch never straddles a boundary and
  // can be described by a single speed.
  const edges = new Set<number>([0, duration])
  for (const region of cuts) {
    edges.add(region.startTime)
    edges.add(region.startTime + region.duration)
  }
  for (const region of speeds) {
    edges.add(region.startTime)
    edges.add(region.startTime + region.duration)
  }

  const sorted = [...edges].filter((edge) => edge >= 0 && edge <= duration).sort((a, b) => a - b)
  const segments: AudioTimelineSegment[] = []

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index] as number
    const end = sorted[index + 1] as number
    if (end - start <= 1e-6) continue

    // Inside a cut: the video has no frames for this stretch, so neither has the
    // audio. The midpoint decides, which is exact because every edge is a boundary.
    const midpoint = (start + end) / 2
    if (cuts.some((cut) => midpoint >= cut.startTime && midpoint < cut.startTime + cut.duration)) continue

    const region = speeds.find((speed) => midpoint >= speed.startTime && midpoint < speed.startTime + speed.duration)
    const speed = region ? region.speed : 1

    const previous = segments[segments.length - 1]
    if (previous && previous.speed === speed && Math.abs(previous.sourceEnd - start) < 1e-6) {
      previous.sourceEnd = end
    } else {
      segments.push({ sourceStart: start, sourceEnd: end, speed })
    }
  }

  return segments
}

/** How long the segments add up to once each is played at its own speed. */
export function timelineDuration(segments: AudioTimelineSegment[]): number {
  return segments.reduce((total, segment) => total + (segment.sourceEnd - segment.sourceStart) / segment.speed, 0)
}

export interface BuildRecordingAudioOptions {
  /** Which FFmpeg input the recording is. */
  inputIndex: number
  /** Which of that input's audio streams — the source this chain is for. */
  streamIndex: number
  segments: AudioTimelineSegment[]
  /** Master volume already multiplied by this source's own. */
  volume: number
  /** The label the rest of the graph refers to. */
  label: string
  /**
   * Prefix for the intermediate per-stretch labels.
   *
   * They have to be unique across the whole filter graph, and a graph with two
   * sources would otherwise emit `[seg0]` twice — which FFmpeg rejects outright. The
   * caller passes something derived from `label` when more than one source is in
   * play.
   */
  segmentPrefix?: string
}

/**
 * The filter chains for one audio source of the recording, ending at `label`.
 *
 * Returns an empty list for no segments: a source that is entirely inside cuts has
 * nothing to contribute, and a chain for it would be a filter that outputs silence.
 */
export function buildRecordingAudioChains(options: BuildRecordingAudioOptions): string[] {
  const { inputIndex, streamIndex, segments, volume, label, segmentPrefix = 'seg' } = options
  if (segments.length === 0) return []

  const stream = `[${inputIndex}:a:${streamIndex}]`
  const gain = round(Math.max(0, Math.min(1, volume)))

  if (segments.length === 1) {
    const segment = segments[0] as AudioTimelineSegment
    const filters = [
      `atrim=start=${round(segment.sourceStart)}:end=${round(segment.sourceEnd)}`,
      'asetpts=PTS-STARTPTS',
      ...atempoChain(segment.speed),
      `volume=${gain}`,
    ]
    return [`${stream}${filters.join(',')}[${label}]`]
  }

  const chains: string[] = []
  const labels: string[] = []
  segments.forEach((segment, index) => {
    const segmentLabel = `${segmentPrefix}${index}`
    const filters = [
      `atrim=start=${round(segment.sourceStart)}:end=${round(segment.sourceEnd)}`,
      'asetpts=PTS-STARTPTS',
      ...atempoChain(segment.speed),
    ]
    chains.push(`${stream}${filters.join(',')}[${segmentLabel}]`)
    labels.push(`[${segmentLabel}]`)
  })
  chains.push(`${labels.join('')}concat=n=${segments.length}:v=0:a=1,volume=${gain}[${label}]`)

  return chains
}
