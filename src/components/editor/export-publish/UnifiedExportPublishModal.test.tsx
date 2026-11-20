// @vitest-environment jsdom
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { UnifiedExportPublishModal } from './UnifiedExportPublishModal'
import type { PublicationView, PublishingCapabilities } from '../../../hooks/usePublish'

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

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

beforeEach(() => {
  Object.defineProperty(window, 'electronAPI', {
    value: {
      openExternal: vi.fn(),
      getPath: vi.fn().mockResolvedValue('/home/user'),
      showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: '/home/user/out.mp4' }),
      showItemInFolder: vi.fn(),
      getExportCapabilities: vi.fn().mockResolvedValue({ libx265: true }),
      getEntitlement: vi.fn().mockResolvedValue({ pro: true, credits: 1000 }),
      getExportPerfSamples: vi.fn().mockResolvedValue([]),
      cloudStatus: vi.fn().mockResolvedValue({
        configured: true,
        capabilities: {
          cloudEnabled: true,
          minChargeCredits: 50,
          creditsPerFrame: { '1080p': 1, '1440p': 2, '2160p': 4, '4320p': 8 },
        },
        consent: { acceptedAt: 12345 },
      }),
      getSetting: vi.fn().mockResolvedValue(null),
    },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
})

async function click(element: Element | null | undefined): Promise<void> {
  expect(element).not.toBeNull()
  await act(async () => {
    element!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const mockCapabilities: PublishingCapabilities = {
  enabled: true,
  maxSizeBytes: 100_000_000,
  minCredits: 100,
  creditsPerGbYear: 600,
  landingPageCredits: 800,
  defaultDurationDays: 365,
  durationsDays: [30, 90, 365],
  baseUrl: 'https://demothat.app',
  kinds: ['page', 'embed', 'links'],
}

const mockPublication: PublicationView = {
  publicationId: 'pub_1',
  slug: 'test-slug',
  title: 'Test Published Video',
  status: 'active',
  kind: 'page',
  createdAt: '2026-11-20T10:00:00Z',
  expiresAt: '2027-11-20T10:00:00Z',
  sizeBytes: 15_000_000,
  storageDays: 365,
  served: { page: true, embed: true, links: true },
  estimatedCost: 900,
  creditsCharged: 900,
  hasCaptions: false,
  links: {
    pageUrl: 'https://demothat.app/v/test-slug',
    embedUrl: 'https://demothat.app/embed/test-slug',
    videoDownloadUrl: 'https://demothat.app/download/test-slug.mp4',
    embedCode: '<iframe src="https://demothat.app/embed/test-slug"></iframe>',
  },
}

function defaultProps(): ComponentProps<typeof UnifiedExportPublishModal> {
  return {
    isOpen: true,
    onClose: vi.fn(),
    initialTab: 'export',
    triggerSelector: undefined,
    publishStatus: {
      configured: true,
      pro: true,
      publishing: mockCapabilities,
      error: null,
    },
    publications: [mockPublication],
  }
}

describe('UnifiedExportPublishModal', () => {
  it('does not render when isOpen is false', async () => {
    const host = await render(<UnifiedExportPublishModal {...defaultProps()} isOpen={false} />)
    expect(host.querySelector('.modal-backdrop')).toBeNull()
  })

  it('renders modal header, persistent tabs, and export settings', async () => {
    const host = await render(<UnifiedExportPublishModal {...defaultProps()} />)
    expect(host.querySelector('.modal-backdrop')).not.toBeNull()
    expect(host.textContent).toContain('Export & Instant Publishing')
    expect(host.textContent).toContain('Export (File)')
    expect(host.textContent).toContain('Publish (Cloud Link)')
    expect(host.textContent).toContain('Published Videos & Analytics')

    // Quality choices
    expect(host.textContent).toContain('Format')
    expect(host.textContent).toContain('Resolution (up to 8K)')
    expect(host.textContent).toContain('Quality')
    expect(host.textContent).toContain('Frame Rate')
    expect(host.textContent).toContain('Destination File')
    expect(host.textContent).toContain('Export Video')
  })

  it('switches to Publish (Cloud Link) tab', async () => {
    const host = await render(<UnifiedExportPublishModal {...defaultProps()} />)

    const publishTab = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Publish (Cloud Link)'),
    )
    await click(publishTab)

    expect(host.textContent).toContain('Render & Publish')
    expect(host.textContent).toContain('Link Format')
    expect(host.textContent).toContain('Hosting Duration')
  })

  it('switches to Published Videos & Analytics tab and displays publications list', async () => {
    const host = await render(<UnifiedExportPublishModal {...defaultProps()} />)

    const analyticsTab = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Published Videos & Analytics'),
    )
    await click(analyticsTab)

    expect(host.textContent).toContain('1 Published Video')
    expect(host.textContent).toContain('Test Published Video')
    expect(host.textContent).toContain('active')
  })

  it('shows empty state when no publications exist in Analytics tab', async () => {
    const host = await render(<UnifiedExportPublishModal {...defaultProps()} publications={[]} />)

    const analyticsTab = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Published Videos & Analytics'),
    )
    await click(analyticsTab)

    expect(host.textContent).toContain('No Published Videos Yet')
    expect(host.textContent).toContain('Publish Video Now')
  })

  it('shows live progress when local export is in progress', async () => {
    const host = await render(
      <UnifiedExportPublishModal
        {...defaultProps()}
        isExporting={true}
        exportProgress={55}
        exportStage="Rendering video with effects"
      />,
    )
    expect(host.textContent).toContain('Exporting video…')
    expect(host.textContent).toContain('55%')
    expect(host.textContent).toContain('Cancel')
  })

  it('shows live progress when cloud publishing is in progress', async () => {
    const host = await render(
      <UnifiedExportPublishModal
        {...defaultProps()}
        initialTab="publish"
        isPublishing={true}
        publishProgress={{ stage: 'Rendering', stagePercent: 40 }}
      />,
    )
    expect(host.textContent).toContain('Rendering with all effects…')
    expect(host.textContent).toContain('40%')
    expect(host.textContent).toContain('Cancel')
  })
})
