// @vitest-environment jsdom
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { UnifiedExportPublishModal } from './UnifiedExportPublishModal'
import type { PublicationView, PublishingCapabilities } from '../../../hooks/usePublish'
import { useEditorStore } from '../../../store/editorStore'

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
    expect(host.textContent).toContain('Hosting Duration')
    expect(host.textContent).toContain('Publishes hosted landing page, responsive embed player')
  })

  it('switches to Published Videos & Analytics tab and displays publications list with individual copy buttons', async () => {
    const host = await render(<UnifiedExportPublishModal {...defaultProps()} />)

    const analyticsTab = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Published Videos & Analytics'),
    )
    await click(analyticsTab)

    expect(host.textContent).toContain('1 Published Video')
    expect(host.textContent).toContain('Test Published Video')
    expect(host.textContent).toContain('active')

    // Click publication card to expand
    const pubTitle = Array.from(host.querySelectorAll('span')).find((s) =>
      s.textContent?.includes('Test Published Video'),
    )
    await click(pubTitle?.closest('.cursor-pointer') ?? pubTitle)

    // Verify Share Links section and individual copy buttons are shown
    expect(host.textContent).toContain('Share Links')
    expect(host.textContent).toContain('Landing Page')
    expect(host.textContent).toContain('Embed Player')
    expect(host.textContent).toContain('Embed HTML Code')
    expect(host.textContent).toContain('Direct Download')
    expect(host.textContent).toContain('Viewer Analytics')
  })

  it('handles publication deletion safely without crashing', async () => {
    const mockDelete = vi.fn().mockResolvedValue({ ok: true })
    const host = await render(
      <UnifiedExportPublishModal {...defaultProps()} initialTab="analytics" onDeletePublication={mockDelete} />,
    )

    expect(host.textContent).toContain('Test Published Video')

    // Click trash button
    const trashBtn = host.querySelector('button.hover\\:text-danger')
    await click(trashBtn)

    expect(host.textContent).toContain('Delete this publication?')

    // Click confirm delete
    const confirmBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Delete')
    await click(confirmBtn)

    expect(mockDelete).toHaveBeenCalledWith('pub_1')
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
    expect(host.textContent).toContain('Rendering video with effects')
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
    expect(host.textContent).toContain('Rendering')
    expect(host.textContent).toContain('40%')
    expect(host.textContent).toContain('Cancel')
  })

  it('disables tab switching when an export or publish operation is running', async () => {
    const host = await render(
      <UnifiedExportPublishModal
        {...defaultProps()}
        initialTab="publish"
        isPublishing={true}
        publishProgress={{ stage: 'Rendering', stagePercent: 40 }}
      />,
    )

    const tabs = Array.from(host.querySelectorAll('button')).filter((b) =>
      ['Export (File)', 'Publish (Cloud Link)', 'Published Videos & Analytics'].some((label) =>
        b.textContent?.includes(label),
      ),
    )
    expect(tabs.length).toBe(3)
    for (const tab of tabs) {
      expect(tab.hasAttribute('disabled')).toBe(true)
    }
  })

  it('does not render "Run in background" button and invokes onMinimize when close button is clicked during publishing', async () => {
    const mockMinimize = vi.fn()
    const host = await render(
      <UnifiedExportPublishModal
        {...defaultProps()}
        initialTab="publish"
        isPublishing={true}
        publishProgress={{ stage: 'Rendering video frames…', detail: 'Stitching camera feed…', stagePercent: 65 }}
        onMinimize={mockMinimize}
      />,
    )

    const runInBackgroundBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Run in background'),
    )
    expect(runInBackgroundBtn).toBeUndefined()

    // Click close button in header
    const closeBtn = host.querySelector('button[aria-label="Close and run in background"]')
    expect(closeBtn).not.toBeNull()
    await click(closeBtn)
    expect(mockMinimize).toHaveBeenCalledTimes(1)
  })

  it('renders dynamic stage and detail during publishing and local export', async () => {
    const host = await render(
      <UnifiedExportPublishModal
        {...defaultProps()}
        initialTab="publish"
        isPublishing={true}
        publishProgress={{
          stage: 'Compositing motion & cursor…',
          detail: 'Rendering zoom transitions, cursor movements, and click ripples…',
          stagePercent: 35,
        }}
      />,
    )

    expect(host.textContent).toContain('Compositing motion & cursor…')
    expect(host.textContent).toContain('Rendering zoom transitions, cursor movements, and click ripples…')
    expect(host.textContent).toContain('35%')
  })

  it('invokes onMinimize via close button during local export without "Run in background" button', async () => {
    const mockMinimize = vi.fn()
    const host = await render(
      <UnifiedExportPublishModal
        {...defaultProps()}
        isExporting={true}
        exportProgress={35}
        exportStage="Encoding video"
        onMinimize={mockMinimize}
      />,
    )

    const runInBackgroundBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Run in background'),
    )
    expect(runInBackgroundBtn).toBeUndefined()

    const closeBtn = host.querySelector('button[aria-label="Close and run in background"]')
    expect(closeBtn).not.toBeNull()
    await click(closeBtn)
    expect(mockMinimize).toHaveBeenCalledTimes(1)
  })

  it('invokes onMinimize when backdrop or close button is clicked while busy', async () => {
    const mockMinimize = vi.fn()
    const host = await render(
      <UnifiedExportPublishModal
        {...defaultProps()}
        initialTab="publish"
        isPublishing={true}
        publishProgress={{ stage: 'Rendering', stagePercent: 20 }}
        onMinimize={mockMinimize}
      />,
    )

    // Click close button in header
    const closeBtn = host.querySelector('button.h-8.w-8')
    expect(closeBtn).not.toBeNull()
    await click(closeBtn)
    expect(mockMinimize).toHaveBeenCalledTimes(1)
  })

  it('disables Start Export button when publishing is in progress', async () => {
    useEditorStore.setState({ duration: 10, videoPath: '/test/vid.mp4' })
    const host = await render(<UnifiedExportPublishModal {...defaultProps()} initialTab="export" isPublishing={true} />)

    const exportBtn = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Export Video') || b.textContent?.includes('Export with Cloud AI'),
    )
    expect(exportBtn?.hasAttribute('disabled')).toBe(true)
  })

  it('disables Start Publish button when export is in progress', async () => {
    useEditorStore.setState({ duration: 10, videoPath: '/test/vid.mp4' })
    const host = await render(<UnifiedExportPublishModal {...defaultProps()} initialTab="publish" isExporting={true} />)

    const publishBtn = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Render & Publish') || b.textContent?.includes('Upscale & Publish'),
    )
    expect(publishBtn?.hasAttribute('disabled')).toBe(true)
  })

  it('dynamically displays ProBadge on upscale resolutions in Publish tab based on source dimensions', async () => {
    // 720p source video -> 1080p target is an upscale
    act(() => {
      useEditorStore.setState({
        duration: 10,
        videoDimensions: { width: 1280, height: 720 },
      })
    })

    const hostUpscale = await render(<UnifiedExportPublishModal {...defaultProps()} initialTab="publish" />)

    // With 720p source and 1080p default target, upscale is detected
    expect(hostUpscale.textContent).toContain('Automated Cloud AI Upscaling')
    expect(hostUpscale.textContent).toContain('Pro')

    // 1080p source video -> 1080p target is NOT an upscale
    act(() => {
      useEditorStore.setState({
        duration: 10,
        videoDimensions: { width: 1920, height: 1080 },
      })
    })

    const hostNative = await render(<UnifiedExportPublishModal {...defaultProps()} initialTab="publish" />)
    expect(hostNative.textContent).toContain('Estimated Publish Storage')
    expect(hostNative.textContent).not.toContain('Automated Cloud AI Upscaling')
  })

  it('dynamically displays Cloud AI notice and ProBadge in Export tab based on source dimensions', async () => {
    // 2K source video -> 2K export is native, NOT an upscale
    act(() => {
      useEditorStore.setState({
        duration: 10,
        videoDimensions: { width: 2560, height: 1440 },
      })
    })

    const host2KNative = await render(<UnifiedExportPublishModal {...defaultProps()} initialTab="export" />)
    // Should NOT require Cloud AI Upscaling
    expect(host2KNative.textContent).not.toContain('AI Cloud Upscaling Required')
    expect(host2KNative.textContent).toContain('Export Video')

    // 1080p source video -> 1080p export is native
    act(() => {
      useEditorStore.setState({
        duration: 10,
        videoDimensions: { width: 1920, height: 1080 },
      })
    })

    const host1080pNative = await render(<UnifiedExportPublishModal {...defaultProps()} initialTab="export" />)
    expect(host1080pNative.textContent).not.toContain('AI Cloud Upscaling Required')
    expect(host1080pNative.textContent).toContain('Export Video')
  })

  it('preserves publishOutcome when modal closes and reopens after successful renderAndPublish', async () => {
    useEditorStore.setState({ duration: 10, videoPath: '/test/vid.mp4' })
    const mockRenderAndPublish = vi.fn().mockResolvedValue({
      ok: true,
      publication: {
        publicationId: 'pub-abc-123',
        title: 'DemoThat Video',
        status: 'active',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        links: {
          pageUrl: 'https://share.demothat.com/v/pub-abc-123',
          embedUrl: 'https://share.demothat.com/embed/pub-abc-123',
        },
      },
    })

    const host = await render(
      <UnifiedExportPublishModal {...defaultProps()} initialTab="publish" onRenderAndPublish={mockRenderAndPublish} />,
    )

    const publishBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Render & Publish'),
    )
    expect(publishBtn).toBeDefined()
    await click(publishBtn)

    expect(mockRenderAndPublish).toHaveBeenCalled()
    expect(host.textContent).toContain('Video published successfully!')
    expect(host.textContent).toContain('https://share.demothat.com/v/pub-abc-123')

    // Simulate minimize (isOpen = false) followed by restore (isOpen = true)
    await act(async () => {
      root!.render(
        <UnifiedExportPublishModal
          {...defaultProps()}
          isOpen={false}
          initialTab="publish"
          onRenderAndPublish={mockRenderAndPublish}
        />,
      )
    })

    await act(async () => {
      root!.render(
        <UnifiedExportPublishModal
          {...defaultProps()}
          isOpen={true}
          initialTab="publish"
          onRenderAndPublish={mockRenderAndPublish}
        />,
      )
    })

    // Outcome MUST NOT be wiped
    expect(host.textContent).toContain('Video published successfully!')
    expect(host.textContent).toContain('https://share.demothat.com/v/pub-abc-123')

    // Clicking Done resets outcome
    const doneBtn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Done')
    expect(doneBtn).toBeDefined()
    await click(doneBtn)
  })
})
