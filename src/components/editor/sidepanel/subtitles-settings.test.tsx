// @vitest-environment jsdom
/**
 * The Captions panel, and the pipeline it drives.
 *
 * The point of these tests is the part that is easy to get subtly wrong: the transcript
 * a transcription produces is stored in the project unchanged, and the captions are
 * *derived* from it. So turning filler removal on and off must give two different sets
 * of captions from the same transcript, with no re-upload and nothing lost — and the
 * cues that come out must be on the export's timeline, in export time.
 */

import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SubtitlesSettings } from './SubtitlesSettings'
import { useEditorStore } from '../../../store/editorStore'
import type { TranscriptDocument } from '../../../../shared/transcript'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

async function render(node: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(node)
  })
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.restoreAllMocks()
})

/** A transcript with word timings, including two hesitations and a stutter. */
const transcript: TranscriptDocument = {
  version: 1,
  language: 'en',
  model: 'large-v3',
  durationSec: 12,
  segments: [
    {
      start: 0,
      end: 4,
      text: 'So um this is the um dashboard',
      words: [
        { start: 0, end: 0.3, text: 'So' },
        { start: 0.3, end: 0.6, text: ' um' },
        { start: 0.6, end: 0.9, text: ' this' },
        { start: 0.9, end: 1.2, text: ' is' },
        { start: 1.2, end: 1.5, text: ' the' },
        { start: 1.5, end: 1.8, text: ' um' },
        { start: 1.8, end: 2.4, text: ' dashboard' },
      ],
    },
    {
      start: 5,
      end: 9,
      text: 'I I think it works',
      words: [
        { start: 5, end: 5.4, text: 'I' },
        { start: 5.4, end: 5.8, text: ' I' },
        { start: 5.8, end: 6.4, text: ' think' },
        { start: 6.4, end: 6.8, text: ' it' },
        { start: 6.8, end: 7.4, text: ' works' },
      ],
    },
  ],
}

const startTranscription = vi.fn(async () => ({
  ok: true as const,
  transcriptPath: '/tmp/transcript.json',
  transcript,
  charge: 12,
  refund: 0,
  audioSeconds: 30,
}))

beforeEach(() => {
  startTranscription.mockClear()
  Object.defineProperty(window, 'electronAPI', {
    value: {
      transcribeStatus: vi.fn(async () => ({
        configured: true,
        transcription: { enabled: true, creditsPerMinute: 24, models: ['large-v3'], maxAudioSeconds: 900 },
        error: null,
      })),
      onTranscribeProgress: () => () => undefined,
      startTranscription,
      cancelTranscription: vi.fn(),
    },
    configurable: true,
    writable: true,
  })

  useEditorStore.setState({
    transcript: null,
    subtitleCues: [],
    subtitlesEnabled: true,
    subtitleFormat: 'srt',
    videoPath: '/tmp/recording.mp4',
    // 12 seconds in, 2 seconds cut out at the start: every caption shifts back by 2.
    duration: 12,
    // The real CutRegion shape: startTime + duration. A cut of the first two seconds.
    cutRegions: { cut1: { id: 'cut1', type: 'cut', startTime: 0, duration: 2, zIndex: 0 } },
    speedRegions: {},
  } as never)
})

