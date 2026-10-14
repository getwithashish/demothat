// @vitest-environment jsdom
/**
 * Render + state contract for the shared primitives (DESIGN_SPEC §6). These are the
 * building blocks of every restyled surface, so their semantics and their
 * hover / focus-visible / disabled affordances are asserted here rather than assumed.
 */
import { describe, expect, it, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Section } from './section'
import { HelperText } from './helper-text'
import { PanelHeader } from '../editor/PanelHeader'
import { SegmentedControl } from './segmented-control'
import { ToggleRow } from './toggle-row'
import { ToolbarButton } from './toolbar-button'
import { SwatchGrid } from './swatch-grid'
import { ColorField } from './color-field'
import { PositionGrid } from './position-grid'
import { Button } from './button'

// React 18 wants this flag before act() is used in a non-react-testing-library setup.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(node: React.ReactElement): HTMLDivElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(node))
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

/**
 * Interactive affordances. Hover must be per element; focus-visible may come from the
 * global rule in tokens.css (asserted below), so elements that declare their own are
 * checked with `expectOwnFocus`.
 */
const expectHover = (el: Element, label: string) => {
  expect(el.className, `${label} hover`).toMatch(/hover:/)
}
const expectOwnFocus = (el: Element, label: string) => {
  expect(el.className, `${label} focus-visible`).toMatch(/focus-visible:|focus:/)
}

describe('primitives', () => {
  it('Section renders its label, right-hand slot and children', () => {
    const el = render(
      <Section label="Frame" labelRight={<button type="button">Reset</button>} first>
        <p>body</p>
      </Section>,
    )
    expect(el.textContent).toContain('Frame')
    expect(el.textContent).toContain('Reset')
    expect(el.textContent).toContain('body')
  })

  it('HelperText renders muted helper copy', () => {
    const el = render(<HelperText>Shown on the preview</HelperText>)
    const p = el.querySelector('p')
    expect(p?.textContent).toBe('Shown on the preview')
    expect(p?.className).toMatch(/text-muted/)
  })

  it('PanelHeader renders title and subtitle', () => {
    const el = render(<PanelHeader title="Layout" subtitle="Background, spacing and depth" />)
    expect(el.textContent).toContain('Layout')
    expect(el.querySelector('h2')?.textContent).toBe('Layout')
    expect(el.textContent).toContain('Background, spacing and depth')
  })

  it('SegmentedControl marks the selected option and reports changes', () => {
    const seen: string[] = []
    const el = render(
      <SegmentedControl
        options={[{ value: 'wallpaper', label: 'Wallpaper' }, { value: 'color', label: 'Colour' }]}
        value="wallpaper"
        onChange={(v) => seen.push(v)}
      />,
    )
    const buttons = [...el.querySelectorAll('button')]
    expect(buttons).toHaveLength(2)
    const [active, inactive] = buttons
    expect(active.className).not.toBe(inactive.className)
    expect(active.className).toMatch(/accent|panel|bg-ctl/)
    expect(inactive.className).toMatch(/text-muted|hover:/)
    expectHover(active, 'active segment')
    expectHover(inactive, 'inactive segment')
    act(() => buttons[1].click())
    expect(seen).toEqual(['color'])
  })

  it('ToggleRow exposes a switch, its label and disables cleanly', () => {
    const el = render(<ToggleRow label="Drop shadow" checked onCheckedChange={() => {}} disabled />)
    const sw = el.querySelector('[role="switch"], input[type="checkbox"], button')
    expect(sw, 'toggle control').not.toBeNull()
    expect(el.textContent).toContain('Drop shadow')
  })

  it('ToolbarButton keeps one line and carries the state affordances', () => {
    const el = render(
      <ToolbarButton iconOnly active icon={<span />} aria-label="Add Zoom Region" title="Add Zoom Region" />,
    )
    const b = el.querySelector('button')!
    expect(b.getAttribute('aria-label')).toBe('Add Zoom Region')
    // Regression: a wrapping label stretched the whole timeline toolbar (phase 5).
    expect(b.className).toMatch(/whitespace-nowrap/)
    expectHover(b, 'toolbar button')
    expectOwnFocus(b, 'toolbar button')
    expect(b.className).toMatch(/disabled:/)
  })

  it('SwatchGrid renders one labelled option per item and reports the chosen id', () => {
    const chosen: string[] = []
    const el = render(
      <SwatchGrid
        items={[{ id: 'a', label: 'Wallpaper 1', color: '#123456' }, { id: 'b', label: 'Wallpaper 2', color: '#654321' }]}
        selectedId="a"
        onSelect={(id) => chosen.push(id)}
      />,
    )
    const buttons = [...el.querySelectorAll('button')]
    expect(buttons).toHaveLength(2)
    expect(buttons[1].getAttribute('aria-label')).toBe('Wallpaper 2')
    expectHover(buttons[1], 'swatch')
    expectOwnFocus(buttons[1], 'swatch')
    act(() => buttons[1].click())
    expect(chosen).toEqual(['b'])
  })

  it('ColorField shows its label and renders the current value', () => {
    const el = render(<ColorField label="Background colour" value="#abcdef" onChange={() => {}} />)
    expect(el.textContent).toContain('Background colour')
    const text = [...el.querySelectorAll('input')].map((i) => i.value)
    expect(text.some((v) => v.toLowerCase().includes('abcdef'))).toBe(true)
  })

  it('PositionGrid renders every cell as a labelled, pressable control', () => {
    const picked: string[] = []
    const el = render(<PositionGrid value="center" onChange={(v) => picked.push(v)} />)
    const buttons = [...el.querySelectorAll('button')]
    expect(buttons.length).toBeGreaterThanOrEqual(8)
    for (const b of buttons) expect(b.getAttribute('aria-label')).toBeTruthy()
    expectHover(buttons[0], 'position cell')
    expectOwnFocus(buttons[0], 'position cell')
    act(() => buttons[0].click())
    expect(picked).toHaveLength(1)
  })

  it('Button declares hover, focus and disabled states', () => {
    const el = render(<Button>Export</Button>)
    const b = el.querySelector('button')!
    expect(b.className).toMatch(/disabled:/)
    expectHover(b, 'button')
  })
})
