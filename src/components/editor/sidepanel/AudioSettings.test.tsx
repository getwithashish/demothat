// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AudioSettings } from './AudioSettings'
import { useEditorStore } from '../../../store/editorStore'
import {
  DEFAULT_AV_SYNC_OFFSET_MS,
  DEFAULT_WEBCAM_MIC_AV_SYNC_OFFSET_MS,
} from '../../../../shared/virtual-camera-types'

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

beforeEach(() => {
  Object.defineProperty(window, 'electronAPI', {
    value: {
      detectSilence: vi.fn(() => Promise.resolve([])),
      openAudioFile: vi.fn(() => Promise.resolve({ canceled: true })),
      showMessageBox: vi.fn(),
    },
    configurable: true,
    writable: true,
  })
  useEditorStore.setState({
    volume: 1,
    isMuted: false,
    hasAudioTrack: true,
    webcamVideoUrl: 'media:///tmp/webcam.mp4',
    avSyncOffsetMs: DEFAULT_WEBCAM_MIC_AV_SYNC_OFFSET_MS,
    syncOffset: DEFAULT_WEBCAM_MIC_AV_SYNC_OFFSET_MS,
    duration: 10,
    videoPath: '/tmp/screen.mp4',
    audioClips: [],
    selectedRegionId: null,
  })
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('AudioSettings A/V Lip Sync UI', () => {
  it('renders A/V Lip Sync section with badge and presets under Original audio', async () => {
    const el = await render(<AudioSettings />)
    expect(el.textContent).toContain('Original audio')
    expect(el.textContent).toContain('A/V Lip Sync')
    expect(el.textContent).toContain('+250ms (Video delay)')
    expect(el.textContent).toContain('Presets:')
    expect(el.textContent).toContain('0ms')
    expect(el.textContent).toContain('+250ms')
    expect(el.textContent).toContain('+500ms')
    expect(el.textContent).toContain('+1000ms')
    expect(el.textContent).toContain('+1500ms')
    expect(el.textContent).toContain('+2000ms')
    expect(el.textContent).toContain('Nudge:')
    expect(el.textContent).toContain('-100ms')
    expect(el.textContent).toContain('+100ms')
  })

  it('clicking a preset chip updates avSyncOffsetMs', async () => {
    const el = await render(<AudioSettings />)
    const preset500Btn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === '+500ms')
    expect(preset500Btn).toBeDefined()

    await act(async () => {
      preset500Btn!.click()
    })

    expect(useEditorStore.getState().avSyncOffsetMs).toBe(500)
    expect(useEditorStore.getState().syncOffset).toBe(500)
  })

  it('clicking nudge buttons shifts offset by 100ms', async () => {
    useEditorStore.setState({ avSyncOffsetMs: 250, syncOffset: 250 })
    const el = await render(<AudioSettings />)

    const nudgePlusBtn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === '+100ms')
    const nudgeMinusBtn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === '-100ms')
    expect(nudgePlusBtn).toBeDefined()
    expect(nudgeMinusBtn).toBeDefined()

    await act(async () => {
      nudgePlusBtn!.click()
    })
    expect(useEditorStore.getState().avSyncOffsetMs).toBe(350)

    await act(async () => {
      nudgeMinusBtn!.click()
    })
    expect(useEditorStore.getState().avSyncOffsetMs).toBe(250)
  })

  it('clicking Reset button returns offset to default', async () => {
    // Offset modified to 500ms when default is 250ms (webcam + mic)
    useEditorStore.setState({
      avSyncOffsetMs: 500,
      syncOffset: 500,
      webcamVideoUrl: 'media:///tmp/webcam.mp4',
      hasAudioTrack: true,
    })
    const el = await render(<AudioSettings />)

    const resetBtn = Array.from(el.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Reset lip sync offset',
    )
    expect(resetBtn).toBeDefined()

    await act(async () => {
      resetBtn!.click()
    })
    expect(useEditorStore.getState().avSyncOffsetMs).toBe(DEFAULT_WEBCAM_MIC_AV_SYNC_OFFSET_MS)
  })

  it('renders neutral helper text and no badge when offset is 0ms', async () => {
    useEditorStore.setState({
      avSyncOffsetMs: DEFAULT_AV_SYNC_OFFSET_MS,
      syncOffset: DEFAULT_AV_SYNC_OFFSET_MS,
    })
    const el = await render(<AudioSettings />)

    expect(el.textContent).toContain('Audio and video play in default sync')
    expect(el.textContent).not.toContain('(Video delay)')
    expect(el.textContent).not.toContain('(Audio delay)')
  })
})
