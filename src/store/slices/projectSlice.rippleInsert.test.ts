// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '../editorStore'
import type {
  ZoomRegion,
  CutRegion,
  SpeedRegion,
  CameraMotionTrack,
  CameraPose,
  VisualEffectRegion,
  CompositionLayoutRange,
  AudioClip,
  VideoClip,
} from '../../types'
import type { SubtitleCue } from '../../../shared/subtitles'

const SAMPLE_MERGED_METADATA = {
  platform: 'linux',
  screenSize: { width: 1920, height: 1080 },
  geometry: { x: 0, y: 0, width: 1920, height: 1080 },
  syncOffset: 0,
  cursorImages: {
    'cursor-1': { width: 32, height: 32, xhot: 0, yhot: 0, image: [0, 0, 0, 0] },
  },
  events: [
    { type: 'move', x: 100, y: 200, timestamp: 1000 },
    { type: 'click', x: 150, y: 250, pressed: true, timestamp: 3000 },
    { type: 'move', x: 300, y: 400, timestamp: 7000 },
  ],
}

const stub = new Proxy(
  {},
  {
    get: () => vi.fn(() => Promise.resolve(undefined)),
  },
)

const electronAPI = {
  ...stub,
  readFile: vi.fn(() => Promise.resolve(JSON.stringify(SAMPLE_MERGED_METADATA))),
  getPlatform: vi.fn(() => Promise.resolve('linux' as NodeJS.Platform)),
  getSetting: vi.fn(() => Promise.resolve(undefined)),
}

