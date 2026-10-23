// @vitest-environment jsdom
//
// Tidy up: the detector, wired to the store.
//
// The detector itself is tested where it lives. What is tested here is the wiring —
// that the silences come from the recording's own audio, that the user's existing
// regions are left alone, and that a recording with no audio is not guessed at.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const detectSilence = vi.hoisted(() => vi.fn())
const detectActivity = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({ ipcRenderer: { invoke: vi.fn(), on: vi.fn(), send: vi.fn() } }))

import { useEditorStore } from '../editorStore'

const silence = (start: number, end: number) => ({ start, end, duration: end - start })

beforeEach(() => {
  detectSilence.mockReset()
  detectSilence.mockResolvedValue([])
  detectActivity.mockReset()
  detectActivity.mockResolvedValue([])
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { detectSilence, detectActivity }
  useEditorStore.setState({ videoPath: '/recordings/one.mp4', duration: 20, speedRegions: {}, isDirty: false })
})

describe('tidyUp', () => {
  it('adds a region over each silence the audio reports', async () => {
    detectSilence.mockResolvedValue([silence(2, 6), silence(10, 14)])

    const result = await useEditorStore.getState().tidyUp()

    expect(result).toEqual({ added: 2, suggested: 2 })
    const regions = Object.values(useEditorStore.getState().speedRegions)
    expect(regions).toHaveLength(2)
    // Padded at both ends, and sped up.
    expect(regions[0]?.startTime).toBeCloseTo(2.25, 6)
    expect(regions[0]?.speed).toBe(2)
  })

  it('asks the recording for its silences, not some other file', async () => {
    await useEditorStore.getState().tidyUp()

    expect(detectSilence).toHaveBeenCalledWith('/recordings/one.mp4')
  })

  it('leaves the user’s own region alone', async () => {
    // A region the user placed over a stretch that is also silent: theirs is a
    // decision and this is a suggestion.
    detectSilence.mockResolvedValue([silence(2, 6)])
    useEditorStore.setState({
      speedRegions: {
        mine: { id: 'mine', type: 'speed', startTime: 3, duration: 2, speed: 1.5, zIndex: 0 },
      },
    })

    const result = await useEditorStore.getState().tidyUp()

    expect(result).toEqual({ added: 0, suggested: 1 })
    expect(Object.keys(useEditorStore.getState().speedRegions)).toEqual(['mine'])
  })

  it('adds the stretches the user has not touched', async () => {
    detectSilence.mockResolvedValue([silence(2, 6), silence(12, 16)])
    useEditorStore.setState({
      speedRegions: {
        mine: { id: 'mine', type: 'speed', startTime: 2, duration: 4, speed: 1.5, zIndex: 0 },
      },
    })

    const result = await useEditorStore.getState().tidyUp()

    expect(result).toEqual({ added: 1, suggested: 2 })
    expect(Object.values(useEditorStore.getState().speedRegions)).toHaveLength(2)
  })

  it('marks the project dirty, because it changed it', async () => {
    detectSilence.mockResolvedValue([silence(2, 6)])

    await useEditorStore.getState().tidyUp()

    expect(useEditorStore.getState().isDirty).toBe(true)
  })

  it('adds nothing when the audio has no silence worth speeding up', async () => {
    detectSilence.mockResolvedValue([silence(2, 2.5)])

    const result = await useEditorStore.getState().tidyUp()

    expect(result).toEqual({ added: 0, suggested: 0 })
    expect(Object.keys(useEditorStore.getState().speedRegions)).toEqual([])
  })

  it('guesses nothing when the recording’s audio cannot be read', async () => {
    // A speed change over material the viewer was watching is worse than no speed
    // change at all.
    detectSilence.mockRejectedValue(new Error('ffmpeg is not happy'))

    const result = await useEditorStore.getState().tidyUp()

    expect(result).toEqual({ added: 0, suggested: 0 })
    expect(Object.keys(useEditorStore.getState().speedRegions)).toEqual([])
  })

  it('does nothing for a recording that has not been loaded', async () => {
    useEditorStore.setState({ videoPath: null, duration: 0 })

    const result = await useEditorStore.getState().tidyUp()

    expect(result).toEqual({ added: 0, suggested: 0 })
    expect(detectSilence).not.toHaveBeenCalled()
  })

  it('uses the picture when the audio has nothing to say', async () => {
    // Nobody is speaking, so there is no silence — but the screen is not moving
    // either, which is the typing and the spinner case.
    detectSilence.mockResolvedValue([])
    detectActivity.mockResolvedValue([
      { time: 0, activity: 0.5 },
      { time: 1, activity: 0.001 },
      { time: 2, activity: 0.002 },
      { time: 3, activity: 0.001 },
      { time: 4, activity: 0.5 },
    ])

    const result = await useEditorStore.getState().tidyUp()

    expect(result.added).toBe(1)
    expect(detectActivity).toHaveBeenCalledWith('/recordings/one.mp4')
  })

  it('still uses the audio when the picture cannot be measured', async () => {
    // The two halves are independent: losing one does not lose the other.
    detectSilence.mockResolvedValue([silence(2, 6)])
    detectActivity.mockRejectedValue(new Error('ffmpeg is not happy'))

    const result = await useEditorStore.getState().tidyUp()

    expect(result.added).toBe(1)
  })

  it('does not propose the same stretch twice when both halves find it', async () => {
    detectSilence.mockResolvedValue([silence(2, 6)])
    detectActivity.mockResolvedValue([
      { time: 0, activity: 0.5 },
      { time: 1, activity: 0.5 },
      { time: 2, activity: 0.001 },
      { time: 3, activity: 0.001 },
      { time: 4, activity: 0.001 },
      { time: 5, activity: 0.001 },
      { time: 6, activity: 0.5 },
    ])

    const result = await useEditorStore.getState().tidyUp()

    expect(result).toEqual({ added: 1, suggested: 1 })
  })
})
