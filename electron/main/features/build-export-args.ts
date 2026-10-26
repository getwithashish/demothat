// Pure builder for the export FFmpeg argv: raw-video input, audio inputs and
// filter graph, video/audio codec settings and the output path.
//
// Kept free of Electron imports (only Node's path helpers) so the argv can be
// unit tested and extended (see Phase 3: 8K render cap, HEVC).

import type { ResolutionKey } from '../../../shared/export-resolutions'
import { selectExportCodec } from '../../../shared/export-codec'
import { videoEncodeArgs, type ExportQuality } from './export-video-args'
import { buildAudioTimelineSegments, buildRecordingAudioChains, timelineDuration } from './audio-timeline'

export interface ExportRegion {
  startTime: number
  duration: number
}

export interface ExportSpeedRegion extends ExportRegion {
  speed: number
}

export interface ExportAudioClip {
  filePath: string
  startTime: number
  duration: number
  sourceStart: number
  sourceDuration: number
  volume: number
  fadeIn: number
  fadeOut: number
  loop: boolean
  kind?: 'music' | 'click'
  speed?: number
}

/** Shapes the renderer sends over IPC for an export (structural mirror of src/types). */
export interface ExportProjectState {
  aspectRatio: string
  duration: number
  videoPath?: string
  videoDimensions?: { width: number; height: number }
  frameStyles?: { padding?: number }
  zoomRegions?: Record<string, { zoomLevel?: number }>
  cameraMotions?: Array<{ from?: { scale?: number }; to?: { scale?: number } }>
  hasAudioTrack?: boolean
  isMuted?: boolean
  volume?: number
  /**
   * The recording's audio sources, each with its own gain.
   *
   * Absent for a project saved before the sources were separated; the single stream
   * such a recording has is the whole of its audio.
   */
  audioTracks?: Array<{ index: number; volume: number; muted: boolean }>
  /** The captions to write beside the exported video, in export time. */
  subtitleCues?: Array<{ id: string; start: number; end: number; text: string }>
  /** Whether a sidecar is written at all. */
  subtitlesEnabled?: boolean
  /** Which sidecar format to write. */
  subtitleFormat?: 'srt' | 'vtt'
  mouseClickSoundsEnabled?: boolean
  mouseClickSoundPath?: string | null
  mouseClickSoundVolume?: number
  cutRegions?: Record<string, ExportRegion>
  speedRegions?: Record<string, ExportSpeedRegion>
  audioClips?: ExportAudioClip[]
}

export interface ExportSettingsInput {
  resolution: ResolutionKey
  fps: number
  format: string
  quality?: ExportQuality
}

export interface BuildExportArgsOptions {
  projectState: ExportProjectState
  exportSettings: ExportSettingsInput
  outputPath: string
  /** Size the raw frames arrive at (already clamped to the render cap). */
  renderWidth: number
  renderHeight: number
  /** Exact size of the encoded output; FFmpeg scales up when it differs. */
  targetWidth: number
  targetHeight: number
  /**
   * Cloud intermediate: near-lossless H.264 at the render size with the audio
   * already muxed, so the upscaling service only has to touch video.
   */
  intermediate?: boolean
  /**
   * Resolved click-sound file path, or null when none applies. The caller is
   * responsible for materialising the built-in click WAV (see
   * needsBuiltInClickSound) so this function stays pure.
   */
  clickSoundPath?: string | null
}

/** Output clip length after cuts and speed regions. */
/**
 * How long the exported video is.
 *
 * Measured from the timeline the picture and the audio are both rendered against:
 * the source split at every cut and speed boundary, the stretches inside cuts
 * dropped, each survivor counted at its own speed.
 *
 * The previous arithmetic walked the regions instead — subtracting each cut's whole
 * duration and adding back each speed region's whole saving. That double-counts
 * wherever the two overlap: a speed region with a cut inside it lost the cut's
 * seconds twice, and the renderer was handed fewer frames than the video has, so the
 * export ended early. Counting the timeline cannot disagree with itself.
 */
