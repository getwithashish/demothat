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
        isMirrored: s.isMirrored,
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

  it('toggles mirror output switch in popover', async () => {
    const el = await renderAsync(<VirtualStudioHeaderPill />)
    const trigger = el.querySelector('#virtual-studio-pill-trigger') as HTMLButtonElement

    act(() => {
      trigger.click()
    })

    const mirrorSwitch = el.querySelector('#vs-mirror-switch') as HTMLButtonElement
    expect(mirrorSwitch).not.toBeNull()

    await act(async () => {
      mirrorSwitch.click()
    })

    expect(useEditorStore.getState().isMirrored).toBe(true)
    expect(mockVirtualStudio.updateStatus).toHaveBeenCalledWith({ isMirrored: true })
  })

  it('displays clarified audio monitor label and toggles local audio monitoring switch', async () => {
    const el = await renderAsync(<VirtualStudioHeaderPill />)
    const trigger = el.querySelector('#virtual-studio-pill-trigger') as HTMLButtonElement

    act(() => {
      trigger.click()
    })

    expect(el.textContent).toContain('Mute your speakers so only meeting attendees hear demo audio')

    const audioSwitch = el.querySelector('#vs-audio-monitor-switch') as HTMLButtonElement
    expect(audioSwitch).not.toBeNull()

    await act(async () => {
      audioSwitch.click()
    })

    expect(useEditorStore.getState().isLocalAudioMonitoringEnabled).toBe(false)
    expect(mockVirtualStudio.updateStatus).toHaveBeenCalledWith({ isLocalAudioMonitoringEnabled: false })
  })

  it('renders A/V lip sync section in popover and handles offset updates and reset', async () => {
    const el = await renderAsync(<VirtualStudioHeaderPill />)
    const trigger = el.querySelector('#virtual-studio-pill-trigger') as HTMLButtonElement

    act(() => {
      trigger.click()
    })

    expect(el.textContent).toContain('A/V Lip Sync')
    expect(el.textContent).toContain('Adjust if voice and lips are out of sync')

    // Change sync offset in store to +150ms
    act(() => {
      useEditorStore.getState().setAvSyncOffsetMs(150)
    })

    expect(el.textContent).toContain('+150ms (Video)')
    expect(el.textContent).toContain('Delays video so late audio stays in sync')

    // Reset button should now be visible
    const resetBtn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Reset'))
    expect(resetBtn).toBeDefined()

    await act(async () => {
      resetBtn?.click()
    })

    expect(useEditorStore.getState().avSyncOffsetMs).toBe(0)
    expect(mockVirtualStudio.updateStatus).toHaveBeenCalledWith({ avSyncOffsetMs: 0 })

    // Clicking quick preset button (+500ms) sets offset directly and commits to IPC
    mockVirtualStudio.updateStatus.mockClear()
    const preset500Btn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === '+500ms')
    expect(preset500Btn).toBeDefined()
    await act(async () => {
      preset500Btn?.click()
    })
    expect(useEditorStore.getState().avSyncOffsetMs).toBe(500)
    expect(mockVirtualStudio.updateStatus).toHaveBeenCalledWith({ avSyncOffsetMs: 500 })

    // Clicking nudge button (+100ms) increases offset to 600ms
    mockVirtualStudio.updateStatus.mockClear()
    const nudgePlusBtn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === '+100ms')
    expect(nudgePlusBtn).toBeDefined()
    await act(async () => {
      nudgePlusBtn?.click()
    })
    expect(useEditorStore.getState().avSyncOffsetMs).toBe(600)
    expect(mockVirtualStudio.updateStatus).toHaveBeenCalledWith({ avSyncOffsetMs: 600 })
  })
})
