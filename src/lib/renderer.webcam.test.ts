// @vitest-environment jsdom
import { describe, expect, it, vi, beforeAll } from 'vitest'
import { drawScene } from './renderer'
import { initialFrameState } from '../store/slices/frameSlice'
import { initialWebcamState } from '../store/slices/webcamSlice'
import { initialUIState } from '../store/slices/uiSlice'
import type { RenderableState } from '../types'

beforeAll(() => {
  if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4) }),
      fill: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      clip: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
    })
  }
  if (typeof globalThis.Path2D === 'undefined') {
    globalThis.Path2D = class Path2D {
      roundRect() {}
    } as unknown as typeof Path2D
  }
})

function createMockContext() {
  const calls: string[] = []
  const canvas = { width: 1920, height: 1080 } as HTMLCanvasElement
  const ctx = {
    canvas,
    save: vi.fn(() => calls.push('save')),
    restore: vi.fn(() => calls.push('restore')),
    beginPath: vi.fn(() => calls.push('beginPath')),
    arc: vi.fn(() => calls.push('arc')),
    fill: vi.fn(() => calls.push('fill')),
    stroke: vi.fn(() => calls.push('stroke')),
    clip: vi.fn(() => calls.push('clip')),
    rect: vi.fn(() => calls.push('rect')),
    roundRect: vi.fn(() => calls.push('roundRect')),
    drawImage: vi.fn((img: unknown) => calls.push(`drawImage(${(img as { __label?: string })?.__label || 'unknown'})`)),
    clearRect: vi.fn(() => calls.push('clearRect')),
    fillRect: vi.fn(() => calls.push('fillRect')),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
  } as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

describe('drawScene - webcam handling & fallback', () => {
  const baseState: RenderableState = {
    platform: 'linux',
    frameStyles: initialFrameState.frameStyles,
    aspectRatio: '16:9',
    cameraMotions: [],
    visualEffects: [],
    compositionLayouts: [],
    videoDimensions: { width: 1920, height: 1080 },
    recordingGeometry: { x: 0, y: 0, width: 1920, height: 1080 },
    webcamPosition: { pos: 'bottom-right' },
    webcamStyles: initialWebcamState.webcamStyles,
    isWebcamVisible: true,
    zoomRegions: {},
    cutRegions: {},
    speedRegions: {},
    videoClips: [],
    metadata: [],
    cursorImages: {},
    cursorBitmapsToRender: new Map(),
    cursorIconsToRender: new Map(),
    syncOffset: 0,
    cursorTheme: null,
    cursorStyles: initialUIState.cursorStyles,
  }

  const screenVideo = {
    __label: 'screen',
    videoWidth: 1920,
    videoHeight: 1080,
    currentTime: 2.0,
  } as unknown as HTMLVideoElement

  const webcamVideo = {
    __label: 'webcam',
    videoWidth: 1280,
    videoHeight: 720,
    currentTime: 2.0,
  } as unknown as HTMLVideoElement

  it('draws screen video and webcam video when webcam element is provided', async () => {
    const { ctx, calls } = createMockContext()

    await drawScene(ctx, baseState, screenVideo, webcamVideo, 2.0, 1920, 1080, null, [])

    expect(calls.some((c) => c.includes('drawImage(screen)'))).toBe(true)
    expect(calls.some((c) => c.includes('drawImage(webcam)'))).toBe(true)
  })

  it('draws screen video and gracefully omits webcam when webcam element is null', async () => {
    const { ctx, calls } = createMockContext()

    await drawScene(
      ctx,
      baseState,
      screenVideo,
      null, // No active webcam clip / gap in timeline
      2.0,
      1920,
      1080,
      null,
      [],
    )

    // Screen must be drawn
    expect(calls.some((c) => c.includes('drawImage(screen)'))).toBe(true)
    // Webcam drawImage must NOT be invoked
    expect(calls.some((c) => c.includes('drawImage(webcam)'))).toBe(false)
  })

  it('gracefully falls back to screen recording when presenter-focus layout is active but webcam is null', async () => {
    const { ctx, calls } = createMockContext()

    const presenterOnlyState: RenderableState = {
      ...baseState,
      compositionLayouts: [
        {
          id: 'layout-1',
          layout: 'presenter-focus',
          startTime: 1.0,
          duration: 5.0,
          transitionDuration: 0.3,
        },
      ],
    }

    await drawScene(
      ctx,
      presenterOnlyState,
      screenVideo,
      null, // Gap without webcam during presenter-focus region
      2.0,
      1920,
      1080,
      null,
      [],
    )

    // Screen video should still be painted, avoiding black frame
    expect(calls.some((c) => c.includes('drawImage(screen)'))).toBe(true)
    expect(calls.some((c) => c.includes('drawImage(webcam)'))).toBe(false)
  })
})
