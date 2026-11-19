// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { VirtualStudioMiniHud } from './VirtualStudioMiniHud'
import { useEditorStore } from '../../../store/editorStore'
import { initialVirtualStudioState } from '../../../store/slices/virtualStudioSlice'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(node: React.ReactElement): HTMLDivElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(node)
  })
  return container
}

describe('VirtualStudioMiniHud', () => {
  let previewFrameListener: ((dataUrl: string) => void) | null = null

  const mockVirtualStudio = {
    updateStatus: vi.fn(),
    triggerAction: vi.fn().mockImplementation((action: string) => {
      if (action === 'toggle-mirror') {
        useEditorStore.getState().toggleMirror()
      }
      if (action === 'toggle-audio-monitor') {
        useEditorStore.getState().toggleLocalAudioMonitoring()
      }
      return Promise.resolve({ success: true, action })
    }),
    onPreviewFrame: vi.fn().mockImplementation((callback: (dataUrl: string) => void) => {
      previewFrameListener = callback
      return () => {
        previewFrameListener = null
      }
    }),
  }

  beforeEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      value: { virtualStudio: mockVirtualStudio },
      configurable: true,
      writable: true,
    })

    act(() => {
      useEditorStore.setState({
        ...initialVirtualStudioState,
        isVirtualStudioActive: true,
        isMiniHudVisible: true,
        activeSource: 'canvas',
        isPlaying: false,
        isMicMuted: false,
      })
    })
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    container?.remove()
    container = null
    root = null
    act(() => {
      useEditorStore.setState({ ...initialVirtualStudioState })
    })
    vi.clearAllMocks()
  })

  it('renders nothing when virtual studio is inactive', () => {
    act(() => {
      useEditorStore.setState({ isVirtualStudioActive: false })
    })

    const el = render(<VirtualStudioMiniHud />)
    expect(el.querySelector('aside')).toBeNull()
  })

  it('renders nothing when mini-HUD is minimized', () => {
    act(() => {
      useEditorStore.setState({ isMiniHudVisible: false })
    })

    const el = render(<VirtualStudioMiniHud />)
    expect(el.querySelector('aside')).toBeNull()
  })

  it('renders mini-HUD with on-air badge and action controls', () => {
    const el = render(<VirtualStudioMiniHud />)
    const aside = el.querySelector('aside')
    expect(aside).not.toBeNull()
    expect(aside?.textContent).toContain('ON AIR')
    expect(aside?.textContent).toContain('Canvas')
    expect(aside?.textContent).toContain('Resume Demo')
    expect(aside?.textContent).toContain('Mic On')
  })

  it('minimizes when [-] button is clicked and shows toast', () => {
    const el = render(<VirtualStudioMiniHud />)
    const minimizeBtn = el.querySelector('button[aria-label="Minimize Mini-HUD"]') as HTMLButtonElement
    expect(minimizeBtn).not.toBeNull()

    act(() => {
      minimizeBtn.click()
    })

    expect(useEditorStore.getState().isMiniHudVisible).toBe(false)
    expect(mockVirtualStudio.updateStatus).toHaveBeenCalledWith({
      isMiniHudVisible: false,
    })

    const toasts = useEditorStore.getState().toasts
    expect(toasts.some((t) => t.message.includes('Mini-HUD minimized'))).toBe(true)
  })

  it('toggles playback when Play/Pause button is clicked', () => {
    const el = render(<VirtualStudioMiniHud />)
    const playBtn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Resume Demo'))
    expect(playBtn).toBeDefined()

    act(() => {
      playBtn?.click()
    })

    expect(useEditorStore.getState().isPlaying).toBe(true)
  })

  it('toggles microphone mute state', () => {
    const el = render(<VirtualStudioMiniHud />)
    const micBtn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Mic On'))
    expect(micBtn).toBeDefined()

    act(() => {
      micBtn?.click()
    })

    expect(useEditorStore.getState().isMicMuted).toBe(true)
  })

  it('toggles mirror state when mirror button is clicked', async () => {
    const el = render(<VirtualStudioMiniHud />)
    const mirrorBtn = el.querySelector('button[aria-label="Toggle Mirroring"]') as HTMLButtonElement
    expect(mirrorBtn).not.toBeNull()

    await act(async () => {
      mirrorBtn.click()
    })

    expect(mockVirtualStudio.triggerAction).toHaveBeenCalledWith('toggle-mirror')
    expect(useEditorStore.getState().isMirrored).toBe(true)
  })

  it('toggles audio monitoring state when audio monitor button is clicked', async () => {
    const el = render(<VirtualStudioMiniHud />)
    const monitorBtn = el.querySelector('button[aria-label="Toggle Local Audio Monitoring"]') as HTMLButtonElement
    expect(monitorBtn).not.toBeNull()

    await act(async () => {
      monitorBtn.click()
    })

    expect(mockVirtualStudio.triggerAction).toHaveBeenCalledWith('toggle-audio-monitor')
    expect(useEditorStore.getState().isLocalAudioMonitoringEnabled).toBe(false)
  })

  it('applies -scale-x-100 to fallback video element when isMirrored is true', () => {
    act(() => {
      useEditorStore.setState({
        activeSource: 'webcam',
        enableCamera: true,
        isMirrored: false,
      })
    })

    const el = render(<VirtualStudioMiniHud />)
    const videoBefore = el.querySelector('video')
    expect(videoBefore?.className).not.toContain('-scale-x-100')

    act(() => {
      useEditorStore.setState({ isMirrored: true })
    })

    const videoAfter = el.querySelector('video')
    expect(videoAfter?.className).toContain('-scale-x-100')
  })

  it('renders outgoing thumbnail image when preview frame arrives', () => {
    const el = render(<VirtualStudioMiniHud />)

    act(() => {
      previewFrameListener?.('data:image/jpeg;base64,mockframedata')
    })

    const img = el.querySelector('img[alt="Outgoing Feed"]') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.src).toBe('data:image/jpeg;base64,mockframedata')
  })

  it('toggles A/V lip sync panel and updates offset via slider and reset', () => {
    const el = render(<VirtualStudioMiniHud />)
    const syncBtn = el.querySelector('button[aria-label="Toggle A/V Lip Sync Settings"]') as HTMLButtonElement
    expect(syncBtn).not.toBeNull()

    // Panel is initially closed
    expect(el.textContent).not.toContain('A/V Lip Sync')

    // Click to open panel
    act(() => {
      syncBtn.click()
    })

    expect(el.textContent).toContain('A/V Lip Sync')
    expect(el.textContent).toContain('0 ms')

    // Set sync offset in store
    act(() => {
      useEditorStore.getState().setAvSyncOffsetMs(-120)
    })

    expect(el.textContent).toContain('-120ms')

    // Reset button should now be visible
    const resetBtn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Reset'))
    expect(resetBtn).toBeDefined()

    act(() => {
      resetBtn?.click()
    })

    expect(useEditorStore.getState().avSyncOffsetMs).toBe(0)
    expect(mockVirtualStudio.updateStatus).toHaveBeenCalledWith({ avSyncOffsetMs: 0 })
  })
})