async function click(element: Element | null | undefined): Promise<void> {
  expect(element).toBeTruthy()
  await act(async () => {
    element!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function buttonByText(host: HTMLElement, text: string): Element | undefined {
  return [...host.querySelectorAll('button')].find((button) =>
    (button.textContent ?? '').trim().startsWith(text),
  )
}

/** The captions currently in the store. */
function cues() {
  return useEditorStore.getState().subtitleCues
}

describe('SubtitlesSettings', () => {
  it('offers to transcribe, and says what it costs and that it is charged once', async () => {
    const host = await render(<SubtitlesSettings />)
    expect(host.textContent).toContain('Transcribe this recording')
    expect(host.textContent).toContain('24 credits per minute')
    expect(host.textContent).toContain('charged once')
    // Nothing to configure before there is a transcript.
    expect(host.textContent).not.toContain('Filler words')
  })

  it('refuses to offer it when the device is not activated', async () => {
    ;(window.electronAPI.transcribeStatus as unknown as ReturnType<typeof vi.fn>) = vi.fn(async () => ({
      configured: false,
      transcription: null,
      error: null,
    }))
    const host = await render(<SubtitlesSettings />)
    expect(host.textContent).toContain('not activated')
    expect(buttonByText(host, 'Transcribe this recording')?.hasAttribute('disabled')).toBe(true)
  })

  it('transcribes, stores the transcript, and lands captions on the export timeline', async () => {
    const host = await render(<SubtitlesSettings />)
    await click(buttonByText(host, 'Transcribe this recording'))

    expect(startTranscription).toHaveBeenCalledWith({ sourcePath: '/tmp/recording.mp4' })
    // The transcript is the project's, stored whole.
    expect(useEditorStore.getState().transcript?.segments).toHaveLength(2)
    expect(host.textContent).toContain('Transcribed: 2 segments, en')
    expect(host.textContent).toContain('12 credits charged for 30s of audio')

    // Captions were derived, in export time: the first segment starts at source 0 and
    // the 2-second cut at the head of the timeline moves it back to export 0, while
    // the second segment (source 5s) becomes 3s.
    expect(cues().length).toBeGreaterThan(0)
    const starts = cues().map((cue) => cue.start)
    expect(starts[0]).toBe(0)
    expect(Math.min(...starts.filter((start) => start > 0))).toBe(3)
  })

  it('removes filler words from the captions, and says how many', async () => {
    const host = await render(<SubtitlesSettings />)
    await click(buttonByText(host, 'Transcribe this recording'))

    // On by default, so the hesitations are already gone from the captions.
    const text = cues().map((cue) => cue.text).join(' ')
    expect(text).toContain('So this is the dashboard')
    expect(text.toLowerCase()).not.toContain('um')
    expect(host.textContent).toContain('2 filler words removed from the captions')
    // The transcript itself kept them: the removal is a view, not an edit.
    expect(useEditorStore.getState().transcript?.segments[0]?.text).toContain('um')
  })

  it('gives the words back when the removal is turned off, with nothing re-uploaded', async () => {
    const host = await render(<SubtitlesSettings />)
    await click(buttonByText(host, 'Transcribe this recording'))
    const callsAfterTranscribing = startTranscription.mock.calls.length

    // The toggle is the switch inside the "Remove filler words" row.
    const toggle = host.querySelector('#strip-fillers')
    expect(toggle).toBeTruthy()
    await act(async () => {
      toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const text = cues().map((cue) => cue.text).join(' ')
    expect(text.toLowerCase()).toContain('um')
    expect(text).toContain('So um this is the um dashboard')
    expect(host.textContent).toContain('keep every word')
    // Free and instant: no second transcription.
    expect(startTranscription).toHaveBeenCalledTimes(callsAfterTranscribing)
  })

  it('collapses stutters only when asked', async () => {
    const host = await render(<SubtitlesSettings />)
    await click(buttonByText(host, 'Transcribe this recording'))
    expect(cues().map((cue) => cue.text).join(' ')).toContain('I I think')

    const stutterToggle = host.querySelector('#drop-stutters')
    await act(async () => {
      stutterToggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(cues().map((cue) => cue.text).join(' ')).toContain('I think')
  })

  it('lets a cue be reworded and deleted', async () => {
    const host = await render(<SubtitlesSettings />)
    await click(buttonByText(host, 'Transcribe this recording'))

    const first = cues()[0]!
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set
      setter?.call(textarea, 'A reworded caption')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(cues().find((cue) => cue.id === first.id)?.text).toBe('A reworded caption')

    const before = cues().length
    await click(host.querySelector('button[aria-label="Delete caption 1"]'))
    expect(cues()).toHaveLength(before - 1)
  })

  it('keeps the captions and the sidecar controls together', async () => {
    const host = await render(<SubtitlesSettings />)
    await click(buttonByText(host, 'Transcribe this recording'))

    expect(host.textContent).toContain('Write captions with the export')
    expect(host.textContent).toContain('SubRip')
    expect(host.textContent).toContain('captions on the timeline')

    const enabledToggle = host.querySelector('#subtitles-enabled')
    await act(async () => {
      enabledToggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(useEditorStore.getState().subtitlesEnabled).toBe(false)
  })

  it('says so when there is nothing to transcribe', async () => {
    useEditorStore.setState({ videoPath: null } as never)
    const host = await render(<SubtitlesSettings />)
    expect(host.textContent).toContain('Open a recording to transcribe it')
  })

  it('reports a refused transcription instead of silently doing nothing', async () => {
    ;(window.electronAPI.startTranscription as unknown) = vi.fn(async () => ({
      ok: false as const,
      reason: 'rejected' as const,
      error: 'There were not enough credits to transcribe this recording.',
    }))
    const host = await render(<SubtitlesSettings />)
    await click(buttonByText(host, 'Transcribe this recording'))

    expect(host.textContent).toContain('not enough credits')
    expect(useEditorStore.getState().transcript).toBeNull()
  })
})