export function computeExportDuration(projectState: ExportProjectState): number {
  return timelineDuration(buildAudioTimelineSegments(projectState))
}

/**
 * Where a moment of the recording lands in the exported video.
 *
 * The inverse of the renderer's `mapExportTimeToSourceTime`, and deliberately the
 * same walk: the segments in order, each contributing its length divided by its
 * speed. A source time inside a cut maps to the moment the cut was removed at, which
 * is where the material either side of it joins.
 */
export function mapSourceTimeToExportTime(sourceTime: number, projectState: ExportProjectState): number {
  const segments = buildAudioTimelineSegments(projectState)
  let exportTime = 0

  for (const segment of segments) {
    if (sourceTime <= segment.sourceStart) break
    const end = Math.min(sourceTime, segment.sourceEnd)
    exportTime += (end - segment.sourceStart) / segment.speed
    if (sourceTime <= segment.sourceEnd) break
  }

  return Math.max(0, exportTime)
}

/**
 * Click sounds that survive cuts and land inside the exported clip. Each click
 * is its own timeline clip, so deleting one removes only that event.
 */
function collectMappedClicks(projectState: ExportProjectState): Array<{ start: number; clipVolume: number }> {
  if (!projectState.mouseClickSoundsEnabled) return []
  const exportDuration = computeExportDuration(projectState)
  const cuts = Object.values(projectState.cutRegions ?? {}) as ExportRegion[]
  const clicks = (projectState.audioClips ?? []).filter(
    (clip) =>
      clip.kind === 'click' &&
      clip.startTime >= 0 &&
      clip.startTime < (Number(projectState.duration) || 0) &&
      clip.volume > 0 &&
      !cuts.some((region) => clip.startTime >= region.startTime && clip.startTime < region.startTime + region.duration),
  )
  return clicks
    .map((click) => ({
      start: mapSourceTimeToExportTime(Number(click.startTime) || 0, projectState),
      clipVolume: Math.max(0, Math.min(1, Number(click.volume) || 0)),
    }))
    .filter((click) => click.start < exportDuration)
}

/** True when the built-in click WAV must be written before building the args. */
export function needsBuiltInClickSound(projectState: ExportProjectState): boolean {
  if (projectState.mouseClickSoundPath) return false
  return collectMappedClicks(projectState).length > 0
}

/**
 * The Standard (Lanczos) fallback for a cloud export that failed.
 *
 * The intermediate is already rendered with its audio muxed, so this only scales
 * it to the exact target and encodes — no second render, which is the whole point
 * of keeping the intermediate around.
 */
export function buildCloudFallbackArgs(options: {
  intermediatePath: string
  outputPath: string
  targetWidth: number
  targetHeight: number
  quality?: BuildExportArgsOptions['exportSettings']['quality']
}): string[] {
  const { intermediatePath, outputPath, targetWidth, targetHeight } = options
  return [
    '-y',
    '-hide_banner',
    '-i',
    intermediatePath,
    '-map',
    '0:v:0',
    '-vf',
    `scale=${targetWidth}:${targetHeight}:flags=lanczos`,
    ...videoEncodeArgs(selectExportCodec(targetHeight), options.quality),
    // Audio was muxed by the render; copy it rather than re-encoding.
    '-map',
    '0:a?',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    outputPath,
  ]
}

/**
 * The cloud path's intermediate: near-lossless H.264 at the render size, audio
 * already muxed, so the server only upscales video and copies audio. CRF 14
 * keeps the upscaler's input clean without a lossless codec's cost, and
 * faststart helps the server seek the upload.
 */
const INTERMEDIATE_VIDEO_ARGS = [
  '-c:v',
  'libx264',
  '-preset',
  'medium',
  '-crf',
  '14',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
]

