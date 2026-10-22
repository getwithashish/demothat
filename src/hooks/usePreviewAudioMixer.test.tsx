// @vitest-environment jsdom
//
// The glue between the editor and the mixer.
//
// The mixer itself is verified separately, against a real AudioContext — this is
// about when it is built, what it is built with, and what it is told. That is where
// the bugs were: the mixer was always right, and the wiring was going to hand it the
// wrong recording, or extract the recording again on every frame of a volume drag,
// or leave the element muted so the microphone was heard twice.
//
// The mixer is faked here on purpose. A real one would drag the DOM's media
// elements and an AudioContext into a test that is not about either.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { useEffect } from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'

const mixers = vi.hoisted(() => [] as FakeMixer[])
const store = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
const extractAudioTracks = vi.hoisted(() => vi.fn())

interface FakeMixer {
  options: { video: unknown; createElement: (url: string) => unknown; output?: unknown }
  attach: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  tick: ReturnType<typeof vi.fn>
  setTrack: ReturnType<typeof vi.fn>
  setMaster: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

vi.mock('../lib/preview-audio-mixer', () => ({
  DEFAULT_DRIFT_TOLERANCE_SEC: 0.04,
  PreviewAudioMixer: class {
    attach = vi.fn()
    play = vi.fn().mockResolvedValue(undefined)
    pause = vi.fn()
    tick = vi.fn().mockReturnValue([])
    setTrack = vi.fn()
    setMaster = vi.fn()
    dispose = vi.fn()
    constructor(public options: FakeMixer['options']) {
      mixers.push(this as unknown as FakeMixer)
    }
  },
}))

vi.mock('../store/editorStore', () => ({
  useEditorStore: Object.assign((selector: (state: Record<string, unknown>) => unknown) => selector(store.state), {
    getState: () => store.state,
  }),
}))

import { usePreviewAudioMixer, type PreviewAudioState } from './usePreviewAudioMixer'

// --- The recording the store is showing -----------------------------------------

const TRACKS = [
  { id: 'audio-mic-0', kind: 'mic', index: 0, label: 'Microphone', volume: 1, muted: false },
  { id: 'audio-system-1', kind: 'system', index: 1, label: 'System audio', volume: 0.5, muted: true },
]

function resetStore(overrides: Record<string, unknown> = {}) {
  store.state = {
    audioTracks: TRACKS,
    videoPath: '/recordings/one.mp4',
    volume: 0.8,
    isMuted: false,
    ...overrides,
  }
}

/** What the main process hands back: one playable file per track. */
function extraction(entries: { id: string; index: number }[]) {
  return { tracks: entries.map((entry) => ({ ...entry, url: `media:///cache/${entry.id}.m4a` })) }
}

// --- Rendering -------------------------------------------------------------------

let container: HTMLDivElement
let root: Root
let latest: PreviewAudioState | null = null

function Harness({ isPlaying }: { isPlaying: boolean }) {
  const videoRef = React.useRef<HTMLVideoElement>(null)
  latest = usePreviewAudioMixer({ videoRef, isPlaying })
  return React.createElement('video', { ref: videoRef })
}

/** Render, and let the extraction promise settle. */
async function render(isPlaying = false) {
  await act(async () => {
    root.render(React.createElement(Harness, { isPlaying }))
  })
  await act(async () => {
    await Promise.resolve()
  })
}

async function rerender(isPlaying: boolean) {
  await act(async () => {
    root.render(React.createElement(Harness, { isPlaying }))
  })
  await act(async () => {
    await Promise.resolve()
  })
}

// --- requestAnimationFrame, driven by hand ---------------------------------------

let frames: (() => void)[] = []

beforeEach(() => {
  mixers.length = 0
  frames = []
  latest = null
  resetStore()
  extractAudioTracks.mockReset()
  extractAudioTracks.mockImplementation((request: { tracks: { id: string; index: number }[] }) =>
    Promise.resolve(extraction(request.tracks)),
  )

  ;(window as unknown as { electronAPI: unknown }).electronAPI = { extractAudioTracks }
  // jsdom has no Web Audio. The mixer is faked here, so the context only has to
  // exist and close — and its absence is what the fallback test below relies on.
  ;(globalThis as unknown as { AudioContext: unknown }).AudioContext = class {
    state = 'running'
    destination = {}
    close = vi.fn().mockResolvedValue(undefined)
  }
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (callback: () => void) => {
    frames.push(callback)
    return frames.length
  }
  ;(globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = () => undefined

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
})

/** Run one animation frame, if any is pending. */
function runFrame() {
  const pending = frames
  frames = []
  for (const callback of pending) callback()
}

describe('extraction', () => {
  it('asks the main process for the recording’s tracks, once', async () => {
    await render()

    expect(extractAudioTracks).toHaveBeenCalledTimes(1)
    expect(extractAudioTracks.mock.calls[0]?.[0]).toEqual({
      filePath: '/recordings/one.mp4',
      tracks: TRACKS,
    })
  })

  it('does not extract when the recording has no tracks', async () => {
    resetStore({ audioTracks: [] })
    await render()

    expect(extractAudioTracks).not.toHaveBeenCalled()
    expect(latest?.mixerOwnsAudio).toBe(false)
  })

  it('does not extract when there is no recording', async () => {
    resetStore({ videoPath: null })
    await render()

    expect(extractAudioTracks).not.toHaveBeenCalled()
  })

  it('does not extract again when only a track’s volume changes', async () => {
    await render()
    expect(extractAudioTracks).toHaveBeenCalledTimes(1)

    // A drag produces a new array on every frame. Extracting on each of those would
    // be an IPC round trip per frame.
    resetStore({ audioTracks: [{ ...TRACKS[0], volume: 0.3 }, TRACKS[1]] })
    await rerender(false)

    expect(extractAudioTracks).toHaveBeenCalledTimes(1)
  })

  it('extracts again, and rebuilds, when a different recording is loaded', async () => {
    await render()
    expect(mixers).toHaveLength(1)

    resetStore({ videoPath: '/recordings/two.mp4' })
    await rerender(false)

    expect(extractAudioTracks).toHaveBeenCalledTimes(2)
    // The second recording's elements, not the first one's — the picture changing
    // while the audio stays behind is the bug this pins.
    expect(mixers).toHaveLength(2)
    expect(mixers[0]?.dispose).toHaveBeenCalled()
  })

  it('ignores a stale extraction that resolves after a newer one', async () => {
    let releaseFirst: ((value: unknown) => void) | null = null
    extractAudioTracks.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve
        }),
    )
    await render()

    // A second recording starts, and its extraction is what the editor should use.
    resetStore({ videoPath: '/recordings/two.mp4' })
    await rerender(false)

    await act(async () => {
      releaseFirst?.(extraction([{ id: 'audio-mic-0', index: 0 }]))
      await Promise.resolve()
    })

    expect(mixers).toHaveLength(1)
  })

