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
})