export function buildExportArgs(options: BuildExportArgsOptions): string[] {
  const { projectState, exportSettings, outputPath, renderWidth, renderHeight, targetWidth, targetHeight } = options
  const { fps, format, quality } = exportSettings
  const isMp4 = format === 'mp4'
  const intermediate = options.intermediate === true
  // The intermediate stays at the render size: the server does the final scale.
  const scaled = !intermediate && (renderWidth !== targetWidth || renderHeight !== targetHeight)

  const ffmpegArgs: string[] = [
    '-y',
    '-f',
    'rawvideo',
    '-vcodec',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-s',
    `${renderWidth}x${renderHeight}`,
    '-r',
    fps.toString(),
    '-i',
    '-',
  ]

  const audioFilterParts: string[] = []
  const audioLabels: string[] = []
  const exportDuration = computeExportDuration(projectState)

  if (isMp4) {
    let inputIndex = 1
    const masterVolume = Math.max(0, Math.min(1, Number(projectState.volume) || 0))
    /**
     * The recording's audio sources, each with its own gain.
     *
     * The recording file holds one stream per source, and `[N:a]` addresses only the
     * first of them — so mapping it once, as this did, silently drops every source
     * but one. Each kept source gets its own chain, and they are mixed together with
     * the imported clips below.
     *
     * A project saved before the sources were separated has no `audioTracks`, and its
     * single stream is the whole of the recording's audio. An empty list is a
     * different thing: it is a recording the editor believes has no audio, and
     * falling back to stream 0 there would export audio the editor says is not
     * there.
     */
    const recordingTracks: { index: number; volume: number; muted: boolean }[] = Array.isArray(projectState.audioTracks)
      ? projectState.audioTracks.map((track) => ({
          index: Math.max(0, Math.trunc(Number(track.index) || 0)),
          volume: Math.max(0, Math.min(1, Number(track.volume))),
          muted: track.muted === true,
        }))
      : [{ index: 0, volume: 1, muted: false }]
    // A muted or silent source contributes nothing, and a chain that multiplies by
    // zero is a decoder pass over the whole recording for no audio at all.
    const keptTracks = recordingTracks.filter((track) => !track.muted && track.volume > 0)

    if (projectState.hasAudioTrack && projectState.videoPath && !projectState.isMuted) {
      // The audio is cut and warped exactly as the picture is, so the two cannot run
      // on different clocks once a cut or a speed region is in play.
      const segments = buildAudioTimelineSegments(projectState)
      const chains: { label: string; filters: string[] }[] = []
      keptTracks.forEach((track, position) => {
        const label = position === 0 ? 'original' : `original${position}`
        const filters = buildRecordingAudioChains({
          inputIndex,
          streamIndex: track.index,
          segments,
          volume: masterVolume * track.volume,
          label,
          // Unique per source: a graph with two of them would otherwise define
          // `[seg0]` twice, which FFmpeg rejects.
          segmentPrefix: `${label}_seg`,
        })
        if (filters.length > 0) chains.push({ label, filters })
      })

      // The recording is only added as an input when something will actually be
      // mapped from it — otherwise every later input's index would be off by one and
      // an imported clip would be read out of the recording's file.
      if (chains.length > 0) {
        ffmpegArgs.push('-i', projectState.videoPath)
        for (const chain of chains) {
          audioFilterParts.push(...chain.filters)
          audioLabels.push(`[${chain.label}]`)
        }
        inputIndex++
      }
    }

    const clips = (projectState.audioClips ?? []).filter(
      (clip: ExportAudioClip) =>
        clip.kind !== 'click' &&
        clip.filePath &&
        clip.duration > 0 &&
        clip.volume > 0 &&
        Number(clip.startTime) < Number(projectState.duration),
    )
    clips.forEach((clip: ExportAudioClip, index: number) => {
      const start = mapSourceTimeToExportTime(Math.max(0, Number(clip.startTime) || 0), projectState)
      if (start >= exportDuration) return
      const clipDuration = Math.min(Number(clip.duration) || 0.1, exportDuration - start)
      if (clipDuration <= 0) return
      if (clip.loop) ffmpegArgs.push('-stream_loop', '-1')
      ffmpegArgs.push('-i', clip.filePath)
      const speed = Math.max(0.5, Math.min(2, Number(clip.speed) || 1))
      const fadeIn = Math.max(0, Math.min(clipDuration, Number(clip.fadeIn) || 0))
      const fadeOut = Math.max(0, Math.min(clipDuration, Number(clip.fadeOut) || 0))
      const sourceStart = Math.max(0, Number(clip.sourceStart) || 0)
      const sourceAvailable = Math.max(0.1, (Number(clip.sourceDuration) || clipDuration) - sourceStart)
      const sourceTrimDuration = clip.loop ? clipDuration * speed : Math.min(clipDuration * speed, sourceAvailable)
      const label = `music${index}`
      let filter = `[${inputIndex}:a]atrim=start=${sourceStart}:duration=${sourceTrimDuration},asetpts=PTS-STARTPTS,atempo=${speed},volume=${Math.max(0, Math.min(1, Number(clip.volume) || 0))}`
      if (fadeIn > 0) filter += `,afade=t=in:st=0:d=${fadeIn}`
      if (fadeOut > 0) filter += `,afade=t=out:st=${Math.max(0, clipDuration - fadeOut)}:d=${fadeOut}`
      filter += `,adelay=${Math.round(start * 1000)}|${Math.round(start * 1000)}[${label}]`
      audioFilterParts.push(filter)
      audioLabels.push(`[${label}]`)
      inputIndex++
    })

    const mappedClicks = collectMappedClicks(projectState)
    if (mappedClicks.length > 0 && options.clickSoundPath) {
      ffmpegArgs.push('-i', options.clickSoundPath)
      const splitLabels = mappedClicks.map((_click, index: number) => `[clicksrc${index}]`).join('')
      audioFilterParts.push(`[${inputIndex}:a]asplit=${mappedClicks.length}${splitLabels}`)
      const volume = Math.max(0, Math.min(1, Number(projectState.mouseClickSoundVolume ?? 0.8)))
      mappedClicks.forEach((click, index) => {
        const label = `click${index}`
        const delay = Math.round(click.start * 1000)
        audioFilterParts.push(
          `[clicksrc${index}]atrim=duration=0.25,asetpts=PTS-STARTPTS,volume=${volume * click.clipVolume},adelay=${delay}|${delay}[${label}]`,
        )
        audioLabels.push(`[${label}]`)
      })
      inputIndex++
    }
  }

  if (isMp4) {
    const encodeArgs = intermediate
      ? INTERMEDIATE_VIDEO_ARGS
      : videoEncodeArgs(selectExportCodec(targetHeight), quality)
    ffmpegArgs.push('-map', '0:v:0')
    if (scaled) {
      // The frame arrived at the capped render size; scale to the exact target.
      ffmpegArgs.push('-vf', `scale=${targetWidth}:${targetHeight}:flags=lanczos`)
    }
    if (audioLabels.length > 0) {
      const mixInputs = audioLabels.join('')
      audioFilterParts.push(
        `${mixInputs}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95,atrim=duration=${exportDuration}[aout]`,
      )
      ffmpegArgs.push(
        '-filter_complex',
        audioFilterParts.join(';'),
        '-map',
        '[aout]',
        ...encodeArgs,
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-t',
        exportDuration.toString(),
      )
    } else {
      ffmpegArgs.push(...encodeArgs, '-t', exportDuration.toString())
    }
  } else {
    // GIF is limited to 2K (enforced by the caller), which is always inside the
    // render cap, so no scaling is needed here.
    ffmpegArgs.push('-vf', 'split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse')
  }

  ffmpegArgs.push('-progress', 'pipe:1', '-nostats')
  ffmpegArgs.push(outputPath)
  return ffmpegArgs
}
