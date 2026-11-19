import { describe, expect, it, afterEach } from 'vitest'
import {
  getCpuMetrics,
  getMemoryMetrics,
  getRamMetrics,
  getWindowMetrics,
  getSystemResourceMetrics,
  logSystemResources,
  startSystemResourceProbe,
  stopSystemResourceProbe,
  resetCpuSampleForTesting,
} from './system-resource-probe'

describe('system-resource-probe', () => {
  afterEach(() => {
    stopSystemResourceProbe()
    resetCpuSampleForTesting()
  })

  it('collects cpu metrics', () => {
    const cpu = getCpuMetrics()
    expect(cpu.userMicroseconds).toBeGreaterThanOrEqual(0)
    expect(cpu.systemMicroseconds).toBeGreaterThanOrEqual(0)
    expect(typeof cpu.loadAverage1m).toBe('number')
  })

  it('collects process memory in MB', () => {
    const mem = getMemoryMetrics()
    expect(mem.rss).toBeGreaterThan(0)
    expect(mem.heapTotal).toBeGreaterThan(0)
    expect(mem.heapUsed).toBeGreaterThan(0)
    expect(mem.external).toBeGreaterThanOrEqual(0)
  })

  it('collects system RAM metrics in MB', () => {
    const ram = getRamMetrics()
    expect(ram.total).toBeGreaterThan(0)
    expect(ram.free).toBeGreaterThan(0)
    expect(ram.used).toBeGreaterThan(0)
    expect(ram.usedPercent).toBeGreaterThanOrEqual(0)
    expect(ram.usedPercent).toBeLessThanOrEqual(100)
  })

  it('safely handles window metrics when no Electron windows are active', () => {
    const windows = getWindowMetrics()
    expect(typeof windows.total).toBe('number')
    expect(typeof windows.visible).toBe('number')
    expect(Array.isArray(windows.list)).toBe(true)
  })

  it('gathers all metrics in getSystemResourceMetrics with optional tag', () => {
    const metrics = getSystemResourceMetrics('test-tag')
    expect(metrics.tag).toBe('test-tag')
    expect(typeof metrics.timestamp).toBe('string')
    expect(metrics.processMemoryMB.rss).toBeGreaterThan(0)
    expect(metrics.systemRamMB.total).toBeGreaterThan(0)
  })

  it('logs system resources on demand and returns metrics', () => {
    const metrics = logSystemResources('manual')
    expect(metrics.tag).toBe('manual')
    expect(metrics.processMemoryMB.rss).toBeGreaterThan(0)
  })

  it('starts and stops resource probe interval cleanly', () => {
    const stopFn = startSystemResourceProbe(5000)
    expect(typeof stopFn).toBe('function')
    // Calling start again returns existing stop function
    const stopFn2 = startSystemResourceProbe(5000)
    expect(stopFn2).toBe(stopFn)

    stopFn()
  })
})
