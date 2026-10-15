import { beforeEach, describe, expect, it, vi } from 'vitest'

// A Map-backed stand-in for electron-store so the module's own logic is tested
// without touching a real config file.
const storeState = vi.hoisted(() => ({ data: new Map<string, unknown>() }))

vi.mock('electron-store', () => ({
  default: class MockStore {
    get(key: string) {
      return storeState.data.get(key)
    }
    set(key: string, value: unknown) {
      storeState.data.set(key, value)
    }
  },
}))

vi.mock('electron-log/main', () => ({
  default: { info: () => undefined, warn: () => undefined, error: () => undefined },
}))

import { getExportPerfSamples, recordExportPerf } from './export-perf'

const SAMPLE = {
  resolution: '1080p' as const,
  codec: 'h264' as const,
  settingFps: 30,
  width: 1920,
  height: 1080,
  throughput: 60,
}

describe('export perf samples', () => {
  beforeEach(() => {
    storeState.data.clear()
  })

  it('starts empty', () => {
    expect(getExportPerfSamples()).toEqual([])
  })

  it('records a measurement and reads it back', () => {
    recordExportPerf(SAMPLE)
    expect(getExportPerfSamples()).toEqual([SAMPLE])
  })

  it('replaces the measurement for the same resolution, codec and frame rate', () => {
    recordExportPerf(SAMPLE)
    recordExportPerf({ ...SAMPLE, throughput: 45 })
    const samples = getExportPerfSamples()
    expect(samples).toHaveLength(1)
    expect(samples[0].throughput).toBe(45)
  })

  it('keeps measurements for different configurations', () => {
    recordExportPerf(SAMPLE)
    recordExportPerf({ ...SAMPLE, codec: 'hevc' })
    recordExportPerf({ ...SAMPLE, resolution: '4k', width: 3840, height: 2160 })
    recordExportPerf({ ...SAMPLE, settingFps: 60 })
    expect(getExportPerfSamples()).toHaveLength(4)
  })

  it('rejects measurements that would poison the estimate', () => {
    recordExportPerf({ ...SAMPLE, throughput: 0 })
    recordExportPerf({ ...SAMPLE, throughput: Number.NaN })
    recordExportPerf({ ...SAMPLE, codec: 'vp9' as unknown as 'h264' })
    expect(getExportPerfSamples()).toEqual([])
  })

  it('ignores stored data that is not a sample array', () => {
    storeState.data.set('export.perf', { nope: true })
    expect(getExportPerfSamples()).toEqual([])
    storeState.data.set('export.perf', [SAMPLE, { junk: 1 }])
    expect(getExportPerfSamples()).toEqual([SAMPLE])
  })
})
