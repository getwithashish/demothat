// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { Timeline } from './Timeline'
import { useEditorStore } from '../../store/editorStore'
import type { RecordingSegment } from '../../types'

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

describe('Timeline recording segments and reordering', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      value: {
        onAIChunk: vi.fn(() => () => {}),
        aiChat: vi.fn().mockResolvedValue(undefined),
        aiCancel: vi.fn(),
        aiApproveTool: vi.fn(),
        reorderRecordings: vi.fn().mockResolvedValue({
          screenVideoPath: '/test/spliced.mp4',
          metadataPath: '/test/spliced.json',
          addedDuration: 0,
        }),
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
      useEditorStore.getState().resetProjectState()
    })
  })

  afterEach(() => {
    if (root) {
      act(() => {
        root!.unmount()
      })
      root = null
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container)
      container = null
    }
  })

  it('renders distinct recording segment cards with labels, duration badges, and divider seams', async () => {
    const seg1: RecordingSegment = {
      id: 'rec-1',
      name: 'Recording 1',
      startTime: 0,
      duration: 5.0,
      sourceVideoPath: '/path/1.mp4',
      sourceStartTime: 0,
    }
    const seg2: RecordingSegment = {
      id: 'rec-2',
      name: 'Recording 2',
      startTime: 5.0,
      duration: 4.0,
      sourceVideoPath: '/path/2.mp4',
      sourceStartTime: 0,
    }

    act(() => {
      useEditorStore.setState({
        videoPath: '/test/spliced.mp4',
        duration: 9.0,
        timelineZoom: 1,
        recordingSegments: [seg1, seg2],
        audioTracks: [{ id: 'audio-1', label: 'Recorded audio', volume: 1, muted: false, kind: 'system', index: 0 }],
      })
    })

    const el = await renderAsync(<Timeline videoRef={{ current: null }} />)

    // Verify both recording cards are rendered
    const card1 = el.querySelector('[data-recording-id="rec-1"]')
    const card2 = el.querySelector('[data-recording-id="rec-2"]')
    expect(card1).not.toBeNull()
    expect(card2).not.toBeNull()
    expect(card1?.textContent).toContain('Recording 1')
    expect(card2?.textContent).toContain('Recording 2')

    // Verify seam divider in recorded audio track is rendered
    const seam = el.querySelector('[aria-hidden="true"].border-line\\/60')
    expect(seam).not.toBeNull()
  })

  it('selects a recording segment on click and sets selectedRecordingId', async () => {
    const seg1: RecordingSegment = {
      id: 'rec-1',
      name: 'Recording 1',
      startTime: 0,
      duration: 5.0,
      sourceVideoPath: '/path/1.mp4',
      sourceStartTime: 0,
    }
    const seg2: RecordingSegment = {
      id: 'rec-2',
      name: 'Recording 2',
      startTime: 5.0,
      duration: 4.0,
      sourceVideoPath: '/path/2.mp4',
      sourceStartTime: 0,
    }

    act(() => {
      useEditorStore.setState({
        videoPath: '/test/spliced.mp4',
        duration: 9.0,
        timelineZoom: 1,
        recordingSegments: [seg1, seg2],
        audioTracks: [],
      })
    })

    const el = await renderAsync(<Timeline videoRef={{ current: null }} />)
    const card2 = el.querySelector('[data-recording-id="rec-2"]') as HTMLElement
    expect(card2).not.toBeNull()

    // Trigger click on recording card
    act(() => {
      card2.click()
    })

    expect(useEditorStore.getState().selectedRecordingId).toBe('rec-2')
    expect(useEditorStore.getState().currentTime).toBe(5.0)
  })
})
