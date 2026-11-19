// Gathers and logs system resource usage (CPU, memory, RAM, active windows).

import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import os from 'node:os'
import process from 'node:process'

export interface WindowMetric {
  id: number
  title: string
  focused: boolean
  visible: boolean
  minimized: boolean
}

export interface SystemResourceMetrics {
  timestamp: string
  tag?: string
  cpu: {
    percent?: number
    userMicroseconds: number
    systemMicroseconds: number
    loadAverage1m: number
  }
  processMemoryMB: {
    rss: number
    heapTotal: number
    heapUsed: number
    external: number
  }
  systemRamMB: {
    total: number
    free: number
    used: number
    usedPercent: number
  }
  windows: {
    total: number
    visible: number
    list: WindowMetric[]
  }
}

let lastCpuSample: { time: number; usage: NodeJS.CpuUsage } | null = null

export function resetCpuSampleForTesting(): void {
  lastCpuSample = null
}

export function getCpuMetrics(): {
  percent?: number
  userMicroseconds: number
  systemMicroseconds: number
  loadAverage1m: number
} {
  const currentUsage = process.cpuUsage()
  const now = Date.now()
  let percent: number | undefined

  if (lastCpuSample) {
    const elapsedMs = now - lastCpuSample.time
    if (elapsedMs > 0) {
      const userDiff = currentUsage.user - lastCpuSample.usage.user
      const sysDiff = currentUsage.system - lastCpuSample.usage.system
      const totalDiffMs = (userDiff + sysDiff) / 1000
      const cpus = os.cpus()?.length || 1
      percent = Math.min(100, Math.max(0, +((totalDiffMs / (elapsedMs * cpus)) * 100).toFixed(1)))
    }
  }
  lastCpuSample = { time: now, usage: currentUsage }

  const loadAvg = os.loadavg()
  return {
    percent,
    userMicroseconds: currentUsage.user,
    systemMicroseconds: currentUsage.system,
    loadAverage1m: +(loadAvg[0] ?? 0).toFixed(2),
  }
}

export function getMemoryMetrics(): {
  rss: number
  heapTotal: number
  heapUsed: number
  external: number
} {
  const mem = process.memoryUsage()
  const toMB = (bytes: number) => +(bytes / (1024 * 1024)).toFixed(2)
  return {
    rss: toMB(mem.rss),
    heapTotal: toMB(mem.heapTotal),
    heapUsed: toMB(mem.heapUsed),
    external: toMB(mem.external),
  }
}

export function getRamMetrics(): {
  total: number
  free: number
  used: number
  usedPercent: number
} {
  const totalBytes = os.totalmem()
  const freeBytes = os.freemem()
  const usedBytes = Math.max(0, totalBytes - freeBytes)
  const toMB = (bytes: number) => +(bytes / (1024 * 1024)).toFixed(2)

  const total = toMB(totalBytes)
  const free = toMB(freeBytes)
  const used = toMB(usedBytes)
  const usedPercent = totalBytes > 0 ? +((usedBytes / totalBytes) * 100).toFixed(1) : 0

  return {
    total,
    free,
    used,
    usedPercent,
  }
}

export function getWindowMetrics(): {
  total: number
  visible: number
  list: WindowMetric[]
} {
  try {
    const windows =
      typeof BrowserWindow !== 'undefined' && typeof BrowserWindow.getAllWindows === 'function'
        ? BrowserWindow.getAllWindows()
        : []

    const list: WindowMetric[] = []
    let visibleCount = 0

    for (const w of windows) {
      try {
        const visible = w.isVisible()
        if (visible) visibleCount++
        list.push({
          id: w.id,
          title: w.getTitle() || '(untitled)',
          focused: w.isFocused(),
          visible,
          minimized: w.isMinimized(),
        })
      } catch {
        list.push({
          id: w.id,
          title: '(destroyed)',
          focused: false,
          visible: false,
          minimized: false,
        })
      }
    }

    return {
      total: windows.length,
      visible: visibleCount,
      list,
    }
  } catch {
    return { total: 0, visible: 0, list: [] }
  }
}

export function getSystemResourceMetrics(tag?: string): SystemResourceMetrics {
  return {
    timestamp: new Date().toISOString(),
    tag,
    cpu: getCpuMetrics(),
    processMemoryMB: getMemoryMetrics(),
    systemRamMB: getRamMetrics(),
    windows: getWindowMetrics(),
  }
}

const probeLogger = log.scope('resource-probe')

export function logSystemResources(tag?: string): SystemResourceMetrics {
  const metrics = getSystemResourceMetrics(tag)
  const tagPrefix = tag ? `[${tag}] ` : ''
  const cpuText = metrics.cpu.percent !== undefined ? `${metrics.cpu.percent}%` : 'calibrating'

  probeLogger.debug(
    `${tagPrefix}CPU: ${cpuText} (load1m: ${metrics.cpu.loadAverage1m}), ` +
      `RSS: ${metrics.processMemoryMB.rss}MB, ` +
      `Heap: ${metrics.processMemoryMB.heapUsed}/${metrics.processMemoryMB.heapTotal}MB, ` +
      `RAM: ${metrics.systemRamMB.used}/${metrics.systemRamMB.total}MB (${metrics.systemRamMB.usedPercent}%), ` +
      `Windows: ${metrics.windows.total} (visible: ${metrics.windows.visible})`,
    metrics,
  )

  return metrics
}

let probeInterval: NodeJS.Timeout | null = null

export function startSystemResourceProbe(intervalMs = 10000): () => void {
  if (probeInterval) {
    return stopSystemResourceProbe
  }

  // Initial immediate sample to calibrate CPU diff baseline
  logSystemResources('startup')

  probeInterval = setInterval(() => {
    logSystemResources('interval')
  }, intervalMs)

  if (typeof probeInterval.unref === 'function') {
    probeInterval.unref()
  }

  return stopSystemResourceProbe
}

export function stopSystemResourceProbe(): void {
  if (probeInterval) {
    clearInterval(probeInterval)
    probeInterval = null
  }
}
