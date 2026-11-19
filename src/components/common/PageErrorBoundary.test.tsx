// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PageErrorBoundary } from './PageErrorBoundary'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

function ProblematicChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Explosion in renderer UI')
  }
  return <div>Safe child content</div>
}

describe('PageErrorBoundary', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    container?.remove()
    container = null
    root = null
    errorSpy.mockRestore()
  })

  it('renders children when no error is thrown', async () => {
    await act(async () => {
      root!.render(
        <PageErrorBoundary pageName="EditorPage">
          <ProblematicChild shouldThrow={false} />
        </PageErrorBoundary>,
      )
    })

    expect(container?.textContent).toContain('Safe child content')
  })

  it('catches render errors and logs them with page scope', async () => {
    await act(async () => {
      root!.render(
        <PageErrorBoundary pageName="EditorPage">
          <ProblematicChild shouldThrow={true} />
        </PageErrorBoundary>,
      )
    })

    expect(errorSpy).toHaveBeenCalledWith(
      '[EditorPage]',
      'Unhandled React error boundary exception:',
      expect.any(Error),
      expect.any(String),
    )
    expect(container?.textContent).toContain('Something went wrong in EditorPage')
    expect(container?.textContent).toContain('Explosion in renderer UI')
  })
})
