// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  usePublish,
  extractExportProjectState,
  type ExportProjectState,
  type RenderExportSettings,
  type RenderPublishOptions,
  type PublishOutcome,
} from './usePublish'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null
let hookResult: ReturnType<typeof usePublish> | null = null

function TestHarness() {
  hookResult = usePublish()
  return null
}

describe('usePublish & renderAndPublish pipeline', () => {
  let exportProgressCb: ((payload: { progress: number; stage: string }) => void) | null = null
  let exportCompleteCb: ((payload: { success: boolean; error?: string }) => void) | null = null
  let publishProgressCb: ((payload: { stage: string; stagePercent: number; estimatedCost?: number }) => void) | null =
    null

  let mockGetTempPublishPath: ReturnType<typeof vi.fn>
  let mockSaveTempPublishFile: ReturnType<typeof vi.fn>
  let mockCleanupTempPublishFile: ReturnType<typeof vi.fn>
  let mockStartExport: ReturnType<typeof vi.fn>
  let mockCancelExport: ReturnType<typeof vi.fn>
  let mockStartPublish: ReturnType<typeof vi.fn>
  let mockCancelPublish: ReturnType<typeof vi.fn>
  let mockProbePublishFile: ReturnType<typeof vi.fn>
  let mockPublishStatus: ReturnType<typeof vi.fn>
  let mockListPublications: ReturnType<typeof vi.fn>
  let mockDeletePublication: ReturnType<typeof vi.fn>
  let mockPublicationAnalytics: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    hookResult = null

    exportProgressCb = null
    exportCompleteCb = null
    publishProgressCb = null

    mockGetTempPublishPath = vi.fn().mockResolvedValue('/tmp/demothat-publish-12345.mp4')
    mockSaveTempPublishFile = vi.fn().mockResolvedValue({ ok: true })
    mockCleanupTempPublishFile = vi.fn().mockResolvedValue(undefined)
    mockStartExport = vi.fn().mockResolvedValue(undefined)
    mockCancelExport = vi.fn()
    mockStartPublish = vi.fn().mockResolvedValue({
      ok: true,
      publication: {
        publicationId: 'pub-test-1',
        title: 'Test Video',
        kind: 'page',
        url: 'https://demo.that/p/pub-test-1',
        storageDays: 30,
        createdAt: '2026-11-20T12:00:00Z',
        expiresAt: '2026-12-20T12:00:00Z',
      },
      captionsIncluded: true,
    })
    mockCancelPublish = vi.fn()
    mockProbePublishFile = vi.fn().mockResolvedValue({ ok: true, sizeBytes: 15_000_000 })
    mockPublishStatus = vi.fn().mockResolvedValue({
      configured: true,
      pro: true,
      publishing: {
        minCredits: 10,
        creditsPerGbYear: 120,
        landingPageCredits: 50,
        maxSizeBytes: 500_000_000,
      },
      error: null,
    })
    mockListPublications = vi.fn().mockResolvedValue({
      ok: true,
      publications: [],
    })
    mockDeletePublication = vi.fn().mockResolvedValue({
      ok: true,
      creditsRefunded: 0,
      publication: { publicationId: 'pub-test-1' },
    })
    mockPublicationAnalytics = vi.fn().mockResolvedValue({
      ok: true,
      analytics: { views: 42, completes: 30, totalWatchTimeSeconds: 500 },
    })

    Object.defineProperty(window, 'electronAPI', {
      value: {
        getTempPublishPath: mockGetTempPublishPath,
        saveTempPublishFile: mockSaveTempPublishFile,
        cleanupTempPublishFile: mockCleanupTempPublishFile,
        startExport: mockStartExport,
        cancelExport: mockCancelExport,
        startPublish: mockStartPublish,
        cancelPublish: mockCancelPublish,
        probePublishFile: mockProbePublishFile,
        publishStatus: mockPublishStatus,
        listPublications: mockListPublications,
        deletePublication: mockDeletePublication,
        publicationAnalytics: mockPublicationAnalytics,
        onExportProgress: vi.fn((cb) => {
          exportProgressCb = cb
          return () => {
            exportProgressCb = null
          }
        }),
        onExportComplete: vi.fn((cb) => {
          exportCompleteCb = cb
          return () => {
            exportCompleteCb = null
          }
        }),
        onPublishProgress: vi.fn((cb) => {
          publishProgressCb = cb
          return () => {
            publishProgressCb = null
          }
        }),
      },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    container?.remove()
    container = null
    root = null
  })

  const renderHook = async () => {
    await act(async () => {
      root!.render(<TestHarness />)
    })
  }

  const sampleProjectState: ExportProjectState = {
    aspectRatio: '16:9',
    duration: 12.5,
    videoPath: '/path/to/source.mp4',
  }

  const sampleExportSettings: RenderExportSettings = {
    format: 'mp4',
    resolution: '1080p',
    fps: 30,
    quality: 'high',
  }

  const samplePublishOptions: RenderPublishOptions = {
    kind: 'page',
    storageDays: 30,
    title: 'Demo Showcase',
    cues: [{ id: 'cue-1', start: 0, end: 5, text: 'Hello world' }],
  }

  it('mounts and loads status and listens to publish progress', async () => {
    await renderHook()
    expect(mockPublishStatus).toHaveBeenCalled()
    expect(hookResult?.status?.pro).toBe(true)
    expect(hookResult?.status?.configured).toBe(true)
  })

  it('executes full renderAndPublish workflow (steps 1 to 6)', async () => {
    await renderHook()
    expect(hookResult).not.toBeNull()

    let resolvePublish: (val: PublishOutcome) => void = () => {}
    mockStartPublish.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePublish = resolve
        }),
    )

    let outcomePromise: Promise<PublishOutcome>
    act(() => {
      outcomePromise = hookResult!.renderAndPublish(sampleProjectState, sampleExportSettings, samplePublishOptions)
    })

    // Step 1: getTempPublishPath
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockGetTempPublishPath).toHaveBeenCalled()

    // Step 2: startExport called with temp path
    expect(mockStartExport).toHaveBeenCalledWith({
      projectState: sampleProjectState,
      exportSettings: sampleExportSettings,
      outputPath: '/tmp/demothat-publish-12345.mp4',
    })

    // Step 3: Tracks render progress via onExportProgress (scaled to 0-50% with dynamic status)
    act(() => {
      exportProgressCb?.({ progress: 45.4, stage: 'rendering' })
    })
    expect(hookResult!.progress).toEqual({
      stage: 'Compositing motion & cursor…',
      detail: 'Rendering zoom transitions, cursor movements, and click ripples…',
      stagePercent: 23,
    })

    // Render completes successfully
    act(() => {
      exportCompleteCb?.({ success: true })
    })

    await act(async () => {
      await Promise.resolve()
    })

    // Step 4: probe file size
    expect(mockProbePublishFile).toHaveBeenCalledWith('/tmp/demothat-publish-12345.mp4')

    // Step 5: startPublish with correct parameters
    expect(mockStartPublish).toHaveBeenCalledWith({
      filePath: '/tmp/demothat-publish-12345.mp4',
      kind: 'page',
      storageDays: 30,
      title: 'Demo Showcase',
      durationSec: 12.5,
      captions: samplePublishOptions.cues,
    })

    // Step 6: Tracks upload progress via onPublishProgress (scaled to 52-95% with dynamic status)
    act(() => {
      publishProgressCb?.({ stage: 'Uploading', stagePercent: 70, estimatedCost: 10 })
    })
    expect(hookResult!.progress).toEqual({
      stage: 'Uploading to cloud (70%)…',
      detail: 'Finalizing cloud chunk transfers…',
      stagePercent: 82,
      estimatedCost: 10,
    })

    act(() => {
      resolvePublish({
        ok: true,
        publication: {
          publicationId: 'pub-test-1',
          slug: 'pub-test-1',
          title: 'Test Video',
          status: 'active',
          kind: 'page',
          storageDays: 30,
          createdAt: '2026-11-20T12:00:00Z',
          expiresAt: '2026-12-20T12:00:00Z',
          sizeBytes: 15_000_000,
          served: { page: true, embed: false, links: false },
          estimatedCost: 10,
          hasCaptions: true,
          links: {
            pageUrl: 'https://demo.that/p/pub-test-1',
            videoDownloadUrl: 'https://demo.that/p/pub-test-1.mp4',
          },
        },
        captionsIncluded: true,
      })
    })

    const outcome = await act(async () => await outcomePromise)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.publication.publicationId).toBe('pub-test-1')
    }

    // Temp path is retained for saving copy
    expect(hookResult!.tempRenderPath).toBe('/tmp/demothat-publish-12345.mp4')
  })

  it('supports single-object argument for renderAndPublish', async () => {
    await renderHook()

    let outcomePromise: Promise<PublishOutcome>
    act(() => {
      outcomePromise = hookResult!.renderAndPublish({
        projectState: sampleProjectState,
        exportSettings: sampleExportSettings,
        publishOptions: samplePublishOptions,
      })
    })

    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      exportCompleteCb?.({ success: true })
    })

    const outcome = await act(async () => await outcomePromise)
    expect(outcome.ok).toBe(true)
  })

  it('passes cloud parameter to startExport when cloud: true is requested', async () => {
    await renderHook()

    let outcomePromise: Promise<PublishOutcome>
    act(() => {
      outcomePromise = hookResult!.renderAndPublish({
        projectState: sampleProjectState,
        exportSettings: sampleExportSettings,
        publishOptions: samplePublishOptions,
        cloud: true,
      })
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mockStartExport).toHaveBeenCalledWith({
      projectState: sampleProjectState,
      exportSettings: sampleExportSettings,
      outputPath: '/tmp/demothat-publish-12345.mp4',
      cloud: {},
    })

    act(() => {
      exportCompleteCb?.({ success: true })
    })

    const outcome = await act(async () => await outcomePromise)
    expect(outcome.ok).toBe(true)
  })

  it('saves rendered copy via saveRenderedCopy helper', async () => {
    await renderHook()

    // Run export & publish first
    let outcomePromise: Promise<PublishOutcome>
    act(() => {
      outcomePromise = hookResult!.renderAndPublish(sampleProjectState, sampleExportSettings, samplePublishOptions)
    })
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      exportCompleteCb?.({ success: true })
    })
    await act(async () => {
      await outcomePromise
    })

    // Now save copy
    let saveResult: { ok: boolean; error?: string } | undefined
    await act(async () => {
      saveResult = await hookResult!.saveRenderedCopy('/home/user/Videos/my-demo.mp4')
    })

    expect(mockSaveTempPublishFile).toHaveBeenCalledWith(
      '/tmp/demothat-publish-12345.mp4',
      '/home/user/Videos/my-demo.mp4',
    )
    expect(saveResult?.ok).toBe(true)
  })

  it('returns error when saveRenderedCopy is called without a rendered copy', async () => {
    await renderHook()
    const result = await hookResult!.saveRenderedCopy('/some/dest.mp4')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('No rendered video available')
  })

  it('cleans up temp render file via cleanupTempRender helper', async () => {
    await renderHook()

    let outcomePromise: Promise<PublishOutcome>
    act(() => {
      outcomePromise = hookResult!.renderAndPublish(sampleProjectState, sampleExportSettings, samplePublishOptions)
    })
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      exportCompleteCb?.({ success: true })
    })
    await act(async () => {
      await outcomePromise
    })

    expect(hookResult!.tempRenderPath).toBe('/tmp/demothat-publish-12345.mp4')

    await act(async () => {
      await hookResult!.cleanupTempRender()
    })

    expect(mockCleanupTempPublishFile).toHaveBeenCalledWith('/tmp/demothat-publish-12345.mp4')
    expect(hookResult!.tempRenderPath).toBeNull()
  })

  it('cancels export when cancel() is triggered during rendering phase', async () => {
    await renderHook()

    let outcomePromise: Promise<PublishOutcome>
    act(() => {
      outcomePromise = hookResult!.renderAndPublish(sampleProjectState, sampleExportSettings, samplePublishOptions)
    })

    await act(async () => {
      await Promise.resolve()
    })

    // Trigger cancel while rendering
    act(() => {
      hookResult!.cancel()
    })
    expect(mockCancelExport).toHaveBeenCalled()

    // Export completes with cancel notification
    act(() => {
      exportCompleteCb?.({ success: false, error: 'Export was canceled' })
    })

    const outcome = await act(async () => await outcomePromise)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.reason).toBe('canceled')
    }
    expect(mockCleanupTempPublishFile).toHaveBeenCalledWith('/tmp/demothat-publish-12345.mp4')
  })

  it('cancels publish when cancel() is triggered during upload phase', async () => {
    mockStartPublish.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                ok: false,
                reason: 'canceled',
                error: 'Upload canceled',
              }),
            10,
          )
        }),
    )

    await renderHook()

    let outcomePromise: Promise<PublishOutcome>
    act(() => {
      outcomePromise = hookResult!.renderAndPublish(sampleProjectState, sampleExportSettings, samplePublishOptions)
    })

    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      exportCompleteCb?.({ success: true })
    })

    await act(async () => {
      await Promise.resolve()
    })

    // Now in publishing phase
    act(() => {
      hookResult!.cancel()
    })
    expect(mockCancelPublish).toHaveBeenCalled()

    const outcome = await act(async () => await outcomePromise)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.reason).toBe('canceled')
    }
  })

  it('handles probe failure gracefully', async () => {
    mockProbePublishFile.mockResolvedValue({ ok: false, error: 'File unreadable' })
    await renderHook()

    let outcomePromise: Promise<PublishOutcome>
    act(() => {
      outcomePromise = hookResult!.renderAndPublish(sampleProjectState, sampleExportSettings, samplePublishOptions)
    })

    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      exportCompleteCb?.({ success: true })
    })

    const outcome = await act(async () => await outcomePromise)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.reason).toBe('failed')
      expect(outcome.error).toContain('File unreadable')
    }
    expect(mockCleanupTempPublishFile).toHaveBeenCalledWith('/tmp/demothat-publish-12345.mp4')
  })

  it('retains existing methods: loadList, remove, analytics, start', async () => {
    mockListPublications.mockResolvedValue({
      ok: true,
      publications: [
        {
          publicationId: 'pub-existing-1',
          title: 'Existing',
          kind: 'links',
          storageDays: 7,
          createdAt: '2026-11-19T00:00:00Z',
          expiresAt: '2026-11-26T00:00:00Z',
        },
      ],
    })

    await renderHook()

    await act(async () => {
      const listRes = await hookResult!.loadList()
      expect(listRes.ok).toBe(true)
    })
    expect(hookResult!.publications).toHaveLength(1)

    await act(async () => {
      const delRes = await hookResult!.remove('pub-existing-1')
      expect(delRes.ok).toBe(true)
    })
    expect(hookResult!.publications).toHaveLength(0)

    let analyticsRes: { ok: boolean } | undefined
    await act(async () => {
      analyticsRes = await hookResult!.analytics('pub-existing-1', '30d')
    })
    expect(analyticsRes?.ok).toBe(true)

    // Direct start()
    let startRes: PublishOutcome | undefined
    await act(async () => {
      startRes = await hookResult!.start({
        filePath: '/direct/path.mp4',
        kind: 'embed',
        storageDays: 90,
      })
    })
    expect(startRes?.ok).toBe(true)
  })

  it('extractExportProjectState safely maps store fields', () => {
    const rawState = {
      platform: 'linux',
      videoPath: '/video/source.mp4',
      duration: 33.7,
      aspectRatio: '16:9',
      mouseClickSoundsEnabled: true,
      mouseClickSoundPath: '/sounds/click.wav',
      hasAudioTrack: true,
      subtitlesEnabled: true,
      subtitleFormat: 'vtt',
      unknownExtraField: 'ignored-or-preserved',
    }

    const extracted = extractExportProjectState(rawState)
    expect(extracted.duration).toBe(33.7)
    expect(extracted.aspectRatio).toBe('16:9')
    expect(extracted.mouseClickSoundsEnabled).toBe(true)
    expect(extracted.mouseClickSoundPath).toBe('/sounds/click.wav')
    expect(extracted.subtitlesEnabled).toBe(true)
    expect(extracted.subtitleFormat).toBe('vtt')
  })
})
