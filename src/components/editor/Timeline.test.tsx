// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { Timeline } from './Timeline'
import {
  calculateFittedTimelineHeight,
  ROW_HEIGHT,
  RULER_HEIGHT,
  RESIZE_HANDLE_HEIGHT,
  TIMELINE_SCROLLBAR_GUTTER,
} from './timeline/timeline-geometry'
import { useEditorStore } from '../../store/editorStore'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

async function renderAsync(node: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(node)
    await Promise.resolve()
  })
  return container
}

describe('Timeline default height & geometry', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      value: {
        onAIChunk: vi.fn(() => () => {}),
        aiChat: vi.fn().mockResolvedValue(undefined),
        aiCancel: vi.fn(),
        aiApproveTool: vi.fn(),
      },
      configurable: true,
      writable: true,
    })

    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof globalThis.ResizeObserver

    act(() => {
      useEditorStore.setState({
        videoPath: '/test/video.mp4',
        duration: 10,
        timelineZoom: 1,
        audioTracks: [{ id: 'audio-1', label: 'Recorded audio', volume: 1, muted: false, kind: 'system', index: 0 }],
        subtitleCues: [],
        videoClips: [],
        zoomRegions: {},
        cutRegions: {},
        speedRegions: {},
        visualEffects: [],
        compositionLayouts: [],
        cameraMotions: [],
      })
    })
  })

  afterEach(() => {
    if (root) {
      act(() => root!.unmount())
      root = null
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container)
      container = null
    }
    vi.restoreAllMocks()
  })

  it('calculates fitted height without empty space below the bottom masking track', () => {
    // 8 default tracks: Screen, Recorded audio, Music, Clicks, Camera, Zoom, Layout, Masking = 8 * 34 = 272px
    const trackHeight = 8 * ROW_HEIGHT
    expect(ROW_HEIGHT).toBe(34)
    expect(RULER_HEIGHT).toBe(22)
    expect(RESIZE_HANDLE_HEIGHT).toBe(16)
    expect(TIMELINE_SCROLLBAR_GUTTER).toBe(8)

    const expectedHeight = RESIZE_HANDLE_HEIGHT + RULER_HEIGHT + trackHeight + TIMELINE_SCROLLBAR_GUTTER
    expect(expectedHeight).toBe(318)
    expect(calculateFittedTimelineHeight(trackHeight)).toBe(318)
  })

  it('renders Timeline with default fitted height matching track rows', async () => {
    const videoRef = { current: document.createElement('video') }
    const dom = await renderAsync(<Timeline videoRef={videoRef} />)

    const timelineContainer = dom.querySelector('[role="separator"]')?.parentElement as HTMLElement
    expect(timelineContainer).not.toBeNull()

    // 8 default tracks = 272px -> fitted height = 318px (not the old 464px)
    expect(timelineContainer.style.height).toBe('318px')
  })

  it('resizes when dragging the separator handle and resets on double-click', async () => {
    const videoRef = { current: document.createElement('video') }
    const dom = await renderAsync(<Timeline videoRef={videoRef} />)

    const separator = dom.querySelector('[role="separator"]') as HTMLElement
    const timelineContainer = separator.parentElement as HTMLElement
    expect(timelineContainer.style.height).toBe('318px')

    // Drag upwards by 50px
    act(() => {
      separator.dispatchEvent(new MouseEvent('mousedown', { clientY: 500, bubbles: true }))
      window.dispatchEvent(new MouseEvent('mousemove', { clientY: 450, bubbles: true }))
      window.dispatchEvent(new MouseEvent('mouseup', { clientY: 450, bubbles: true }))
    })

    // Height should have increased by 50px (318 + 50 = 368px)
    expect(timelineContainer.style.height).toBe('368px')

    // Double clicking separator snaps back to fitted default height
    act(() => {
      separator.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })

    expect(timelineContainer.style.height).toBe('318px')
  })

  it('resets custom height back to default fit when loading a different video', async () => {
    const videoRef = { current: document.createElement('video') }
    const dom = await renderAsync(<Timeline videoRef={videoRef} />)

    const separator = dom.querySelector('[role="separator"]') as HTMLElement
    const timelineContainer = separator.parentElement as HTMLElement
    expect(timelineContainer.style.height).toBe('318px')

    // Drag resize
    act(() => {
      separator.dispatchEvent(new MouseEvent('mousedown', { clientY: 500, bubbles: true }))
      window.dispatchEvent(new MouseEvent('mousemove', { clientY: 400, bubbles: true }))
      window.dispatchEvent(new MouseEvent('mouseup', { clientY: 400, bubbles: true }))
    })
    expect(timelineContainer.style.height).toBe('418px')

    // Load new video path
    await act(async () => {
      useEditorStore.setState({ videoPath: '/test/another-video.mp4' })
    })

    // Should reset to fitted default height
    expect(timelineContainer.style.height).toBe('318px')
  })
})
