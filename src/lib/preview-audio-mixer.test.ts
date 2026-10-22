// The preview's audio mix policy.
//
// This is the part that cannot be checked by looking at it: separate elements and
// a video element are independent clocks, and the only way to know the policy holds
// them together is to drive them apart and watch what happens. The context and the
// elements are faked here for exactly that reason — a real one would let the test
// assert on a graph rather than on the behaviour.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DRIFT_TOLERANCE_SEC,
  PreviewAudioMixer,
  type MediaLike,
  type MixerOptions,
} from './preview-audio-mixer'

class FakeElement implements MediaLike {
  currentTime = 0
  playbackRate = 1
  paused = true
  duration = 60
  plays = 0
  pauses = 0
  constructor(readonly url: string) {}

  play(): void {
    this.paused = false
    this.plays += 1
  }

  pause(): void {
    this.paused = true
    this.pauses += 1
  }
}

class FakeVideo extends FakeElement {
  constructor() {
    super('video')
    this.paused = false
  }
}

function fakeContext() {
  const gains: { value: number; connected: unknown[]; disconnected: boolean }[] = []
  const context = {
    state: 'running' as AudioContextState,
    resumed: 0,
    destination: { name: 'destination' },
    async resume() {
      context.resumed += 1
      context.state = 'running'
    },
    createGain() {
      const node = {
        value: 1,
        connected: [] as unknown[],
        disconnected: false,
        gain: {
          get value() {
            return node.value
          },
          set value(next: number) {
            node.value = next
          },
        },
        connect(target: unknown) {
          node.connected.push(target)
        },
        disconnect() {
          node.disconnected = true
        },
      }
      gains.push(node)
      return node
    },
    createMediaElementSource(element: unknown) {
      return {
        element,
        connect() {
          // The graph link is asserted through the gain nodes.
        },
      }
    },
  }
  return { context, gains }
}

function setup(options: Partial<MixerOptions> = {}) {
  const video = new FakeVideo()
  const { context, gains } = fakeContext()
  const elements = new Map<string, FakeElement>()
  const mixer = new PreviewAudioMixer({
    context: context as unknown as AudioContext,
    video,
    createElement: (url: string) => {
      const element = new FakeElement(url)
      elements.set(url, element)
      return element
    },
    ...options,
  })
  // The master gain is the first node the mixer creates.
  const master = gains[0]
  return { mixer, video, context, gains, elements, master }
}

const TRACKS = [
  { id: 'audio-mic-0', url: 'media://mic.m4a', volume: 1, muted: false },
  { id: 'audio-system-1', url: 'media://system.m4a', volume: 1, muted: false },
]

describe('attach', () => {
  it('gives every track an element and a gain', () => {
    const { mixer, gains } = setup()

    mixer.attach(TRACKS)

    expect(mixer.trackIds()).toEqual(['audio-mic-0', 'audio-system-1'])
    // One master plus one per track.
    expect(gains).toHaveLength(3)
  })

  it('starts each track where the video already is', () => {
    const { mixer, video, elements } = setup()
    video.currentTime = 12.5

    mixer.attach(TRACKS)

    // Attaching mid-playback must not start a track at the beginning of the
    // recording while the picture is twelve seconds in.
    expect(elements.get('media://mic.m4a')?.currentTime).toBe(12.5)
    expect(elements.get('media://system.m4a')?.currentTime).toBe(12.5)
  })

  it('replaces the previous tracks instead of adding to them', () => {
    const { mixer, elements } = setup()
    mixer.attach(TRACKS)

    mixer.attach([{ id: 'audio-mic-0', url: 'media://mic.m4a', volume: 1, muted: false }])

    expect(mixer.trackIds()).toEqual(['audio-mic-0'])
    expect(elements.get('media://system.m4a')?.paused).toBe(true)
  })
})

describe('transport', () => {
  it('seeks every track before playing, so nothing starts behind the picture', async () => {
    const { mixer, video, elements } = setup()
    mixer.attach(TRACKS)
    video.currentTime = 30

    await mixer.play()

    expect(elements.get('media://mic.m4a')?.currentTime).toBe(30)
    expect(elements.get('media://mic.m4a')?.plays).toBe(1)
    expect(elements.get('media://system.m4a')?.plays).toBe(1)
  })

  it('resumes a suspended context, which is what a browser hands you first', async () => {
    const { mixer, context } = setup()
    context.state = 'suspended'
    mixer.attach(TRACKS)

    await mixer.play()

    expect(context.resumed).toBe(1)
  })

  it('pauses every track', () => {
    const { mixer, elements } = setup()
    mixer.attach(TRACKS)

    mixer.pause()

    expect(elements.get('media://mic.m4a')?.paused).toBe(true)
    expect(elements.get('media://system.m4a')?.paused).toBe(true)
  })

  it('seeks on demand, which is what a scrub does', () => {
    const { mixer, elements } = setup()
    mixer.attach(TRACKS)

    mixer.seek(7.25)

    expect(elements.get('media://mic.m4a')?.currentTime).toBe(7.25)
    expect(elements.get('media://system.m4a')?.currentTime).toBe(7.25)
  })
})

