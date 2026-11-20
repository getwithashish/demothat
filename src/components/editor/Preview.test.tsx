// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { Preview } from './Preview'
import { useEditorStore } from '../../store/editorStore'
import { virtualStudioStreamer } from '../../features/virtual-studio'

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

describe('Preview Virtual Studio canvas attachment', () => {
  beforeEach(() => {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof globalThis.ResizeObserver

    vi.spyOn(virtualStudioStreamer, 'attachCanvas')
    vi.spyOn(virtualStudioStreamer, 'detachCanvas')
    vi.spyOn(virtualStudioStreamer, 'attachVideoElement')
    vi.spyOn(virtualStudioStreamer, 'detachVideoElement')

    act(() => {
      useEditorStore.setState({
        videoUrl: 'blob:test-video',
        videoDimensions: { width: 1920, height: 1080 },
        duration: 10,
        aspectRatio: '16:9',
      })
    })
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    container?.remove()
    container = null
    root = null
    vi.restoreAllMocks()
  })

  it('attaches canvas to virtualStudioStreamer via callback ref on mount', async () => {
    const videoRef = { current: document.createElement('video') }
    const el = await renderAsync(<Preview videoRef={videoRef} onSeekFrame={vi.fn()} />)

    const canvas = el.querySelector('canvas')
    expect(canvas).not.toBeNull()
    expect(virtualStudioStreamer.attachCanvas).toHaveBeenCalledWith(canvas)
  })

  it('detaches canvas from virtualStudioStreamer on unmount', async () => {
    const videoRef = { current: document.createElement('video') }
    await renderAsync(<Preview videoRef={videoRef} onSeekFrame={vi.fn()} />)

    act(() => {
      root?.unmount()
    })

    expect(virtualStudioStreamer.detachCanvas).toHaveBeenCalled()
  })

  it('updates canvas size when isVirtualStudioActive is toggled', async () => {
    const videoRef = { current: document.createElement('video') }
    const el = await renderAsync(<Preview videoRef={videoRef} onSeekFrame={vi.fn()} />)

    act(() => {
      useEditorStore.setState({ isVirtualStudioActive: true })
    })

    const canvas = el.querySelector('canvas')
    expect(canvas).not.toBeNull()
  })

  it('decouples canvas rendering from requestAnimationFrame and uses setTimeout loop when isVirtualStudioActive is true', async () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')

    const videoRef = { current: document.createElement('video') }
    await renderAsync(<Preview videoRef={videoRef} onSeekFrame={vi.fn()} />)

    setTimeoutSpy.mockClear()

    act(() => {
      useEditorStore.setState({ isVirtualStudioActive: true, isPlaying: true })
    })

    // In virtual studio active playback, setTimeout should be used instead of requestAnimationFrame for the render loop
    expect(setTimeoutSpy).toHaveBeenCalled()
  })

  it('sets up periodic playback FPS telemetry interval during playback', async () => {
    act(() => {
      useEditorStore.setState({ isPlaying: false })
    })

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const videoRef = { current: document.createElement('video') }

    await renderAsync(<Preview videoRef={videoRef} onSeekFrame={vi.fn()} />)

    setIntervalSpy.mockClear()

    act(() => {
      useEditorStore.setState({ isPlaying: true })
    })

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 3500)
    setIntervalSpy.mockRestore()
  })

  it('synchronizes webcam video element time when seeking while paused with lip sync offset', async () => {
    act(() => {
      useEditorStore.setState({
        isPlaying: false,
        currentTime: 0,
        webcamVideoUrl: 'blob:test-webcam',
        avSyncOffsetMs: 250,
        syncOffset: 250,
      })
    })

    const videoRef = { current: document.createElement('video') }
    const el = await renderAsync(<Preview videoRef={videoRef} onSeekFrame={vi.fn()} />)

    const webcamVideo = el.querySelector<HTMLVideoElement>('video[src="blob:test-webcam"]')
    expect(webcamVideo).not.toBeNull()

    // Simulate timeline scrub to 2.0s
    act(() => {
      videoRef.current.currentTime = 2.0
      useEditorStore.setState({ currentTime: 2.0 })
    })

    // Target webcam time = 2.0 - 0.25 = 1.75s
    expect(webcamVideo!.currentTime).toBeCloseTo(1.75, 2)
  })
})
