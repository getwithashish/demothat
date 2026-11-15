import { describe, expect, it, vi, beforeAll } from 'vitest'
import { drawScene } from './renderer'
import { DEFAULTS } from './constants'
import { initialFrameState } from '../store/slices/frameSlice'
import { initialWebcamState } from '../store/slices/webcamSlice'
import type { RenderableState } from '../types'

beforeAll(() => {
  if (typeof globalThis.Path2D === 'undefined') {
    globalThis.Path2D = class Path2D {
      roundRect() {}
    } as unknown as typeof Path2D
  }
})

function createMockContext() {
  const calls: string[] = []
  const ctx = {
    save: vi.fn(() => calls.push('save')),
    restore: vi.fn(() => calls.push('restore')),
    beginPath: vi.fn(() => calls.push('beginPath')),
    arc: vi.fn((...args: unknown[]) =>
      calls.push(`arc(${args.map((a) => (typeof a === 'number' ? Math.round(a) : a)).join(',')})`),
    ),
    fill: vi.fn(() => calls.push('fill')),
    stroke: vi.fn(() => calls.push('stroke')),
    clip: vi.fn(() => calls.push('clip')),
    drawImage: vi.fn(() => calls.push('drawImage')),
    roundRect: vi.fn(() => calls.push('roundRect')),
    clearRect: vi.fn(() => calls.push('clearRect')),
    fillRect: vi.fn(() => calls.push('fillRect')),
    translate: vi.fn((x: number, y: number) => calls.push(`translate(${Math.round(x)},${Math.round(y)})`)),
    scale: vi.fn((x: number, y: number) => calls.push(`scale(${x},${y})`)),
    rotate: vi.fn((r: number) => calls.push(`rotate(${r})`)),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

describe('click ripple rendering in drawScene', () => {
  it('draws a prominent filled and stroked ripple ring when click occurs in metadata', async () => {
    const { ctx, calls } = createMockContext()

    const state: RenderableState = {
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
      isWebcamVisible: false,
      zoomRegions: {},
      cutRegions: {},
      speedRegions: {},
      videoClips: [],
      metadata: [
        { timestamp: 0.5, x: 200, y: 200, type: 'move' },
        { timestamp: 1.0, x: 960, y: 540, type: 'click', pressed: true },
        { timestamp: 1.2, x: 960, y: 540, type: 'move' },
      ],
      cursorImages: {},
      cursorBitmapsToRender: new Map(),
      cursorIconsToRender: new Map(),
      syncOffset: 0,
      cursorTheme: null,
      cursorStyles: {
        showCursor: false,
        cursorIcon: 'recorded',
        shadowBlur: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        shadowColor: '',
        clickRippleEffect: true,
        clickRippleColor: 'rgba(255, 255, 255, 0.8)',
        clickRippleSize: 40,
        clickRippleDuration: 0.5,
        clickScaleEffect: false,
        clickScaleAmount: 1,
        clickScaleDuration: 0.4,
        clickScaleEasing: 'Balanced',
        smoothingEnabled: false,
        smoothing: 0.1,
        motionBlurEnabled: false,
        motionBlurShutterAngle: 180,
        motionBlurSamples: 4,
        motionBlurStrength: 1,
      },
    }

    const mockVideo = {
      readyState: 4,
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement

    // At t=1.2s, the click at t=1.0s is 0.2s into its 0.5s ripple animation
    await drawScene(ctx, state, mockVideo, null, 1.2, 1920, 1080, null)

    const arcCalls = calls.filter((c) => c.startsWith('arc'))
    expect(arcCalls.length).toBeGreaterThanOrEqual(1)
    // Centered at scaled click coords (864, 486) within the content area
    expect(arcCalls[0]).toContain('864,486')
    expect(calls).toContain('fill')
    expect(calls).toContain('stroke')
  })

  it('renders ripple correctly even when recordingGeometry is null by falling back to videoDimensions', async () => {
    const { ctx, calls } = createMockContext()

    const state: RenderableState = {
      platform: 'linux',
      frameStyles: initialFrameState.frameStyles,
      aspectRatio: '16:9',
      cameraMotions: [],
      visualEffects: [],
      compositionLayouts: [],
      videoDimensions: { width: 1280, height: 720 },
      recordingGeometry: null, // Null geometry should fall back to videoDimensions
      webcamPosition: { pos: 'bottom-right' },
      webcamStyles: initialWebcamState.webcamStyles,
      isWebcamVisible: false,
      zoomRegions: {},
      cutRegions: {},
      speedRegions: {},
      videoClips: [],
      metadata: [{ timestamp: 2.0, x: 640, y: 360, type: 'click', pressed: true }],
      cursorImages: {},
      cursorBitmapsToRender: new Map(),
      cursorIconsToRender: new Map(),
      syncOffset: 0,
      cursorTheme: null,
      cursorStyles: {
        showCursor: false,
        cursorIcon: 'recorded',
        shadowBlur: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        shadowColor: '',
        clickRippleEffect: true,
        clickRippleColor: '#3b82f6', // hex color support
        clickRippleSize: 50,
        clickRippleDuration: 0.5,
        clickScaleEffect: false,
        clickScaleAmount: 1,
        clickScaleDuration: 0.4,
        clickScaleEasing: 'Balanced',
        smoothingEnabled: false,
        smoothing: 0.1,
        motionBlurEnabled: false,
        motionBlurShutterAngle: 180,
        motionBlurSamples: 4,
        motionBlurStrength: 1,
      },
    }

    const mockVideo = {
      readyState: 4,
      videoWidth: 1280,
      videoHeight: 720,
    } as HTMLVideoElement

    await drawScene(ctx, state, mockVideo, null, 2.1, 1280, 720, null)

    const arcCalls = calls.filter((c) => c.startsWith('arc'))
    expect(arcCalls.length).toBeGreaterThanOrEqual(1)
    // Centered at scaled click coords (576, 324) within the content area
    expect(arcCalls[0]).toContain('576,324')
    expect(calls).toContain('fill')
    expect(calls).toContain('stroke')
  })

  it('defaults click ripple effect to enabled in DEFAULTS', () => {
    expect(DEFAULTS.CURSOR.CLICK_RIPPLE.ENABLED.defaultValue).toBe(true)
  })
})