describe('tick', () => {
  it('does nothing while the video is paused', () => {
    const { mixer, video, elements } = setup()
    mixer.attach(TRACKS)
    video.paused = true
    elements.get('media://mic.m4a')!.currentTime = 99

    expect(mixer.tick()).toEqual([])
  })

  it('leaves a track that is within tolerance alone', () => {
    const { mixer, video, elements } = setup()
    mixer.attach(TRACKS)
    video.currentTime = 10
    // Just inside the threshold: correcting here would be audible and pointless.
    elements.get('media://mic.m4a')!.currentTime = 10 + DEFAULT_DRIFT_TOLERANCE_SEC / 2
    elements.get('media://system.m4a')!.currentTime = 10

    expect(mixer.tick()).toEqual([])
  })

  it('pulls back a track that has drifted, and says which', () => {
    const { mixer, video, elements } = setup()
    mixer.attach(TRACKS)
    video.currentTime = 10
    elements.get('media://mic.m4a')!.currentTime = 10.5
    elements.get('media://system.m4a')!.currentTime = 10

    expect(mixer.tick()).toEqual(['audio-mic-0'])
    expect(elements.get('media://mic.m4a')?.currentTime).toBe(10)
  })

  it('corrects a track that is behind as well as one that is ahead', () => {
    const { mixer, video, elements } = setup()
    mixer.attach(TRACKS)
    video.currentTime = 10
    elements.get('media://mic.m4a')!.currentTime = 9.5
    elements.get('media://system.m4a')!.currentTime = 10

    expect(mixer.tick()).toEqual(['audio-mic-0'])
  })

  it('makes a track follow a speed change', () => {
    const { mixer, video, elements } = setup()
    mixer.attach(TRACKS)
    video.playbackRate = 2

    mixer.tick()

    // The audio has to move with the picture, not stay behind it.
    expect(elements.get('media://mic.m4a')?.playbackRate).toBe(2)
    expect(elements.get('media://system.m4a')?.playbackRate).toBe(2)
  })

  it('reports nothing after dispose', () => {
    const { mixer } = setup()
    mixer.attach(TRACKS)
    mixer.dispose()

    expect(mixer.tick()).toEqual([])
  })
})

describe('gains', () => {
  it('applies a track volume', () => {
    const { mixer } = setup()
    mixer.attach(TRACKS)

    mixer.setTrack('audio-mic-0', { volume: 0.25 })

    expect(mixer.effectiveGain('audio-mic-0')).toBe(0.25)
    expect(mixer.effectiveGain('audio-system-1')).toBe(1)
  })

  it('silences a muted track without forgetting its volume', () => {
    const { mixer } = setup()
    mixer.attach(TRACKS)
    mixer.setTrack('audio-mic-0', { volume: 0.5 })

    mixer.setTrack('audio-mic-0', { muted: true })
    expect(mixer.effectiveGain('audio-mic-0')).toBe(0)

    // Unmuting restores what the user had set, not full volume.
    mixer.setTrack('audio-mic-0', { muted: false })
    expect(mixer.effectiveGain('audio-mic-0')).toBe(0.5)
  })

  it('clamps a volume outside 0-1', () => {
    const { mixer } = setup()
    mixer.attach(TRACKS)

    mixer.setTrack('audio-mic-0', { volume: 4 })
    expect(mixer.effectiveGain('audio-mic-0')).toBe(1)

    mixer.setTrack('audio-mic-0', { volume: -1 })
    expect(mixer.effectiveGain('audio-mic-0')).toBe(0)

    mixer.setTrack('audio-mic-0', { volume: Number.NaN })
    expect(mixer.effectiveGain('audio-mic-0')).toBe(0)
  })

  it('ignores a track it does not have', () => {
    const { mixer } = setup()
    mixer.attach(TRACKS)

    mixer.setTrack('nope', { volume: 0.1 })

    expect(mixer.effectiveGain('nope')).toBe(0)
    expect(mixer.effectiveGain('audio-mic-0')).toBe(1)
  })

  it('drives the master gain from the recording volume and mute', () => {
    const { mixer, master } = setup()
    mixer.attach(TRACKS)

    mixer.setMaster(0.4, false)
    expect(master?.value).toBe(0.4)

    mixer.setMaster(0.4, true)
    expect(master?.value).toBe(0)

    mixer.setMaster(0.4, false)
    expect(master?.value).toBe(0.4)
  })
})

describe('the output tap', () => {
  it('sends the mix to the node it is given, not the speakers', () => {
    const tap = { name: 'analyser' }
    const { context, gains } = fakeContext()
    const mixer = new PreviewAudioMixer({
      context: context as unknown as AudioContext,
      video: new FakeVideo(),
      createElement: () => new FakeElement('x'),
      output: tap as unknown as AudioNode,
    })

    mixer.attach(TRACKS)

    // The master goes to the tap; a mixer that ignored it would be unmeasurable.
    const master = gains[0]
    expect(master?.connected).toContain(tap)
    expect(master?.connected).not.toContain(context.destination)
  })
})

describe('dispose', () => {
  it('stops the tracks and tears the graph down', () => {
    const { mixer, elements, gains } = setup()
    mixer.attach(TRACKS)

    mixer.dispose()

    expect(elements.get('media://mic.m4a')?.paused).toBe(true)
    expect(elements.get('media://system.m4a')?.paused).toBe(true)
    expect(gains.every((gain) => gain.disconnected)).toBe(true)
  })

  it('refuses to attach after dispose, so a torn-down mixer cannot be revived', () => {
    const { mixer, gains } = setup()
    mixer.dispose()

    mixer.attach(TRACKS)

    expect(mixer.trackIds()).toEqual([])
    // Only the master, created in the constructor.
    expect(gains).toHaveLength(1)
  })
})
