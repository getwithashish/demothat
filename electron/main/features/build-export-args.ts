// Pure builder for the export FFmpeg argv: raw-video input, audio inputs and
// filter graph, video/audio codec settings and the output path.
//
// Kept free of Electron imports (only Node's path helpers) so the argv can be
// unit tested and extended (see Phase 3: 8K render cap, HEVC).

import type { ResolutionKey } from '../../../shared/export-resolutions'
import { selectExportCodec } from '../../../shared/export-codec'
import { videoEncodeArgs, type ExportQuality } from './export-video-args'

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
   * Resolved click-sound file path, or null when none applies. The caller is
   * responsible for materialising the built-in click WAV (see
   * needsBuiltInClickSound) so this function stays pure.
   */
  clickSoundPath?: string | null
}

/** Output clip length after cuts and speed regions. */
export function computeExportDuration(projectState: ExportProjectState): number {
  let exportDuration = Math.max(0, Number(projectState.duration) || 0)
  for (const region of Object.values(projectState.cutRegions ?? {}) as ExportRegion[]) {
    exportDuration -= Number(region.duration) || 0
  }
  for (const region of Object.values(projectState.speedRegions ?? {}) as ExportSpeedRegion[]) {
    exportDuration -= Number(region.duration) || 0
    exportDuration += (Number(region.duration) || 0) / Math.max(0.01, Number(region.speed) || 1)
  }
  return Math.max(0, exportDuration)
}

export function mapSourceTimeToExportTime(sourceTime: number, projectState: ExportProjectState): number {
  let exportTime = Math.max(0, sourceTime)
  for (const region of Object.values(projectState.cutRegions ?? {}) as ExportRegion[]) {
    if (region.startTime + region.duration <= sourceTime) exportTime -= region.duration
    else if (region.startTime < sourceTime) exportTime -= sourceTime - region.startTime
  }
  for (const region of Object.values(projectState.speedRegions ?? {}) as ExportSpeedRegion[]) {
    if (region.startTime + region.duration <= sourceTime) exportTime += region.duration - region.duration / region.speed
    else if (region.startTime < sourceTime) {
      const elapsed = sourceTime - region.startTime
      exportTime += elapsed - elapsed / region.speed
    }
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

export function buildExportArgs(options: BuildExportArgsOptions): string[] {
  const { projectState, exportSettings, outputPath, renderWidth, renderHeight, targetWidth, targetHeight } = options
  const { fps, format, quality } = exportSettings
  const isMp4 = format === 'mp4'
  const scaled = renderWidth !== targetWidth || renderHeight !== targetHeight

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
    if (
      projectState.hasAudioTrack &&
      projectState.videoPath &&
      !projectState.isMuted &&
      Number(projectState.volume) > 0
    ) {
      ffmpegArgs.push('-i', projectState.videoPath)
      const originalVolume = Math.max(0, Math.min(1, Number(projectState.volume) || 0))
      audioFilterParts.push(
        `[${inputIndex}:a]atrim=duration=${exportDuration},asetpts=PTS-STARTPTS,volume=${originalVolume}[original]`,
      )
      audioLabels.push('[original]')
      inputIndex++
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
    const encodeArgs = videoEncodeArgs(selectExportCodec(targetHeight), quality)
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
