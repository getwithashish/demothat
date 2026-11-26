// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorTitlebar } from './EditorTitlebar'
import { resolveWindowControlsConfig } from '../../../shared/window-controls'

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

describe('EditorTitlebar adaptive layout', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      value: {
        minimizeWindow: vi.fn(),
        maximizeWindow: vi.fn(),
        closeWindow: vi.fn(),
        windowIsMaximized: vi.fn().mockResolvedValue(false),
        onWindowStateChange: vi.fn(() => () => {}),
      },
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
  })

  it('positions controls on the left before menus/title and keeps actions on the right (macOS / Linux left)', async () => {
    const config = resolveWindowControlsConfig({
      platform: 'linux',
      desktopEnvironment: 'gnome',
      rawLayout: 'close,minimize,maximize:',
      appearance: 'dark',
    })

    const el = await renderAsync(
      <EditorTitlebar
        controlsConfig={config}
        projectCluster={
          <>
            <button type="button" data-testid="project-menu">
              My Demo
            </button>
            <span data-testid="title-meta">00:12.4 · 1920x1080</span>
          </>
        }
        actions={
          <>
            <button type="button" data-testid="action-export">
              Export
            </button>
            <button type="button" data-testid="action-ed">
              Ed
            </button>
          </>
        }
      />,
    )

    const header = el.querySelector('[data-testid="editor-titlebar"]')!
    const leftCluster = el.querySelector('[data-testid="titlebar-left"]')!
    const rightCluster = el.querySelector('[data-testid="titlebar-right"]')!
    const leftControls = el.querySelector('[data-testid="titlebar-controls-left"]')
    const rightControls = el.querySelector('[data-testid="titlebar-controls-right"]')
    const projectCluster = el.querySelector('[data-testid="titlebar-project-cluster"]')!
    const actionsCluster = el.querySelector('[data-testid="titlebar-actions"]')!

    expect(leftControls).not.toBeNull()
    expect(rightControls).toBeNull()
    expect(Array.from(header.children)).toEqual([leftControls, leftCluster, rightCluster])
    expect(leftCluster.children[0]).toBe(projectCluster)
    expect(rightCluster.children[0]).toBe(actionsCluster)

    // Left controls sit as a shrink-0 sibling before the project cluster; project
    // and actions clusters shrink/clip cleanly without obscuring controls.
    expect(leftControls?.className).toContain('shrink-0')
    expect(leftCluster.className).toContain('min-w-0')
    expect(leftCluster.className).toContain('overflow-hidden')
    expect(projectCluster.className).toContain('min-w-0')
    expect(projectCluster.className).toContain('overflow-hidden')
    expect(rightCluster.className).toContain('min-w-0')
    expect(rightCluster.className).toContain('shrink')
    expect(actionsCluster.className).toContain('min-w-0')
  })

  it('positions controls on the right after action buttons and shifts menus flush left (Windows / Linux right)', async () => {
    const config = resolveWindowControlsConfig({
      platform: 'win32',
      appearance: 'light',
    })

    const el = await renderAsync(
      <EditorTitlebar
        controlsConfig={config}
        projectCluster={<button type="button">My Demo</button>}
        actions={<button type="button">Export</button>}
      />,
    )

    const header = el.querySelector('[data-testid="editor-titlebar"]')!
    const leftCluster = el.querySelector('[data-testid="titlebar-left"]')!
    const rightCluster = el.querySelector('[data-testid="titlebar-right"]')!
    const leftControls = el.querySelector('[data-testid="titlebar-controls-left"]')
    const rightControls = el.querySelector('[data-testid="titlebar-controls-right"]')
    const projectCluster = el.querySelector('[data-testid="titlebar-project-cluster"]')!
    const actionsCluster = el.querySelector('[data-testid="titlebar-actions"]')!

    expect(leftControls).toBeNull()
    expect(rightControls).not.toBeNull()
    expect(Array.from(header.children)).toEqual([leftCluster, rightCluster, rightControls])
    expect(leftCluster.children[0]).toBe(projectCluster)
    expect(rightCluster.children[0]).toBe(actionsCluster)
    expect(rightControls?.className).toContain('shrink-0')
    // Windows caption buttons sit flush to the right edge
    expect(header.className).toContain('pr-0')
  })

  it('supports split Linux layouts (e.g. close on left, minimize/maximize on right) without colliding on either side', async () => {
    const config = resolveWindowControlsConfig({
      platform: 'linux',
      desktopEnvironment: 'kde',
      kdeButtonsOnLeft: 'X',
      kdeButtonsOnRight: 'IA',
    })

    const el = await renderAsync(
      <EditorTitlebar
        controlsConfig={config}
        projectCluster={<button type="button">My Demo</button>}
        actions={<button type="button">Export</button>}
      />,
    )

    const leftControls = el.querySelector('[data-testid="titlebar-controls-left"]')!
    const rightControls = el.querySelector('[data-testid="titlebar-controls-right"]')!
    expect(Array.from(leftControls.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Close',
    ])
    expect(Array.from(rightControls.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Minimize',
      'Maximize',
    ])
  })

  it('covers EditorPage as the titled application window using EditorTitlebar', () => {
    const editorPageSource = readFileSync(resolve(process.cwd(), 'src/pages/EditorPage.tsx'), 'utf8')
    expect(editorPageSource).toContain("from '../components/editor/EditorTitlebar'")
    expect(editorPageSource).toContain('<EditorTitlebar')
  })
})
