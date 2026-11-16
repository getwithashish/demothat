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
  const mockVirtualStudio = {
    updateStatus: vi.fn(),
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
})
