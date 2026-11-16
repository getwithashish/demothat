// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MiniHudPage } from './MiniHudPage'
import type { VirtualStudioStatus, TrayQuickAction } from '../../shared/virtual-camera-types'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

async function renderAsync(node: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(node)
    await Promise.resolve()
  })
  return container
}

describe('MiniHudPage', () => {
  let statusListener: ((status: VirtualStudioStatus) => void) | null = null
  let previewFrameListener: ((dataUrl: string) => void) | null = null

  const mockVirtualStudio = {
    getStatus: vi.fn().mockResolvedValue({
      cameraDriverInstalled: true,
      micDriverInstalled: true,
      isStreaming: true,
      isCameraActive: true,
      isMicActive: true,
      activeSource: 'webcam',
      webcamDeviceId: null,
      micDeviceId: null,
      isMicMuted: false,
      isPlaying: false,
      isLocalAudioMonitoringEnabled: true,
      localMonitoringVolume: 1.0,
      isMiniHudVisible: true,
      error: null,
    }),
    triggerAction: vi.fn().mockImplementation((action: TrayQuickAction) => {
      return Promise.resolve({ success: true, action })
    }),
    updateStatus: vi.fn(),
    onStatusChange: vi.fn().mockImplementation((callback: (status: VirtualStudioStatus) => void) => {
      statusListener = callback
      return () => {
        statusListener = null
      }
    }),
    onPreviewFrame: vi.fn().mockImplementation((callback: (dataUrl: string) => void) => {
      previewFrameListener = callback
      return () => {
        previewFrameListener = null
      }
    }),
    onTrayAction: vi.fn().mockReturnValue(() => {}),
  }

  beforeEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      value: { virtualStudio: mockVirtualStudio },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    container?.remove()
    container = null
    root = null
    statusListener = null
    vi.clearAllMocks()
    document.documentElement.removeAttribute('data-surface')
  })

  it('sets data-surface="mini-hud" on documentElement on mount', async () => {
    await renderAsync(<MiniHudPage />)
    expect(document.documentElement.getAttribute('data-surface')).toBe('mini-hud')
  })

  it('renders ON AIR badge, source badge, and action buttons', async () => {
    const el = await renderAsync(<MiniHudPage />)
    expect(el.textContent).toContain('ON AIR')
    expect(el.textContent).toContain('Webcam')
    expect(el.textContent).toContain('Resume Demo')
    expect(el.textContent).toContain('Mic On')
  })

  it('triggers toggle-hud action when minimize [-] button is clicked', async () => {
    const el = await renderAsync(<MiniHudPage />)
    const minBtn = el.querySelector('button[aria-label="Minimize Mini-HUD"]') as HTMLButtonElement
    expect(minBtn).not.toBeNull()

    await act(async () => {
      minBtn.click()
    })

    expect(mockVirtualStudio.triggerAction).toHaveBeenCalledWith('toggle-hud')
  })

  it('triggers toggle-playback action when Play/Pause button is clicked', async () => {
    const el = await renderAsync(<MiniHudPage />)
    const playBtn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Resume Demo'))
    expect(playBtn).toBeDefined()

    await act(async () => {
      playBtn?.click()
    })

    expect(mockVirtualStudio.triggerAction).toHaveBeenCalledWith('toggle-playback')
  })

  it('triggers toggle-mic-mute action when Mic button is clicked', async () => {
    const el = await renderAsync(<MiniHudPage />)
    const micBtn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Mic On'))
    expect(micBtn).toBeDefined()

    await act(async () => {
      micBtn?.click()
    })

    expect(mockVirtualStudio.triggerAction).toHaveBeenCalledWith('toggle-mic-mute')
  })

  it('updates UI reactively when onStatusChange fires', async () => {
    const el = await renderAsync(<MiniHudPage />)
    expect(el.textContent).toContain('Webcam')
    expect(el.textContent).toContain('Resume Demo')

    await act(async () => {
      statusListener?.({
        cameraDriverInstalled: true,
        micDriverInstalled: true,
        isStreaming: true,
        isCameraActive: true,
        isMicActive: true,
        activeSource: 'canvas',
        webcamDeviceId: null,
        micDeviceId: null,
        isMicMuted: true,
        isPlaying: true,
        isLocalAudioMonitoringEnabled: true,
        localMonitoringVolume: 1.0,
        isMiniHudVisible: true,
        error: null,
      })
    })

    expect(el.textContent).toContain('Canvas')
    expect(el.textContent).toContain('Pause Demo')
    expect(el.textContent).toContain('Muted')
  })

  it('renders outgoing thumbnail image when preview frame arrives', async () => {
    const el = await renderAsync(<MiniHudPage />)

    await act(async () => {
      previewFrameListener?.('data:image/jpeg;base64,mockframedata')
    })

    const img = el.querySelector('img[alt="Outgoing Feed"]') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.src).toBe('data:image/jpeg;base64,mockframedata')
  })
})
