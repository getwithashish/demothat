// @vitest-environment jsdom
import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { VisualEffectsSettings } from './VisualEffectsSettings'
import { SidePanel } from '../SidePanel'
import { useEditorStore } from '../../../store/editorStore'
import type { VisualEffectRegion } from '../../../types'

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

function setInputValue(input: HTMLInputElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  nativeInputValueSetter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

const mockEffect: VisualEffectRegion = {
  id: 'fx-test-1',
  kind: 'blur',
  shape: 'rectangle',
  startTime: 1.5,
  duration: 3.0,
  x: 0.2,
  y: 0.3,
  width: 0.4,
  height: 0.25,
  points: [],
  color: '#38bdf8',
  borderWidth: 2,
  blur: 15,
  dimOutside: 0.5,
  scale: 1.5,
  animated: false,
  direction: 'in',
  loop: false,
  enterDuration: 0.2,
  exitDuration: 0.3,
}

const resetStore = () => {
  useEditorStore.setState({
    selectedRegionId: null,
    zoomRegions: {},
    cutRegions: {},
    speedRegions: {},
    visualEffects: [],
    videoClips: [],
    audioClips: [],
    compositionLayouts: [],
    cameraMotions: [],
    duration: 10,
    activeSidePanelTab: 'general',
  })
}

beforeEach(() => {
  resetStore()
  Object.defineProperty(window, 'electronAPI', {
    value: {
      getSetting: () => Promise.resolve(null),
      setSetting: () => Promise.resolve(),
      transcribeStatus: () =>
        Promise.resolve({
          configured: false,
          transcription: { enabled: false, creditsPerMinute: 0, models: [], maxAudioSeconds: 0 },
          error: null,
        }),
      onTranscribeProgress: () => () => undefined,
    },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('VisualEffectsSettings Component', () => {
  it('returns null when no visual effect is selected', async () => {
    const el = await render(<VisualEffectsSettings />)
    expect(el.innerHTML).toBe('')
  })

  it('renders inspector with PanelHeader title and subtitle when an effect is selected', async () => {
    useEditorStore.setState({
      visualEffects: [mockEffect],
      selectedRegionId: mockEffect.id,
    })

    const el = await render(<VisualEffectsSettings />)
    expect(el.textContent).toContain('Visual effect')
    expect(el.textContent).toContain('Adjust effect shape, timing, and parameters')

    const deleteBtn = el.querySelector('button[aria-label="Delete effect"]')
    expect(deleteBtn).not.toBeNull()
  })

  it('updates kind when kind select changes', async () => {
    useEditorStore.setState({
      visualEffects: [{ ...mockEffect }],
      selectedRegionId: mockEffect.id,
    })

    const el = await render(<VisualEffectsSettings />)
    const select = el.querySelector('select[aria-label="Effect kind"]') as HTMLSelectElement
    expect(select.value).toBe('blur')

    await act(async () => {
      select.value = 'border'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const updated = useEditorStore.getState().visualEffects.find((e) => e.id === mockEffect.id)
    expect(updated?.kind).toBe('border')
  })

  it('updates shape and color', async () => {
    useEditorStore.setState({
      visualEffects: [{ ...mockEffect }],
      selectedRegionId: mockEffect.id,
    })

    const el = await render(<VisualEffectsSettings />)
    const shapeSelect = el.querySelector('select[aria-label="Shape"]') as HTMLSelectElement
    expect(shapeSelect.value).toBe('rectangle')

    await act(async () => {
      shapeSelect.value = 'circle'
      shapeSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    let updated = useEditorStore.getState().visualEffects.find((e) => e.id === mockEffect.id)
    expect(updated?.shape).toBe('circle')

    const colorInput = el.querySelector('input[aria-label="Color"]') as HTMLInputElement
    await act(async () => {
      setInputValue(colorInput, '#ef4444')
    })

    updated = useEditorStore.getState().visualEffects.find((e) => e.id === mockEffect.id)
    expect(updated?.color).toBe('#ef4444')
  })

  it('updates timing fields (startTime, duration, enterDuration, exitDuration)', async () => {
    useEditorStore.setState({
      visualEffects: [{ ...mockEffect }],
      selectedRegionId: mockEffect.id,
      duration: 20,
    })

    const el = await render(<VisualEffectsSettings />)
    const startInput = el.querySelector('input[aria-label="Start (s)"]') as HTMLInputElement
    const durationInput = el.querySelector('input[aria-label="Duration (s)"]') as HTMLInputElement
    const enterInput = el.querySelector('input[aria-label="Enter (s)"]') as HTMLInputElement
    const exitInput = el.querySelector('input[aria-label="Exit (s)"]') as HTMLInputElement

    await act(async () => {
      setInputValue(startInput, '2.5')
    })

    let updated = useEditorStore.getState().visualEffects.find((e) => e.id === mockEffect.id)
    expect(updated?.startTime).toBe(2.5)

    await act(async () => {
      setInputValue(durationInput, '4.0')
    })

    updated = useEditorStore.getState().visualEffects.find((e) => e.id === mockEffect.id)
    expect(updated?.duration).toBe(4.0)

    await act(async () => {
      setInputValue(enterInput, '0.5')
    })

    updated = useEditorStore.getState().visualEffects.find((e) => e.id === mockEffect.id)
    expect(updated?.enterDuration).toBe(0.5)

    await act(async () => {
      setInputValue(exitInput, '0.7')
    })

    updated = useEditorStore.getState().visualEffects.find((e) => e.id === mockEffect.id)
    expect(updated?.exitDuration).toBe(0.7)
  })

  it('updates position and dimension fields', async () => {
    useEditorStore.setState({
      visualEffects: [{ ...mockEffect }],
      selectedRegionId: mockEffect.id,
    })

    const el = await render(<VisualEffectsSettings />)
    const xInput = el.querySelector('input[aria-label="X (0–1)"]') as HTMLInputElement
    const widthInput = el.querySelector('input[aria-label="Width"]') as HTMLInputElement

    await act(async () => {
      setInputValue(xInput, '0.35')
    })

    let updated = useEditorStore.getState().visualEffects.find((e) => e.id === mockEffect.id)
    expect(updated?.x).toBe(0.35)

    await act(async () => {
      setInputValue(widthInput, '0.6')
    })

    updated = useEditorStore.getState().visualEffects.find((e) => e.id === mockEffect.id)
    expect(updated?.width).toBe(0.6)
  })

  it('renders parameters conditionally based on kind', async () => {
    // 1. Blur effect
    useEditorStore.setState({
      visualEffects: [{ ...mockEffect, kind: 'blur' }],
      selectedRegionId: mockEffect.id,
    })
    const el = await render(<VisualEffectsSettings />)
    expect(el.querySelector('input[aria-label="Blur strength (px)"]')).not.toBeNull()
    expect(el.querySelector('input[aria-label="Magnification"]')).toBeNull()

    // 2. Focus effect
    await act(async () => {
      useEditorStore.setState({
        visualEffects: [{ ...mockEffect, kind: 'focus' }],
      })
    })
    expect(el.querySelector('input[aria-label="Blur strength (px)"]')).toBeNull()
    expect(el.querySelector('input[aria-label="Magnification"]')).not.toBeNull()
    expect(el.querySelector('input[aria-label="Outside dim (0–0.9)"]')).not.toBeNull()
    expect(el.querySelector('input[aria-label="Border width"]')).not.toBeNull()

    // 3. Border effect
    await act(async () => {
      useEditorStore.setState({
        visualEffects: [{ ...mockEffect, kind: 'border' }],
      })
    })
    expect(el.querySelector('input[aria-label="Border width"]')).not.toBeNull()
    expect(el.querySelector('select[aria-label="Animation direction"]')).not.toBeNull()

    // 4. Mask effect (no parameters section)
    await act(async () => {
      useEditorStore.setState({
        visualEffects: [{ ...mockEffect, kind: 'mask' }],
      })
    })
    expect(el.textContent).not.toContain('Parameters')
  })

  it('updates animation checkboxes (animated, loop)', async () => {
    useEditorStore.setState({
      visualEffects: [{ ...mockEffect, animated: false, loop: false }],
      selectedRegionId: mockEffect.id,
    })

    const el = await render(<VisualEffectsSettings />)
    const checkboxes = el.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>
    expect(checkboxes.length).toBe(2)

    const [animatedCheckbox, loopCheckbox] = Array.from(checkboxes)

    await act(async () => {
      animatedCheckbox.click()
    })
    let updated = useEditorStore.getState().visualEffects.find((e) => e.id === mockEffect.id)
    expect(updated?.animated).toBe(true)

    await act(async () => {
      loopCheckbox.click()
    })
    updated = useEditorStore.getState().visualEffects.find((e) => e.id === mockEffect.id)
    expect(updated?.loop).toBe(true)
  })

  it('clicking delete button removes visual effect and clears selectedRegionId', async () => {
    useEditorStore.setState({
      visualEffects: [{ ...mockEffect }],
      selectedRegionId: mockEffect.id,
    })

    const el = await render(<VisualEffectsSettings />)
    const deleteBtn = el.querySelector('button[aria-label="Delete effect"]') as HTMLButtonElement

    await act(async () => {
      deleteBtn.click()
    })

    const state = useEditorStore.getState()
    expect(state.visualEffects.some((e) => e.id === mockEffect.id)).toBe(false)
    expect(state.selectedRegionId).toBeNull()
  })
})

describe('SidePanel with VisualEffects timeline selection', () => {
  it('renders default Layout panel (FrameSettingsPanel) when no effect is selected', async () => {
    useEditorStore.setState({
      visualEffects: [{ ...mockEffect }],
      selectedRegionId: null,
      activeSidePanelTab: 'general',
    })

    const el = await render(<SidePanel />)
    expect(el.textContent).toContain('Background, spacing and depth')
    // Must NOT contain Visual effect inspector
    expect(el.textContent).not.toContain('Adjust effect shape, timing, and parameters')
  })

  it('switches to and displays Visual effect inspector when effect is selected on timeline', async () => {
    useEditorStore.setState({
      visualEffects: [{ ...mockEffect }],
      selectedRegionId: mockEffect.id,
      activeSidePanelTab: 'general',
    })

    const el = await render(<SidePanel />)
    expect(el.textContent).toContain('Visual effect')
    expect(el.textContent).toContain('Adjust effect shape, timing, and parameters')
    expect(el.textContent).not.toContain('Background, spacing and depth')
  })

  it('clears selection when Escape key is pressed', async () => {
    useEditorStore.setState({
      visualEffects: [{ ...mockEffect }],
      selectedRegionId: mockEffect.id,
      activeSidePanelTab: 'general',
    })

    await render(<SidePanel />)
    expect(useEditorStore.getState().selectedRegionId).toBe(mockEffect.id)

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(useEditorStore.getState().selectedRegionId).toBeNull()
  })

  it('deletes visual effect when Delete or Backspace key is pressed', async () => {
    useEditorStore.setState({
      visualEffects: [{ ...mockEffect }],
      selectedRegionId: mockEffect.id,
      activeSidePanelTab: 'general',
    })

    await render(<SidePanel />)

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    })

    const state = useEditorStore.getState()
    expect(state.visualEffects.some((e) => e.id === mockEffect.id)).toBe(false)
    expect(state.selectedRegionId).toBeNull()
  })

  it('does not delete visual effect when typing in an input element', async () => {
    useEditorStore.setState({
      visualEffects: [{ ...mockEffect }],
      selectedRegionId: mockEffect.id,
      activeSidePanelTab: 'general',
    })

    const el = await render(<SidePanel />)
    const input = el.querySelector('input[aria-label="Start (s)"]') as HTMLInputElement
    expect(input).not.toBeNull()

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
    })

    const state = useEditorStore.getState()
    expect(state.visualEffects.some((e) => e.id === mockEffect.id)).toBe(true)
    expect(state.selectedRegionId).toBe(mockEffect.id)
  })
})