describe('rippleInsertRecording', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).window.electronAPI = electronAPI
    vi.clearAllMocks()
    useEditorStore.getState().resetProjectState()
  })

  it('updates media paths, duration, metadata, and marks project dirty', async () => {
    useEditorStore.setState((state) => {
      state.currentProjectPath = '/tmp/project.dthat'
      state.duration = 10.0
      state.saveStatus = 'saved'
      state.isDirty = false
    })

    await useEditorStore.getState().rippleInsertRecording({
      videoPath: '/tmp/project/merged-screen.mp4',
      metadataPath: '/tmp/project/merged-meta.json',
      webcamVideoPath: '/tmp/project/merged-webcam.mp4',
      insertTime: 5.0,
      addedDuration: 4.5,
    })

    const state = useEditorStore.getState()
    expect(state.videoPath).toBe('/tmp/project/merged-screen.mp4')
    expect(state.videoUrl).toBe('media:///tmp/project/merged-screen.mp4')
    expect(state.metadataPath).toBe('/tmp/project/merged-meta.json')
    expect(state.webcamVideoPath).toBe('/tmp/project/merged-webcam.mp4')
    expect(state.webcamVideoUrl).toBe('media:///tmp/project/merged-webcam.mp4')
    expect(state.isWebcamVisible).toBe(true)
    expect(state.duration).toBe(14.5)
    expect(state.isDirty).toBe(true)
    expect(state.saveStatus).toBe('unsaved')

    // Cursor metadata parsed and loaded with seconds timestamps
    expect(state.metadata).toHaveLength(3)
    expect(state.metadata[0].timestamp).toBe(1.0)
    expect(state.metadata[1].timestamp).toBe(3.0)
    expect(state.metadata[2].timestamp).toBe(7.0)
    expect(state.screenSize).toEqual({ width: 1920, height: 1080 })
  })

  it('correctly shifts, splits, or preserves timeline items across all tracks', async () => {
    const zoomBefore: ZoomRegion = {
      id: 'z-before',
      type: 'zoom',
      startTime: 1.0,
      duration: 2.0,
      zoomLevel: 2,
      easing: 'ease-in-out',
      transitionDuration: 0.3,
      targetX: 0,
      targetY: 0,
      mode: 'fixed',
      zIndex: 1,
    }
    const zoomSpan: ZoomRegion = {
      id: 'z-span',
      type: 'zoom',
      startTime: 4.0,
      duration: 3.0, // spans 4.0 to 7.0
      zoomLevel: 2.5,
      easing: 'ease-in-out',
      transitionDuration: 0.3,
      targetX: 0.1,
      targetY: 0.1,
      mode: 'fixed',
      zIndex: 2,
    }
    const zoomAfter: ZoomRegion = {
      id: 'z-after',
      type: 'zoom',
      startTime: 8.0,
      duration: 1.5,
      zoomLevel: 1.8,
      easing: 'ease-in-out',
      transitionDuration: 0.3,
      targetX: 0,
      targetY: 0,
      mode: 'fixed',
      zIndex: 3,
    }

    const cutBefore: CutRegion = {
      id: 'c-before',
      type: 'cut',
      startTime: 0.5,
      duration: 1.0,
      zIndex: 1,
    }
    const cutSpan: CutRegion = {
      id: 'c-span',
      type: 'cut',
      startTime: 4.5,
      duration: 2.0, // spans 4.5 to 6.5
      zIndex: 2,
    }
    const cutAfter: CutRegion = {
      id: 'c-after',
      type: 'cut',
      startTime: 7.5,
      duration: 0.5,
      zIndex: 3,
    }

    const speedBefore: SpeedRegion = {
      id: 's-before',
      type: 'speed',
      startTime: 2.0,
      duration: 1.0,
      speed: 2,
      zIndex: 1,
    }
    const speedAfter: SpeedRegion = {
      id: 's-after',
      type: 'speed',
      startTime: 8.0,
      duration: 1.0,
      speed: 1.5,
      zIndex: 2,
    }

    const samplePose: CameraPose = {
      x: 0,
      y: 0,
      scale: 1,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      perspective: 1000,
    }

    const cameraMotions: CameraMotionTrack[] = [
      {
        id: 'cm-before',
        name: 'Pan 1',
        kind: 'pan-left',
        startTime: 1.0,
        endTime: 2.0,
        easing: 'linear',
        from: samplePose,
        to: samplePose,
      },
      {
        id: 'cm-span',
        name: 'Pan 2',
        kind: 'pan-right',
        startTime: 4.0,
        endTime: 6.0,
        easing: 'linear',
        from: samplePose,
        to: samplePose,
      },
      {
        id: 'cm-after',
        name: 'Pan 3',
        kind: 'dolly-in',
        startTime: 7.0,
        endTime: 9.0,
        easing: 'linear',
        from: samplePose,
        to: samplePose,
      },
    ]

    const visualEffects: VisualEffectRegion[] = [
      {
        id: 'fx-before',
        kind: 'blur',
        shape: 'rectangle',
        startTime: 2.0,
        duration: 1.0,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        points: [],
        color: '',
        borderWidth: 0,
        blur: 5,
        dimOutside: 0,
        scale: 1,
        animated: false,
        direction: 'in',
        loop: false,
        enterDuration: 0,
        exitDuration: 0,
      },
      {
        id: 'fx-after',
        kind: 'blur',
        shape: 'rectangle',
        startTime: 7.5,
        duration: 1.0,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        points: [],
        color: '',
        borderWidth: 0,
        blur: 5,
        dimOutside: 0,
        scale: 1,
        animated: false,
        direction: 'in',
        loop: false,
        enterDuration: 0,
        exitDuration: 0,
      },
    ]

    const compositionLayouts: CompositionLayoutRange[] = [
      {
        id: 'layout-before',
        layout: 'picture-in-picture',
        startTime: 0.0,
        duration: 3.0,
        transitionDuration: 0.3,
      },
      {
        id: 'layout-after',
        layout: 'side-by-side',
        startTime: 8.0,
        duration: 2.0,
        transitionDuration: 0.3,
      },
    ]

    const subtitleCues: SubtitleCue[] = [
      { id: 'cue-before', start: 1.0, end: 3.0, text: 'First line' },
      { id: 'cue-span', start: 4.0, end: 6.0, text: 'Spanning line' },
      { id: 'cue-after', start: 7.5, end: 9.0, text: 'Last line' },
    ]

    const audioClips: AudioClip[] = [
      {
        id: 'audio-before',
        name: 'Music 1',
        filePath: '/tmp/music1.mp3',
        startTime: 2.0,
        duration: 1.0,
        sourceStart: 0,
        sourceDuration: 1.0,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        loop: false,
      },
      {
        id: 'audio-after',
        name: 'Music 2',
        filePath: '/tmp/music2.mp3',
        startTime: 8.0,
        duration: 1.0,
        sourceStart: 0,
        sourceDuration: 1.0,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        loop: false,
      },
    ]

    const videoClips: VideoClip[] = [
      {
        id: 'clip-before',
        name: 'B-Roll 1',
        filePath: '/tmp/clip1.mp4',
        startTime: 1.5,
        duration: 1.0,
        sourceStart: 0,
        sourceDuration: 1.0,
        order: 1,
      },
      {
        id: 'clip-after',
        name: 'B-Roll 2',
        filePath: '/tmp/clip2.mp4',
        startTime: 8.5,
        duration: 1.0,
        sourceStart: 0,
        sourceDuration: 1.0,
        order: 2,
      },
    ]

    useEditorStore.setState((state) => {
      state.duration = 10.0
      state.zoomRegions = {
        'z-before': zoomBefore,
        'z-span': zoomSpan,
        'z-after': zoomAfter,
      }
      state.cutRegions = {
        'c-before': cutBefore,
        'c-span': cutSpan,
        'c-after': cutAfter,
      }
      state.speedRegions = {
        's-before': speedBefore,
        's-after': speedAfter,
      }
      state.cameraMotions = cameraMotions
      state.visualEffects = visualEffects
      state.compositionLayouts = compositionLayouts
      state.subtitleCues = subtitleCues
      state.audioClips = audioClips
      state.videoClips = videoClips
    })

    // Splicing 4.0s of footage at insertTime = 5.0
    await useEditorStore.getState().rippleInsertRecording({
      videoPath: '/tmp/merged.mp4',
      metadataPath: '/tmp/merged.json',
      insertTime: 5.0,
      addedDuration: 4.0,
    })

    const state = useEditorStore.getState()

    // 1. Zoom regions
    // z-before: [1.0 .. 3.0] untouched
    expect(state.zoomRegions['z-before'].startTime).toBe(1.0)
    expect(state.zoomRegions['z-before'].duration).toBe(2.0)
    // z-span: originally [4.0 .. 7.0], spans 5.0.
    // Part 1: [4.0 .. 5.0], duration = 1.0
    expect(state.zoomRegions['z-span'].startTime).toBe(4.0)
    expect(state.zoomRegions['z-span'].duration).toBe(1.0)
    // Part 2: starts at 5.0 + 4.0 = 9.0, duration = 7.0 - 5.0 = 2.0
    const zoomParts = Object.values(state.zoomRegions).filter((z) => z.id.startsWith('z-span-split'))
    expect(zoomParts).toHaveLength(1)
    expect(zoomParts[0].startTime).toBe(9.0)
    expect(zoomParts[0].duration).toBe(2.0)
    expect(zoomParts[0].zoomLevel).toBe(2.5)
    // z-after: originally 8.0, shifted to 8.0 + 4.0 = 12.0
    expect(state.zoomRegions['z-after'].startTime).toBe(12.0)
    expect(state.zoomRegions['z-after'].duration).toBe(1.5)

    // 2. Cut regions
    // c-before: untouched at 0.5
    expect(state.cutRegions['c-before'].startTime).toBe(0.5)
    // c-span: originally [4.5 .. 6.5], spans 5.0.
    // Part 1: [4.5 .. 5.0], duration = 0.5
    expect(state.cutRegions['c-span'].startTime).toBe(4.5)
    expect(state.cutRegions['c-span'].duration).toBe(0.5)
    // Part 2: starts at 5.0 + 4.0 = 9.0, duration = 6.5 - 5.0 = 1.5
    const cutParts = Object.values(state.cutRegions).filter((c) => c.id.startsWith('c-span-split'))
    expect(cutParts).toHaveLength(1)
    expect(cutParts[0].startTime).toBe(9.0)
    expect(cutParts[0].duration).toBe(1.5)
    // c-after: originally 7.5, shifted to 7.5 + 4.0 = 11.5
    expect(state.cutRegions['c-after'].startTime).toBe(11.5)

    // 3. Speed regions
    expect(state.speedRegions['s-before'].startTime).toBe(2.0)
    expect(state.speedRegions['s-after'].startTime).toBe(12.0)

    // 4. Camera motions
    const cmBefore = state.cameraMotions.find((m) => m.id === 'cm-before')!
    expect(cmBefore.startTime).toBe(1.0)
    expect(cmBefore.endTime).toBe(2.0)

    const cmSpan = state.cameraMotions.find((m) => m.id === 'cm-span')!
    expect(cmSpan.startTime).toBe(4.0)
    expect(cmSpan.endTime).toBe(10.0) // 6.0 + 4.0

    const cmAfter = state.cameraMotions.find((m) => m.id === 'cm-after')!
    expect(cmAfter.startTime).toBe(11.0) // 7.0 + 4.0
    expect(cmAfter.endTime).toBe(13.0) // 9.0 + 4.0

    // 5. Visual effects
    const fxBefore = state.visualEffects.find((fx) => fx.id === 'fx-before')!
    expect(fxBefore.startTime).toBe(2.0)

    const fxAfter = state.visualEffects.find((fx) => fx.id === 'fx-after')!
    expect(fxAfter.startTime).toBe(11.5) // 7.5 + 4.0

    // 6. Composition layouts
    const lBefore = state.compositionLayouts.find((l) => l.id === 'layout-before')!
    expect(lBefore.startTime).toBe(0.0)

    const lAfter = state.compositionLayouts.find((l) => l.id === 'layout-after')!
    expect(lAfter.startTime).toBe(12.0) // 8.0 + 4.0

    // 7. Subtitle cues
    const cueBefore = state.subtitleCues.find((c) => c.id === 'cue-before')!
    expect(cueBefore.start).toBe(1.0)
    expect(cueBefore.end).toBe(3.0)

    const cueSpan = state.subtitleCues.find((c) => c.id === 'cue-span')!
    expect(cueSpan.start).toBe(4.0)
    expect(cueSpan.end).toBe(10.0) // 6.0 + 4.0

    const cueAfter = state.subtitleCues.find((c) => c.id === 'cue-after')!
    expect(cueAfter.start).toBe(11.5) // 7.5 + 4.0
    expect(cueAfter.end).toBe(13.0) // 9.0 + 4.0

    // 8. Audio clips
    const aBefore = state.audioClips.find((a) => a.id === 'audio-before')!
    expect(aBefore.startTime).toBe(2.0)

    const aAfter = state.audioClips.find((a) => a.id === 'audio-after')!
    expect(aAfter.startTime).toBe(12.0) // 8.0 + 4.0

    // 9. Video clips
    const vcBefore = state.videoClips.find((vc) => vc.id === 'clip-before')!
    expect(vcBefore.startTime).toBe(1.5)

    const vcAfter = state.videoClips.find((vc) => vc.id === 'clip-after')!
    expect(vcAfter.startTime).toBe(12.5) // 8.5 + 4.0
  })

  it('handles ripple insert at timeline start (insertTime = 0)', async () => {
    const zoom: ZoomRegion = {
      id: 'z-start',
      type: 'zoom',
      startTime: 0,
      duration: 3.0,
      zoomLevel: 2,
      easing: 'ease-in-out',
      transitionDuration: 0.3,
      targetX: 0,
      targetY: 0,
      mode: 'fixed',
      zIndex: 1,
    }

    useEditorStore.setState((state) => {
      state.duration = 5.0
      state.zoomRegions = { 'z-start': zoom }
    })

    await useEditorStore.getState().rippleInsertRecording({
      videoPath: '/tmp/merged.mp4',
      metadataPath: '/tmp/merged.json',
      insertTime: 0,
      addedDuration: 3.0,
    })

    const state = useEditorStore.getState()
    expect(state.duration).toBe(8.0)
    expect(state.zoomRegions['z-start'].startTime).toBe(3.0)
    expect(state.zoomRegions['z-start'].duration).toBe(3.0)
  })

  it('handles ripple insert at timeline end (append mode)', async () => {
    const zoom: ZoomRegion = {
      id: 'z-1',
      type: 'zoom',
      startTime: 1.0,
      duration: 3.0,
      zoomLevel: 2,
      easing: 'ease-in-out',
      transitionDuration: 0.3,
      targetX: 0,
      targetY: 0,
      mode: 'fixed',
      zIndex: 1,
    }

    useEditorStore.setState((state) => {
      state.duration = 5.0
      state.zoomRegions = { 'z-1': zoom }
    })

    await useEditorStore.getState().rippleInsertRecording({
      videoPath: '/tmp/merged.mp4',
      metadataPath: '/tmp/merged.json',
      insertTime: 5.0,
      addedDuration: 2.5,
    })

    const state = useEditorStore.getState()
    expect(state.duration).toBe(7.5)
    expect(state.zoomRegions['z-1'].startTime).toBe(1.0)
    expect(state.zoomRegions['z-1'].duration).toBe(3.0)
  })

  it('creates distinct recordingSegments and generates auto-zooms and click sounds for the new recording', async () => {
    useEditorStore.setState((state) => {
      state.duration = 5.0
      state.recordingGeometry = { x: 0, y: 0, width: 1920, height: 1080 }
      state.videoDimensions = { width: 1920, height: 1080 }
      state.audioClips = []
      state.zoomRegions = {}
    })

    await useEditorStore.getState().rippleInsertRecording({
      videoPath: '/tmp/merged.mp4',
      metadataPath: '/tmp/merged.json',
      insertTime: 2.0,
      addedDuration: 4.0,
      rawNewVideoPath: '/tmp/clip2.mp4',
      rawNewMetadataPath: '/tmp/clip2.json',
    })

    const state = useEditorStore.getState()

    // 1. Multiple distinct recordingSegments created
    expect(state.recordingSegments.length).toBeGreaterThanOrEqual(2)
    const newSeg = state.recordingSegments.find((s) => s.startTime === 2.0)
    expect(newSeg).toBeDefined()
    expect(newSeg?.duration).toBe(4.0)
    expect(newSeg?.sourceVideoPath).toBe('/tmp/clip2.mp4')

    // 2. Click audio clips generated from click events
    const clickClips = state.audioClips.filter((c) => c.kind === 'click')
    expect(clickClips.length).toBeGreaterThan(0)
    expect(clickClips.some((c) => c.startTime === 3.0)).toBe(true)

    // 3. Auto-zoom generated for the new recording click
    const zooms = Object.values(state.zoomRegions)
    expect(zooms.length).toBeGreaterThan(0)
  })

  it('reorders recordingSegments and shifts timeline items according to the new segment arrangement', async () => {
    const seg1 = {
      id: 'rec-1',
      name: 'Recording 1',
      startTime: 0,
      duration: 5.0,
      sourceVideoPath: '/tmp/rec1.mp4',
      sourceStartTime: 0,
    }
    const seg2 = {
      id: 'rec-2',
      name: 'Recording 2',
      startTime: 5.0,
      duration: 4.0,
      sourceVideoPath: '/tmp/rec2.mp4',
      sourceStartTime: 0,
    }

    const zoomInSeg2: ZoomRegion = {
      id: 'z-seg2',
      type: 'zoom',
      startTime: 6.0, // 1s into seg2
      duration: 2.0,
      zoomLevel: 2,
      easing: 'ease-in-out',
      transitionDuration: 0.3,
      targetX: 0,
      targetY: 0,
      mode: 'fixed',
      zIndex: 1,
    }

    useEditorStore.setState((state) => {
      state.duration = 9.0
      state.recordingSegments = [seg1, seg2]
      state.zoomRegions = { 'z-seg2': zoomInSeg2 }
      state.audioClips = [
        {
          id: 'click-seg2',
          kind: 'click',
          name: 'Click',
          filePath: '',
          startTime: 6.5, // 1.5s into seg2
          duration: 0.25,
          sourceStart: 0,
          sourceDuration: 0.25,
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
          loop: false,
          speed: 1,
        },
      ]
    })

    // Drag seg2 to start first: [seg2, seg1]
    await useEditorStore.getState().reorderRecordingSegments([seg2, seg1])

    const state = useEditorStore.getState()
    expect(state.recordingSegments[0].id).toBe('rec-2')
    expect(state.recordingSegments[0].startTime).toBe(0)
    expect(state.recordingSegments[1].id).toBe('rec-1')
    expect(state.recordingSegments[1].startTime).toBe(4.0)

    // Items inside seg2 should now start at 0 + offset
    expect(state.zoomRegions['z-seg2'].startTime).toBe(1.0) // was 6.0 (offset 1.0) -> now 0 + 1.0 = 1.0
    expect(state.audioClips[0].startTime).toBe(1.5) // was 6.5 (offset 1.5) -> now 0 + 1.5 = 1.5
  })
})