  it('falls back to the element’s own audio when extraction fails', async () => {
    extractAudioTracks.mockRejectedValue(new Error('ffmpeg exploded'))
    await render()

    // Silent would be the worst outcome: the element keeps playing the recording.
    expect(latest?.mixerOwnsAudio).toBe(false)
    expect(mixers).toHaveLength(0)
  })
})

describe('the graph', () => {
  it('is built with the extracted files, not the recording', async () => {
    await render()

    expect(mixers).toHaveLength(1)
    expect(mixers[0]?.attach).toHaveBeenCalledWith([
      { id: 'audio-mic-0', url: 'media:///cache/audio-mic-0.m4a', volume: 1, muted: false },
      { id: 'audio-system-1', url: 'media:///cache/audio-system-1.m4a', volume: 1, muted: false },
    ])
    expect(latest?.mixerOwnsAudio).toBe(true)
  })

  it('carries the master volume and mute, and each track’s own', async () => {
    await render()
    const mixer = mixers[0]

    expect(mixer?.setMaster).toHaveBeenCalledWith(0.8, false)
    expect(mixer?.setTrack).toHaveBeenCalledWith('audio-mic-0', { volume: 1, muted: false })
    expect(mixer?.setTrack).toHaveBeenCalledWith('audio-system-1', { volume: 0.5, muted: true })
  })

  it('applies a later change to the master and to one track', async () => {
    await render()
    const mixer = mixers[0]
    mixer?.setMaster.mockClear()
    mixer?.setTrack.mockClear()

    resetStore({ volume: 0.2, isMuted: true, audioTracks: [{ ...TRACKS[0], muted: true }, TRACKS[1]] })
    await rerender(false)

    expect(mixer?.setMaster).toHaveBeenCalledWith(0.2, true)
    expect(mixer?.setTrack).toHaveBeenCalledWith('audio-mic-0', { volume: 1, muted: true })
    // The graph is not rebuilt for a volume change.
    expect(mixers).toHaveLength(1)
  })
})

describe('the transport', () => {
  it('starts the mix when playback starts and stops it when it stops', async () => {
    await render(false)
    const mixer = mixers[0]
    // Building the graph while paused must not start anything.
    expect(mixer?.play).not.toHaveBeenCalled()
    const pausesAtBuild = mixer?.pause.mock.calls.length ?? 0

    await rerender(true)
    expect(mixer?.play).toHaveBeenCalledTimes(1)

    await rerender(false)
    expect(mixer?.pause).toHaveBeenCalledTimes(pausesAtBuild + 1)

    // And it can be started again, from the same mixer.
    await rerender(true)
    expect(mixer?.play).toHaveBeenCalledTimes(2)

    // A transport change never rebuilds the graph.
    expect(mixers).toHaveLength(1)
  })

  it('keeps the tracks in step on every frame while playing', async () => {
    await render(true)
    const mixer = mixers[0]
    mixer?.tick.mockClear()

    await act(async () => {
      runFrame()
      runFrame()
    })

    expect(mixer?.tick).toHaveBeenCalledTimes(2)
  })

  it('does not tick while paused', async () => {
    await render(false)
    const mixer = mixers[0]
    mixer?.tick.mockClear()

    await act(async () => {
      runFrame()
    })

    expect(mixer?.tick).not.toHaveBeenCalled()
  })
})

describe('teardown', () => {
  it('disposes the mixer when the editor unmounts', async () => {
    await render(true)
    const mixer = mixers[0]

    await act(async () => {
      root.unmount()
    })

    expect(mixer?.dispose).toHaveBeenCalled()
    // A second unmount in afterEach must not double-dispose into an error.
    root = createRoot(container)
  })

  it('stops ticking once the recording is gone', async () => {
    await render(true)
    const mixer = mixers[0]

    resetStore({ audioTracks: [] })
    await rerender(true)
    mixer?.tick.mockClear()

    await act(async () => {
      runFrame()
    })

    expect(mixer?.tick).not.toHaveBeenCalled()
  })
})

// A smoke check that the harness itself is honest: if the hook stopped rendering,
// every assertion above would pass vacuously.
describe('the harness', () => {
  it('actually runs the hook', async () => {
    await render()
    expect(latest).not.toBeNull()
  })
})

// React 18's act wants the environment flag set before any render; keeping the
// import referenced stops a linter from dropping it.
void useEffect
