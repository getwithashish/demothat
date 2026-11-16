// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { VirtualStudioHeaderPill } from './VirtualStudioHeaderPill'
import { useEditorStore } from '../../../store/editorStore'
import { initialVirtualStudioState } from '../../../store/slices/virtualStudioSlice'

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

describe('VirtualStudioHeaderPill', () => {
  const mockVirtualStudio = {
    getStatus: vi.fn().mockImplementation(() => {
      const s = useEditorStore.getState()
      return Promise.resolve({
        cameraDriverInstalled: s.cameraDriverInstalled,
        micDriverInstalled: s.micDriverInstalled,
        isStreaming: s.isVirtualStudioActive,
        isCameraActive: s.enableCamera,
        isMicActive: s.enableMic,
        activeSource: s.activeSource,
        webcamDeviceId: s.selectedCameraId,
        micDeviceId: s.selectedMicId,
        isMicMuted: s.isMicMuted,
        isPlaying: s.isPlaying,
        isLocalAudioMonitoringEnabled: s.isLocalAudioMonitoringEnabled,
        localMonitoringVolume: s.localMonitoringVolume,
        isMiniHudVisible: s.isMiniHudVisible,
        error: s.studioError,
      })
    }),
    installDriver: vi.fn().mockResolvedValue({ success: true }),
    start: vi.fn().mockResolvedValue({ success: true }),
    stop: vi.fn().mockResolvedValue({ success: true }),
    updateStatus: vi.fn(),
    onStatusChange: vi.fn().mockReturnValue(() => {}),
    onTrayAction: vi.fn().mockReturnValue(() => {}),
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
        cameraDriverInstalled: true,
        micDriverInstalled: true,
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

  it('renders "Off" state badge when studio is inactive', async () => {
    const el = await renderAsync(<VirtualStudioHeaderPill />)
    const trigger = el.querySelector('#virtual-studio-pill-trigger')
    expect(trigger).not.toBeNull()
    expect(trigger?.textContent).toContain('Virtual Studio')
    expect(trigger?.textContent).toContain('Off')
  })

  it('renders "On Air: Webcam" when streaming from webcam', async () => {
    act(() => {
      useEditorStore.setState({
        isVirtualStudioActive: true,
        activeSource: 'webcam',
      })
    })

    const el = await renderAsync(<VirtualStudioHeaderPill />)
    expect(el.textContent).toContain('On Air: Webcam')
  })

  it('renders "On Air: Canvas Preview" when streaming from canvas', async () => {
    act(() => {
      useEditorStore.setState({
        isVirtualStudioActive: true,
        activeSource: 'canvas',
      })
    })

    const el = await renderAsync(<VirtualStudioHeaderPill />)
    expect(el.textContent).toContain('On Air: Canvas Preview')
  })

  it('opens configuration popover when pill is clicked', async () => {
    const el = await renderAsync(<VirtualStudioHeaderPill />)
    const trigger = el.querySelector('#virtual-studio-pill-trigger') as HTMLButtonElement

    act(() => {
      trigger.click()
    })

    const popover = el.querySelector('[role="dialog"]')
    expect(popover).not.toBeNull()
    expect(popover?.textContent).toContain('Virtual Studio')
    expect(popover?.textContent).toContain('Broadcast live to Zoom, Meet & OBS')
    expect(popover?.textContent).toContain('Output Channels')
  })

  it('shows driver installation prompt when drivers are missing', async () => {
    act(() => {
      useEditorStore.setState({
        cameraDriverInstalled: false,
        micDriverInstalled: false,
      })
    })

    const el = await renderAsync(<VirtualStudioHeaderPill />)
    const trigger = el.querySelector('#virtual-studio-pill-trigger') as HTMLButtonElement

    act(() => {
      trigger.click()
    })

    expect(el.textContent).toContain('Virtual Drivers Required')
    expect(el.textContent).toContain('Authorize Virtual Drivers')

    const installBtn = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Authorize Virtual Drivers'),
    )
    expect(installBtn).toBeDefined()

    await act(async () => {
      installBtn?.click()
    })

    expect(mockVirtualStudio.installDriver).toHaveBeenCalled()
  })

  it('toggles virtual studio on and off via master switch', async () => {
    const el = await renderAsync(<VirtualStudioHeaderPill />)
    const trigger = el.querySelector('#virtual-studio-pill-trigger') as HTMLButtonElement

    act(() => {
      trigger.click()
    })

    const masterSwitch = el.querySelector('#virtual-studio-master-switch') as HTMLButtonElement
    expect(masterSwitch).not.toBeNull()

    await act(async () => {
      masterSwitch.click()
    })

    expect(useEditorStore.getState().isVirtualStudioActive).toBe(true)
    expect(useEditorStore.getState().isMiniHudVisible).toBe(true)
  })
})
