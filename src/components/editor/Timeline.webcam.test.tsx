// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { Timeline } from './Timeline'
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

describe('Timeline - Webcam Track', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      value: {
        onAIChunk: vi.fn(() => () => {}),
        aiChat: vi.fn().mockResolvedValue(undefined),
        aiCancel: vi.fn(),
        aiApproveTool: vi.fn(),
        openVideoFiles: vi.fn().mockResolvedValue({ canceled: true }),
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
        duration: 20,
        timelineZoom: 1,
        audioTracks: [{ id: 'audio-1', label: 'Microphone', volume: 1, muted: false, kind: 'mic', index: 0 }],
        subtitleCues: [],
        videoClips: [],
        webcamClips: [
          {
            id: 'webcam-clip-1',
            name: 'Presenter Feed',
            filePath: '/test/webcam.mp4',
            startTime: 2.0,
            duration: 8.0,
            sourceStart: 0,
            sourceDuration: 10.0,
          },
        ],
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
      act(() => {
        root!.unmount()
      })
      root = null
    }
    if (container) {
      container.remove()
      container = null
    }
  })

  it('renders the Webcam lane and its track header with an add feed button', async () => {
    const videoRef = { current: document.createElement('video') }
    const el = await renderAsync(<Timeline videoRef={videoRef} />)

    // Verify track label appears in the header column
    expect(el.textContent).toContain('Webcam')

    // Verify "+ Add webcam feed" button is rendered
    const addBtn = el.querySelector('button[aria-label="Add webcam feed"]')
    expect(addBtn).not.toBeNull()

    // Clicking add button invokes openVideoFiles IPC
    await act(async () => {
      addBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(window.electronAPI.openVideoFiles).toHaveBeenCalled()
  })

  it('renders active webcam clips on the lane with name and trim handles', async () => {
    const videoRef = { current: document.createElement('video') }
    const el = await renderAsync(<Timeline videoRef={videoRef} />)

    // The webcam clip should be visible with its name
    const clipEl = el.querySelector('[data-region-id="webcam-clip-1"]')
    expect(clipEl).not.toBeNull()
    expect(clipEl?.textContent).toContain('Presenter Feed')

    // Trim handles
    const leftEdge = clipEl?.querySelector('[data-webcam-edge="left"]')
    const rightEdge = clipEl?.querySelector('[data-webcam-edge="right"]')
    expect(leftEdge).not.toBeNull()
    expect(rightEdge).not.toBeNull()
  })
})
