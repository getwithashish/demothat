// @vitest-environment jsdom
//
// A Wayland recording arrives with no cursor samples at all: there is no global
// pointer coordinate to read there, so the tracker never runs and the pointer is
// part of the video pixels instead (see electron/main/features/recording-manager.ts).
// The editor has to load such a recording without inventing a cursor, without
// generating auto-zoom from clicks that do not exist, and without falling over —
// this pins that, because it is the shape every Wayland recording now has.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '../editorStore'

const WAYLAND_METADATA = {
  platform: 'linux',
  screenSize: { width: 1920, height: 1080 },
  geometry: { x: 0, y: 0, width: 1920, height: 1080 },
  syncOffset: 0,
  cursorImages: {},
  events: [],
}

/** Any preload call the load path makes but this test does not care about. */
const stub = new Proxy(
  {},
  {
    get: () => vi.fn(() => Promise.resolve(undefined)),
  },
)

const electronAPI = {
  ...stub,
  readFile: vi.fn(() => Promise.resolve(JSON.stringify(WAYLAND_METADATA))),
  getPlatform: vi.fn(() => Promise.resolve('linux' as NodeJS.Platform)),
  getSetting: vi.fn(() => Promise.resolve(undefined)),
}

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).window.electronAPI = electronAPI
  useEditorStore.getState().resetProjectState()
})

describe('loading a Wayland recording', () => {
  it('accepts a capture that has no cursor samples', async () => {
    await useEditorStore.getState().loadProject({
      videoPath: '/tmp/DemoThat-recording-screen.mp4',
      metadataPath: '/tmp/DemoThat-recording.json',
    })

    const state = useEditorStore.getState()
    expect(state.videoPath).toBe('/tmp/DemoThat-recording-screen.mp4')
    expect(state.metadata).toEqual([])
  })

  it('generates no auto-zoom, because auto-zoom is built from recorded clicks', async () => {
    await useEditorStore.getState().loadProject({
      videoPath: '/tmp/DemoThat-recording-screen.mp4',
      metadataPath: '/tmp/DemoThat-recording.json',
    })

    expect(useEditorStore.getState().zoomRegions).toEqual({})
  })

  it('adds no click clips and draws no synthetic cursor over the recorded one', async () => {
    await useEditorStore.getState().loadProject({
      videoPath: '/tmp/DemoThat-recording-screen.mp4',
      metadataPath: '/tmp/DemoThat-recording.json',
    })

    const state = useEditorStore.getState()
    expect(state.audioClips.filter((clip) => clip.kind === 'click')).toEqual([])
    expect(state.cursorBitmapsToRender.size).toBe(0)
    expect(state.cursorTheme).toBeFalsy()
  })

  it('keeps the geometry the mux recorded, which is the frame the video has', async () => {
    await useEditorStore.getState().loadProject({
      videoPath: '/tmp/DemoThat-recording-screen.mp4',
      metadataPath: '/tmp/DemoThat-recording.json',
    })

    // For a Wayland area recording the mux rewrites this to the cropped rect, in
    // the captured video's pixel space, so the editor's maths matches the file.
    expect(useEditorStore.getState().recordingGeometry).toEqual(WAYLAND_METADATA.geometry)
  })
})
