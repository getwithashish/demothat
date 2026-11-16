import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockTrayInstance, mockBuildFromTemplate } = vi.hoisted(() => ({
  mockTrayInstance: {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    popUpContextMenu: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
  },
  mockBuildFromTemplate: vi.fn((items: unknown) => items),
}))

vi.mock('electron', () => {
  return {
    Tray: vi.fn().mockImplementation(() => mockTrayInstance),
    Menu: {
      buildFromTemplate: mockBuildFromTemplate,
    },
    nativeImage: {
      createFromPath: vi.fn().mockReturnValue({
        isEmpty: () => false,
        resize: vi.fn().mockReturnValue({}),
      }),
      createEmpty: vi.fn().mockReturnValue({}),
    },
    app: {
      isPackaged: false,
    },
  }
})

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import { VirtualStudioTray } from './virtual-studio-tray'

describe('VirtualStudioTray', () => {
  let tray: VirtualStudioTray
  let onAction: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    tray = new VirtualStudioTray()
    onAction = vi.fn()
  })

  it('initializes tray with default tooltip and listeners', () => {
    tray.init({ onAction })
    expect(tray.isCreated()).toBe(true)
    expect(mockTrayInstance.setToolTip).toHaveBeenCalledWith('DemoThat Virtual Studio')

    // Expect 'click' and 'right-click' listeners to be registered
    expect(mockTrayInstance.on).toHaveBeenCalledWith('click', expect.any(Function))
    expect(mockTrayInstance.on).toHaveBeenCalledWith('right-click', expect.any(Function))
  })

  it('triggers toggle-playback on left-click', () => {
    tray.init({ onAction })

    // Find the 'click' listener registered
    const clickHandler = mockTrayInstance.on.mock.calls.find((call) => call[0] === 'click')?.[1]
    expect(clickHandler).toBeDefined()

    // Trigger click
    clickHandler()
    expect(onAction).toHaveBeenCalledWith('toggle-playback')
  })

  it('updates tooltip and menu items when state changes', () => {
    tray.init({ onAction })

    tray.updateState({
      isPlaying: true,
      isMicMuted: false,
      isMiniHudVisible: true,
    })

    expect(mockTrayInstance.setToolTip).toHaveBeenCalledWith(expect.stringContaining('Canvas Preview (Playing)'))

    // Check menu items generated
    const template = mockBuildFromTemplate.mock.results[mockBuildFromTemplate.mock.results.length - 1].value as Array<{
      label?: string
      click?: () => void
    }>
    expect(template[0].label).toContain('Pause Playback')
    expect(template[1].label).toContain('Mute Microphone')
    expect(template[2].label).toContain('Hide Mini-HUD')

    // Trigger menu click
    template[0].click?.()
    expect(onAction).toHaveBeenCalledWith('toggle-playback')

    template[1].click?.()
    expect(onAction).toHaveBeenCalledWith('toggle-mic-mute')

    template[2].click?.()
    expect(onAction).toHaveBeenCalledWith('toggle-hud')

    template[4].click?.() // Stop Studio item
    expect(onAction).toHaveBeenCalledWith('stop-studio')
  })

  it('destroys tray properly', () => {
    tray.init({ onAction })
    expect(tray.isCreated()).toBe(true)

    tray.destroy()
    expect(mockTrayInstance.destroy).toHaveBeenCalled()
    expect(tray.isCreated()).toBe(false)
  })

  describe('Edge Cases & State Combinations', () => {
    it('handles updateState safely before init() is called', () => {
      expect(() => {
        tray.updateState({ isPlaying: true })
      }).not.toThrow()
    })

    it('handles destroy safely when not initialized or called repeatedly', () => {
      expect(() => {
        tray.destroy()
        tray.destroy()
      }).not.toThrow()
    })

    it('handles right-click event and pops up context menu', () => {
      tray.init({ onAction })

      const rightClickHandler = mockTrayInstance.on.mock.calls.find((call) => call[0] === 'right-click')?.[1]
      expect(rightClickHandler).toBeDefined()

      rightClickHandler()
      expect(mockTrayInstance.popUpContextMenu).toHaveBeenCalled()
    })

    it('updates labels correctly when paused, mic muted, and mini-HUD hidden', () => {
      tray.init({ onAction })

      tray.updateState({
        isPlaying: false,
        isMicMuted: true,
        isMiniHudVisible: false,
      })

      expect(mockTrayInstance.setToolTip).toHaveBeenCalledWith(
        expect.stringContaining('Webcam (Idle/Paused) | Mic: Muted'),
      )

      const template = mockBuildFromTemplate.mock.results[mockBuildFromTemplate.mock.results.length - 1]
        .value as Array<{
        label?: string
        click?: () => void
      }>
      expect(template[0].label).toContain('Resume Playback')
      expect(template[1].label).toContain('Unmute Microphone')
      expect(template[2].label).toContain('Show Mini-HUD')
    })

    it('re-initializes cleanly without recreating Tray instance if already created', () => {
      tray.init({ onAction })
      expect(tray.isCreated()).toBe(true)

      const secondOnAction = vi.fn()
      tray.init({ onAction: secondOnAction })
      expect(tray.isCreated()).toBe(true)
    })
  })
})
