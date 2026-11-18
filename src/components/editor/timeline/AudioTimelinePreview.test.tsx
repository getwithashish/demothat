// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AudioTimelinePreview } from './AudioTimelinePreview'
import { useEditorStore } from '../../../store/editorStore'
import { virtualStudioStreamer } from '../../../features/virtual-studio'
import type { AudioClip } from '../../../types'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('AudioTimelinePreview Web Audio routing', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  let mockGainNode: {
    gain: { value: number }
    connect: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
  }
  let mockSourceNode: {
    connect: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
  }
  let mockDemoBus: {
    gain: { value: number }
    connect: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
  }
  let mockAudioContext: {
    createGain: ReturnType<typeof vi.fn>
    createBufferSource: ReturnType<typeof vi.fn>
    decodeAudioData: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })

    mockGainNode = {
      gain: { value: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }

    mockSourceNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    }

    mockDemoBus = {
      gain: { value: 1.0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }

    mockAudioContext = {
      createGain: vi.fn(() => mockGainNode),
      createBufferSource: vi.fn(() => ({
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        onended: null,
      })),
      decodeAudioData: vi.fn().mockResolvedValue({} as AudioBuffer),
    }

    vi.spyOn(virtualStudioStreamer, 'getAudioContext').mockReturnValue(mockAudioContext as unknown as AudioContext)
    vi.spyOn(virtualStudioStreamer, 'getDemoAudioBus').mockReturnValue(mockDemoBus as unknown as GainNode)
    vi.spyOn(virtualStudioStreamer, 'createMediaElementSource').mockReturnValue(
      mockSourceNode as unknown as MediaElementAudioSourceNode,
    )

    // Mock HTMLAudioElement play/pause
    Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
      writable: true,
      value: true,
    })
    window.HTMLMediaElement.prototype.play = vi.fn().mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { value: false, writable: true, configurable: true })
      return Promise.resolve()
    })
    window.HTMLMediaElement.prototype.pause = vi.fn().mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { value: true, writable: true, configurable: true })
    })
    window.HTMLMediaElement.prototype.load = vi.fn()

    act(() => {
      useEditorStore.setState({
        audioClips: [],
        currentTime: 0,
        isPlaying: false,
        volume: 1.0,
        isMuted: false,
        mouseClickSoundsEnabled: false,
        mouseClickSoundVolume: 1.0,
      })
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    container?.remove()
    container = null
    root = null
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('routes active timeline music clips into virtualStudioStreamer demoAudioBus via createMediaElementSource and GainNode', async () => {
    const testClip: AudioClip = {
      id: 'music-clip-1',
      name: 'Soundtrack',
      kind: 'music',
      filePath: '/media/soundtrack.mp3',
      startTime: 0,
      duration: 10,
      sourceStart: 0,
      sourceDuration: 10,
      speed: 1,
      volume: 0.8,
      fadeIn: 2,
      fadeOut: 2,
      loop: false,
    }

    act(() => {
      useEditorStore.setState({
        audioClips: [testClip],
        currentTime: 1.0, // Mid-fade-in: fadeInGain = 1.0/2.0 = 0.5; volume = 0.8 * 0.5 = 0.4
        isPlaying: true,
        volume: 0.5,
        isMuted: false,
      })
    })

    await act(async () => {
      root!.render(<AudioTimelinePreview />)
    })

    // Advance 80ms timer tick
    act(() => {
      vi.advanceTimersByTime(100)
    })

    // createMediaElementSource should have been called
    expect(virtualStudioStreamer.createMediaElementSource).toHaveBeenCalled()
    // Per-clip gain node created and connected to demoAudioBus
    expect(mockSourceNode.connect).toHaveBeenCalledWith(mockGainNode)
    expect(mockGainNode.connect).toHaveBeenCalledWith(mockDemoBus)

    // Gain value: clip.volume (0.8) * fadeIn (0.5) * master volume (0.5) = 0.2
    expect(mockGainNode.gain.value).toBeCloseTo(0.2, 3)
  })

  it('mutes gainNode when editor is muted', async () => {
    const testClip: AudioClip = {
      id: 'music-clip-2',
      name: 'Soundtrack 2',
      kind: 'music',
      filePath: '/media/soundtrack.mp3',
      startTime: 0,
      duration: 10,
      sourceStart: 0,
      sourceDuration: 10,
      speed: 1,
      volume: 1.0,
      fadeIn: 0,
      fadeOut: 0,
      loop: false,
    }

    act(() => {
      useEditorStore.setState({
        audioClips: [testClip],
        currentTime: 5.0,
        isPlaying: true,
        volume: 1.0,
        isMuted: true, // Master muted!
      })
    })

    await act(async () => {
      root!.render(<AudioTimelinePreview />)
    })

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(mockGainNode.gain.value).toBe(0)
  })

  it('sets gain to 0 and pauses audio when playback is paused', async () => {
    const testClip: AudioClip = {
      id: 'music-clip-3',
      name: 'Soundtrack 3',
      kind: 'music',
      filePath: '/media/soundtrack.mp3',
      startTime: 0,
      duration: 10,
      sourceStart: 0,
      sourceDuration: 10,
      speed: 1,
      volume: 1.0,
      fadeIn: 0,
      fadeOut: 0,
      loop: false,
    }

    act(() => {
      useEditorStore.setState({
        audioClips: [testClip],
        currentTime: 5.0,
        isPlaying: true,
      })
    })

    await act(async () => {
      root!.render(<AudioTimelinePreview />)
    })

    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(mockGainNode.gain.value).toBe(1.0)

    // Pause playback
    act(() => {
      useEditorStore.setState({ isPlaying: false })
      vi.advanceTimersByTime(100)
    })

    expect(mockGainNode.gain.value).toBe(0)
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled()
  })

  it('disconnects gainNode when clip is removed from timeline', async () => {
    const testClip: AudioClip = {
      id: 'music-clip-4',
      name: 'Soundtrack 4',
      kind: 'music',
      filePath: '/media/soundtrack.mp3',
      startTime: 0,
      duration: 10,
      sourceStart: 0,
      sourceDuration: 10,
      speed: 1,
      volume: 1.0,
      fadeIn: 0,
      fadeOut: 0,
      loop: false,
    }

    act(() => {
      useEditorStore.setState({
        audioClips: [testClip],
        currentTime: 5.0,
        isPlaying: true,
      })
    })

    await act(async () => {
      root!.render(<AudioTimelinePreview />)
    })

    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(mockSourceNode.connect).toHaveBeenCalled()

    // Remove clip from store
    act(() => {
      useEditorStore.setState({ audioClips: [] })
      vi.advanceTimersByTime(100)
    })

    expect(mockGainNode.disconnect).toHaveBeenCalled()
  })

  it('routes click sound effects into demoAudioBus when mouse clicks are triggered', async () => {
    const clickClip: AudioClip = {
      id: 'click-clip-1',
      name: 'Click',
      kind: 'click',
      filePath: 'default_mouse_click.mp3',
      startTime: 0.1,
      duration: 0.1,
      sourceStart: 0,
      sourceDuration: 0.1,
      speed: 1,
      volume: 1.0,
      fadeIn: 0,
      fadeOut: 0,
      loop: false,
    }

    act(() => {
      useEditorStore.setState({
        audioClips: [clickClip],
        mouseClickSoundsEnabled: true,
        mouseClickSoundVolume: 0.8,
        currentTime: 0.0,
        isPlaying: true,
        volume: 1.0,
        isMuted: false,
      })
    })

    await act(async () => {
      root!.render(<AudioTimelinePreview />)
    })

    // Advance time to 0.2s so click clip at 0.1s is triggered
    act(() => {
      useEditorStore.setState({ currentTime: 0.2 })
      vi.advanceTimersByTime(100)
    })

    // Fallback or buffer source should connect to demoAudioBus
    expect(mockDemoBus.connect).toBeDefined()
    expect(mockGainNode.connect).toHaveBeenCalledWith(mockDemoBus)
    expect(virtualStudioStreamer.getDemoAudioBus).toHaveBeenCalled()
  })

  it('plays click sounds located at timestamp 0.0 without dropping', async () => {
    const clickClip: AudioClip = {
      id: 'click-clip-zero',
      name: 'Click Zero',
      kind: 'click',
      filePath: 'default_mouse_click.mp3',
      startTime: 0.0,
      duration: 0.1,
      sourceStart: 0,
      sourceDuration: 0.1,
      speed: 1,
      volume: 1.0,
      fadeIn: 0,
      fadeOut: 0,
      loop: false,
    }

    act(() => {
      useEditorStore.setState({
        audioClips: [clickClip],
        mouseClickSoundsEnabled: true,
        mouseClickSoundVolume: 1.0,
        currentTime: 0.0,
        isPlaying: true,
        volume: 1.0,
        isMuted: false,
      })
    })

    await act(async () => {
      root!.render(<AudioTimelinePreview />)
    })

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(mockGainNode.connect).toHaveBeenCalledWith(mockDemoBus)
  })

  it('resumes suspended AudioContext when playback starts', async () => {
    const resumeSpy = vi.fn().mockResolvedValue(undefined)
    const suspendedContext = {
      ...mockAudioContext,
      state: 'suspended',
      resume: resumeSpy,
    }
    vi.spyOn(virtualStudioStreamer, 'getAudioContext').mockReturnValue(suspendedContext as unknown as AudioContext)

    act(() => {
      useEditorStore.setState({
        audioClips: [],
        isPlaying: true,
        currentTime: 0,
      })
    })

    await act(async () => {
      root!.render(<AudioTimelinePreview />)
    })

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(resumeSpy).toHaveBeenCalled()
  })
})
