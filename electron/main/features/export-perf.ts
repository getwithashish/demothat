// Records how fast a completed export actually ran, so the export modal can
// estimate render times instead of guessing.
//
// Samples are keyed by resolution + codec + frame-rate setting and stored in
// electron-store; they are only ever a local guess at throughput, never a
// promise, and the measurement is the end-to-end render + encode rate.

import Store from 'electron-store'
import log from 'electron-log/main'
import type { ExportVideoCodec } from '../../../shared/export-codec'
import type { ResolutionKey } from '../../../shared/export-resolutions'

export interface ExportPerfSample {
  resolution: ResolutionKey
  codec: ExportVideoCodec
  /** The frame-rate setting the export ran at. */
  settingFps: number
  width: number
  height: number
  /** Measured frames per second for the whole render + encode pipeline. */
  throughput: number
}

const PERF_SETTING = 'export.perf'
const MAX_SAMPLES = 24

const store = new Store()

function isSample(value: unknown): value is ExportPerfSample {
  if (!value || typeof value !== 'object') return false
  const sample = value as Partial<ExportPerfSample>
  return (
    typeof sample.resolution === 'string' &&
    (sample.codec === 'h264' || sample.codec === 'hevc') &&
    typeof sample.settingFps === 'number' &&
    typeof sample.width === 'number' &&
    typeof sample.height === 'number' &&
    typeof sample.throughput === 'number' &&
    sample.throughput > 0
  )
}

export function getExportPerfSamples(): ExportPerfSample[] {
  const raw = store.get(PERF_SETTING)
  if (!Array.isArray(raw)) return []
  return raw.filter(isSample)
}

/** Stores (or refreshes) the measurement for one configuration. */
export function recordExportPerf(sample: ExportPerfSample): void {
  if (!isSample(sample)) return
  const kept = getExportPerfSamples().filter(
    (existing) =>
      !(
        existing.resolution === sample.resolution &&
        existing.codec === sample.codec &&
        existing.settingFps === sample.settingFps
      ),
  )
  kept.push(sample)
  store.set(PERF_SETTING, kept.slice(-MAX_SAMPLES))
  log.info(
    `[ExportPerf] Recorded ${sample.throughput.toFixed(2)} fps for ${sample.resolution}/${sample.codec}@${sample.settingFps}.`,
  )
}
