// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useExportProcess, type ExportResult } from './useExportProcess'
import { useEditorStore } from '../store/editorStore'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null
let hookResult: ReturnType<typeof useExportProcess> | null = null

function TestHarness() {
  hookResult = useExportProcess()
  return null
}

describe('useExportProcess', () => {
  let progressCb: ((payload: { progress: number; stage?: string; stagePercent?: number }) => void) | null = null
  let completeCb: ((payload: ExportResult) => void) | null = null

  let mockStartExport: ReturnType<typeof vi.fn>
  let mockCancelExport: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    hookResult = null

    progressCb = null
    completeCb = null

    mockStartExport = vi.fn().mockResolvedValue(undefined)
    mockCancelExport = vi.fn()

    Object.defineProperty(window, 'electronAPI', {
      value: {
        onExportProgress: vi.fn((cb) => {
          progressCb = cb
          return vi.fn()
        }),
        onExportComplete: vi.fn((cb) => {
          completeCb = cb
          return vi.fn()
        }),
        getActiveCloudJob: vi.fn().mockResolvedValue(null),
        startExport: mockStartExport,
        cancelExport: mockCancelExport,
        cancelCloudRetry: vi.fn(),
        cloudRetry: vi.fn().mockResolvedValue(undefined),
        cloudFallback: vi.fn().mockResolvedValue(undefined),
        resumeCloudWatch: vi.fn().mockResolvedValue(undefined),
        forgetCloudJob: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it('ignores onExportProgress and onExportComplete when export was not initiated by useExportProcess (preventing crosstalk with publish)', async () => {
    await act(async () => {
      root!.render(<TestHarness />)
    })

    expect(hookResult?.isExporting).toBe(false)
    expect(hookResult?.progress).toBe(0)
    expect(hookResult?.result).toBeNull()

    // Simulate IPC event fired by usePublish or another caller
    await act(async () => {
      progressCb?.({ progress: 50, stage: 'Rendering' })
    })

    // hookResult should NOT be mutated
    expect(hookResult?.progress).toBe(0)
    expect(hookResult?.stage).toBeNull()

    // Simulate completion event fired by usePublish rendering an intermediate file
    await act(async () => {
      completeCb?.({ success: true, outputPath: '/tmp/demothat-publish-temp.mp4' })
    })

    // hookResult should NOT have captured this result
    expect(hookResult?.result).toBeNull()
    expect(hookResult?.isExporting).toBe(false)
  })

  it('captures progress and completion when startExport is called through useExportProcess', async () => {
    await act(async () => {
      root!.render(<TestHarness />)
    })

    await act(async () => {
      void hookResult?.startExport(
        { format: 'mp4', resolution: '1080p', fps: 30, quality: 'high' },
        '/home/user/output.mp4',
      )
    })

    expect(hookResult?.isExporting).toBe(true)
    expect(mockStartExport).toHaveBeenCalled()

    // Now progress events SHOULD be captured
    await act(async () => {
      progressCb?.({ progress: 42, stage: 'Rendering frames' })
    })

    expect(hookResult?.progress).toBe(42)
    expect(hookResult?.stage).toBe('Rendering frames')

    // Completion should be captured
    await act(async () => {
      completeCb?.({ success: true, outputPath: '/home/user/output.mp4' })
    })

    expect(hookResult?.isExporting).toBe(false)
    expect(hookResult?.progress).toBe(100)
    expect(hookResult?.result).toEqual({ success: true, outputPath: '/home/user/output.mp4' })

    // Subsequent events after completion should be ignored
    await act(async () => {
      completeCb?.({ success: true, outputPath: '/tmp/another-temp.mp4' })
    })
    expect(hookResult?.result?.outputPath).toBe('/home/user/output.mp4')
  })

  it('clears result when clearResult is invoked', async () => {
    await act(async () => {
      root!.render(<TestHarness />)
    })

    await act(async () => {
      void hookResult?.startExport(
        { format: 'mp4', resolution: '1080p', fps: 30, quality: 'high' },
        '/home/user/output.mp4',
      )
    })

    await act(async () => {
      completeCb?.({ success: true, outputPath: '/home/user/output.mp4' })
    })

    expect(hookResult?.result).not.toBeNull()

    act(() => {
      hookResult?.clearResult()
    })

    expect(hookResult?.result).toBeNull()
  })

  it('pushes a toast when a local export completes successfully', async () => {
    useEditorStore.setState({ toasts: [] })

    await act(async () => {
      root!.render(<TestHarness />)
    })

    await act(async () => {
      void hookResult?.startExport(
        { format: 'mp4', resolution: '1080p', fps: 30, quality: 'high' },
        '/home/user/output.mp4',
      )
    })

    await act(async () => {
      completeCb?.({ success: true, outputPath: '/home/user/output.mp4' })
    })

    const toasts = useEditorStore.getState().toasts
    expect(toasts.some((t) => t.message === 'Export completed successfully.')).toBe(true)
    const completedToast = toasts.find((t) => t.message === 'Export completed successfully.')
    expect(completedToast?.actionLabel).toBe('Open')
    expect(completedToast?.revealPath).toBe('/home/user/output.mp4')
  })

  it('auto-triggers resumeCloudWatch silently on mount when an active cloud job is found', async () => {
    ;(window.electronAPI.getActiveCloudJob as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      jobId: 'job-active-123',
      outputPath: '/home/user/recovered.mp4',
    })

    await act(async () => {
      root!.render(<TestHarness />)
    })

    expect(window.electronAPI.getActiveCloudJob).toHaveBeenCalled()
    expect(window.electronAPI.resumeCloudWatch).toHaveBeenCalled()
    expect(hookResult?.isExporting).toBe(true)
    expect(hookResult?.isAutoResumed).toBe(true)
  })

  it('exposes recoveredJobError when an auto-recovered cloud job fails or is rejected on the server', async () => {
    ;(window.electronAPI.getActiveCloudJob as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      jobId: 'job-active-123',
      outputPath: '/home/user/recovered.mp4',
    })

    await act(async () => {
      root!.render(<TestHarness />)
    })

    expect(hookResult?.isAutoResumed).toBe(true)

    // Simulate server rejecting/failing the job
    await act(async () => {
      completeCb?.({
        success: false,
        error: 'Job rejected: insufficient compute credits',
        cloudReason: 'insufficient_credits',
      })
    })

    expect(hookResult?.result?.success).toBe(false)
    expect(hookResult?.recoveredJobError).toEqual({
      success: false,
      error: 'Job rejected: insufficient compute credits',
      cloudReason: 'insufficient_credits',
    })
  })

  it('includes actionLabel and revealPath in toast when cloud upscale finishes successfully', async () => {
    useEditorStore.setState({ toasts: [] })

    await act(async () => {
      root!.render(<TestHarness />)
    })

    await act(async () => {
      void hookResult?.startExport(
        { format: 'mp4', resolution: '4k', fps: 60, quality: 'high' },
        '/home/user/upscaled.mp4',
        { cloud: true },
      )
    })

    await act(async () => {
      completeCb?.({
        success: true,
        outputPath: '/home/user/upscaled.mp4',
        charge: 120,
      })
    })

    const toasts = useEditorStore.getState().toasts
    const cloudToast = toasts.find((t) => t.message.includes('Cloud upscale finished'))
    expect(cloudToast).toBeDefined()
    expect(cloudToast?.actionLabel).toBe('Open')
    expect(cloudToast?.revealPath).toBe('/home/user/upscaled.mp4')
  })
})
