// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { usePageLifecycle } from './usePageLifecycle'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

function TestComponent({ name }: { name: string }) {
  usePageLifecycle(name)
  return <div>Test Component</div>
}

describe('usePageLifecycle', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    container?.remove()
    container = null
    root = null
    infoSpy.mockRestore()
  })

  it('logs mount and unmount events', async () => {
    await act(async () => {
      root!.render(<TestComponent name="TestPage" />)
    })

    expect(infoSpy).toHaveBeenCalledWith('[TestPage]', 'Page mounted')

    act(() => {
      root!.unmount()
    })
    root = null

    expect(infoSpy).toHaveBeenCalledWith('[TestPage]', 'Page unmounted')
  })

  it('logs window focus and blur transitions', async () => {
    await act(async () => {
      root!.render(<TestComponent name="ActivePage" />)
    })

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(infoSpy).toHaveBeenCalledWith('[ActivePage]', 'Window active (focused)')

    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(infoSpy).toHaveBeenCalledWith('[ActivePage]', 'Window inactive (blurred)')
  })

  it('logs document visibility change events', async () => {
    await act(async () => {
      root!.render(<TestComponent name="VisiblePage" />)
    })

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(infoSpy).toHaveBeenCalledWith('[VisiblePage]', expect.stringContaining('Document visibility state changed:'))
  })
})
