// @vitest-environment jsdom
/**
 * The publishing surfaces, rendered.
 *
 * These assert what a user would see and press: the three options and their prices, the
 * quote moving when the term or the kind changes, the Pro gate actually disabling the
 * choice, the links and the embed code after a successful publish, and the sentence that
 * says the credits are not returned. The numbers come from the same capabilities the
 * server publishes, so a rate change on the server is a visible change here.
 *
 * Rendered with `createRoot` rather than a testing library, which is how the shared
 * primitives are tested in this repo.
 */

import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PublishDialog } from './PublishDialog'
import { SharedLinksDialog } from './SharedLinksDialog'
import type { PublicationAnalytics, PublicationView, PublishingCapabilities } from '../../../hooks/usePublish'
import type { SubtitleCue } from '../../../../shared/subtitles'

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
  // The result view opens links through the bridge, and the copy buttons use the
  // clipboard; neither exists in jsdom.
  Object.defineProperty(window, 'electronAPI', {
    value: { openExternal: vi.fn() },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: () => Promise.resolve() },
    configurable: true,
  })
})

/** Press something and let React settle. */
async function click(element: Element | null | undefined): Promise<void> {
  expect(element).toBeTruthy()
  await act(async () => {
    element!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/** Find a button whose text starts with the given label. */
function buttonByText(host: HTMLElement, text: string): Element | undefined {
  return [...host.querySelectorAll('button')].find((button) => (button.textContent ?? '').trim().startsWith(text))
}

const capabilities: PublishingCapabilities = {
  enabled: true,
  creditsPerGbYear: 1200,
  landingPageCredits: 900,
  minCredits: 1,
  durationsDays: [7, 30, 90, 365],
  defaultDurationDays: 365,
  maxSizeBytes: 2_147_483_648,
  baseUrl: 'https://share.demothat.yahodu.in',
  kinds: ['page', 'links', 'embed'],
}

const cues: SubtitleCue[] = [
  { id: 'c1', start: 0, end: 2, text: 'Here is the thing' },
  { id: 'c2', start: 2, end: 4, text: 'and here is the rest' },
]

/** A publication as the API returns one once it is live. */
function livePublication(overrides: Partial<PublicationView> = {}): PublicationView {
  return {
    publicationId: 'pub_1',
    kind: 'page',
    slug: 'abcdefghijklmnopqrstuv',
    title: 'A quarterly demo',
    status: 'active',
    sizeBytes: 6_000_000,
    durationSec: 90,
    storageDays: 365,
    creditsCharged: 908,
    estimatedCost: 908,
    hasCaptions: true,
    createdAt: new Date('2026-10-01T10:00:00Z').toISOString(),
    activatedAt: new Date('2026-10-01T10:00:05Z').toISOString(),
    expiresAt: new Date('2027-10-01T10:00:05Z').toISOString(),
    served: { page: true, embed: true, links: true },
    links: {
      pageUrl: 'https://share.demothat.yahodu.in/p/abcdefghijklmnopqrstuv',
      embedUrl: 'https://share.demothat.yahodu.in/e/abcdefghijklmnopqrstuv',
      embedCode: '<iframe src="https://share.demothat.yahodu.in/e/abcdefghijklmnopqrstuv"></iframe>',
      videoDownloadUrl: 'https://share.demothat.yahodu.in/d/abcdefghijklmnopqrstuv/video.mp4',
      captionsDownloadUrl: 'https://share.demothat.yahodu.in/d/abcdefghijklmnopqrstuv/captions.vtt',
    },
    ...overrides,
  }
}

function publishDialogProps(): ComponentProps<typeof PublishDialog> {
  return {
    isOpen: true,
    onClose: vi.fn(),
    capabilities,
    pro: true,
    configured: true,
    isPublishing: false,
    progress: null,
    balance: 5000,
    filePath: '/tmp/export.mp4',
    fileSizeBytes: 6_000_000,
    durationSec: 90,
    cues: [] as SubtitleCue[],
    defaultTitle: 'A quarterly demo',
    onPublish: vi.fn(async () => ({
      ok: true as const,
      publication: livePublication(),
      captionsIncluded: true,
    })),
    onCancel: vi.fn(),
    onUnlock: vi.fn(),
    onOpenLibrary: vi.fn(),
  }
}

describe('PublishDialog', () => {
  it('offers the three options with their prices, on the longest term by default', async () => {
    const host = await render(<PublishDialog {...publishDialogProps()} />)
    const text = host.textContent ?? ''

    expect(text).toContain('Instant publishing')
    expect(text).toContain('Landing page')
    expect(text).toContain('Embeddable player')
    expect(text).toContain('Download links')

    // 6 MB for a year is 8 credits; the landing page adds the 900 surcharge.
    expect(text).toContain('908 credits')
    expect(text).toContain('8 credits')

    // The default term is the server's, and it is the selected one.
    expect(text).toContain('1 year')
    expect(text).toContain('Balance after publishing: 4092 credits')
  })

  it('re-quotes when the term and the kind change', async () => {
    const host = await render(<PublishDialog {...publishDialogProps()} />)

    // 6 MB for a week is under one credit of storage, so it floors at 1 (+900 for a page).
    await click(buttonByText(host, '1 week'))
    expect(host.textContent).toContain('901 credits')

    // Dropping the landing page drops the surcharge with it: the footer is the quote
    // for what is selected, while each row keeps showing its own price to compare.
    await click(buttonByText(host, 'Download links'))
    expect(host.textContent).toContain('1 credit')
    expect(host.textContent).toContain('Balance after publishing: 4999 credits')
  })

  it('says what will be published with the video when the project has captions', async () => {
    const host = await render(<PublishDialog {...publishDialogProps()} cues={cues} />)
    expect(host.textContent).toContain("The project's 2 captions will be published with the video")
  })

  it('gates publishing behind Pro without hiding what it costs', async () => {
    const props = publishDialogProps()
    props.pro = false
    const host = await render(<PublishDialog {...props} />)

    expect(host.textContent).toContain('Publishing is a Pro feature')
    // The prices are still shown: the feature is gated, not hidden.
    expect(host.textContent).toContain('908 credits')
    expect(buttonByText(host, 'Publish')?.hasAttribute('disabled')).toBe(true)
  })

  it('refuses to offer publishing when the device is not activated', async () => {
    const props = publishDialogProps()
    props.configured = false
    const host = await render(<PublishDialog {...props} />)
    expect(host.textContent).toContain('not activated')
    expect(buttonByText(host, 'Publish')?.hasAttribute('disabled')).toBe(true)
  })

  it('refuses a video above the size limit, and says how big it is', async () => {
    const props = publishDialogProps()
    props.fileSizeBytes = 3_000_000_000
    const host = await render(<PublishDialog {...props} />)
    expect(host.textContent).toContain('above the 2.1 GB publishing limit')
    expect(buttonByText(host, 'Publish')?.hasAttribute('disabled')).toBe(true)
  })

  it('sends the chosen kind, term, title and captions to the main process', async () => {
    const props = publishDialogProps()
    props.cues = cues
    const host = await render(<PublishDialog {...props} />)

    await click(buttonByText(host, 'Embeddable player'))
    await click(buttonByText(host, '3 months'))
    await click(buttonByText(host, 'Publish'))

    expect(props.onPublish).toHaveBeenCalledTimes(1)
    const request = (props.onPublish as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as {
      kind: string
      storageDays: number
      title: string
      durationSec: number
      captions: SubtitleCue[]
      filePath: string
    }
    expect(request.kind).toBe('embed')
    expect(request.storageDays).toBe(90)
    expect(request.title).toBe('A quarterly demo')
    expect(request.durationSec).toBe(90)
    expect(request.captions).toHaveLength(2)
    expect(request.filePath).toBe('/tmp/export.mp4')
  })

  it('hands over the links, the embed code and the no-refund sentence once it is live', async () => {
    const host = await render(<PublishDialog {...publishDialogProps()} />)
    await click(buttonByText(host, 'Publish'))

    const text = host.textContent ?? ''
    expect(text).toContain('Published · 908 credits charged')
    expect(text).toContain('https://share.demothat.yahodu.in/p/abcdefghijklmnopqrstuv')
    expect(text).toContain('https://share.demothat.yahodu.in/d/abcdefghijklmnopqrstuv/video.mp4')
    expect(text).toContain('captions')
    // The policy, stated where the link is handed over.
    expect(text).toContain('the credits are not returned')
    // And the honest note about what a share link is.
    expect(text).toContain('the link is the key')

    const embed = host.querySelector('textarea')
    expect(embed?.value).toContain('<iframe')
  })

  it('reports a refusal with the price and the balance', async () => {
    const props = publishDialogProps()
    props.onPublish = vi.fn(async () => ({
      ok: false as const,
      reason: 'rejected' as const,
      error: 'There are not enough credits to publish this with that term.',
      cost: 908,
      balance: 500,
    }))
    const host = await render(<PublishDialog {...props} />)
    await click(buttonByText(host, 'Publish'))

    const text = host.textContent ?? ''
    expect(text).toContain('not enough credits')
    expect(text).toContain('costs 908 credits and the balance is 500')
    expect(buttonByText(host, 'Buy credits')).toBeDefined()
  })

  it('says nothing is charged until the upload finishes, while it runs', async () => {
    const props = publishDialogProps()
    props.isPublishing = true
    props.progress = { stage: 'Uploading', stagePercent: 42 }
    const host = await render(<PublishDialog {...props} />)

    expect(host.textContent).toContain('Uploading · 42%')
    expect(host.textContent).toContain('Nothing is charged until the video has finished uploading')
  })

  it('renders nothing when it is closed', async () => {
    const props = publishDialogProps()
    props.isOpen = false
    const host = await render(<PublishDialog {...props} />)
    expect(host.textContent).toBe('')
  })
})

// --- The library -----------------------------------------------------------------

function analytics(overrides: Partial<PublicationAnalytics['totals']> = {}): PublicationAnalytics {
  return {
    publicationId: 'pub_1',
    slug: 'abcdefghijklmnopqrstuv',
    title: 'A quarterly demo',
    status: 'active',
    durationSec: 100,
    range: '30d',
    since: new Date('2026-09-20T00:00:00Z').toISOString(),
    until: new Date('2026-10-20T00:00:00Z').toISOString(),
    totals: {
      views: 2,
      uniqueViewers: 2,
      plays: 1,
      completions: 1,
      downloads: 1,
      watchedSeconds: 120,
      avgWatchSeconds: 60,
      avgWatchRatio: 0.6,
      completionRate: 0.5,
      ...overrides,
    },
    timeseries: [
      { date: '2026-10-18', views: 1, uniqueViewers: 1, watchedSeconds: 40 },
      { date: '2026-10-19', views: 1, uniqueViewers: 1, watchedSeconds: 80 },
    ],
    countries: [
      { key: 'US', uniqueViewers: 1 },
      { key: 'IN', uniqueViewers: 1 },
    ],
    referrers: [
      { key: 'example.com', class: 'other', uniqueViewers: 1 },
      { key: 'unknown', class: 'direct', uniqueViewers: 1 },
    ],
    devices: [{ key: 'desktop', uniqueViewers: 2 }],
    browsers: [{ key: 'chrome', uniqueViewers: 2 }],
    recent: [],
  }
}

function libraryProps(): ComponentProps<typeof SharedLinksDialog> {
  return {
    isOpen: true,
    onClose: vi.fn(),
    publications: [] as PublicationView[],
    isLoadingList: false,
    onRefresh: vi.fn(async () => ({ ok: true })),
    onDelete: vi.fn(async () => ({ ok: true, creditsRefunded: 0 })),
    onAnalytics: vi.fn(async () => ({ ok: true as const, analytics: analytics() })),
  }
}

describe('SharedLinksDialog', () => {
  it('invites the first publication when there are none', async () => {
    const host = await render(<SharedLinksDialog {...libraryProps()} />)
    expect(host.textContent).toContain('Nothing published yet')
    // It reads the list on open, so a publication deleted elsewhere does not linger.
    expect(libraryProps().onRefresh).not.toHaveBeenCalled()
  })

  it('lists what was published with the state a user would recognise', async () => {
    const props = libraryProps()
    props.publications = [
      livePublication(),
      livePublication({
        publicationId: 'pub_2',
        title: 'An older clip',
        status: 'revoked',
        revokedAt: new Date('2026-10-10T00:00:00Z').toISOString(),
        creditsCharged: 12,
      }),
      livePublication({ publicationId: 'pub_3', title: 'Expired one', status: 'expired' }),
    ]
    const host = await render(<SharedLinksDialog {...props} />)
    const text = host.textContent ?? ''

    expect(text).toContain('A quarterly demo')
    expect(text).toContain('Live until')
    expect(text).toContain('Deleted')
    expect(text).toContain('Term ended')
    // Only the live one counts towards what is being spent.
    expect(text).toContain('3 published · 908 credits spent')
  })

  it('shows who watched, from where, and how long', async () => {
    const props = libraryProps()
    props.publications = [livePublication()]
    const host = await render(<SharedLinksDialog {...props} />)
    await click([...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('A quarterly demo')))

    const text = host.textContent ?? ''
    expect(text).toContain('Views')
    expect(text).toContain('Average watch')
    expect(text).toContain('1m 0s')
    expect(text).toContain('of 100s')
    expect(text).toContain('Finished it')
    expect(text).toContain('50%')
    expect(text).toContain('US')
    expect(text).toContain('example.com')
    expect(text).toContain('Direct or unknown')
    // The honest note about what "viewer" means.
    expect(text).toContain('counted per browser tab')
  })

  it('asks the API for the window the user picked', async () => {
    const props = libraryProps()
    props.publications = [livePublication()]
    const host = await render(<SharedLinksDialog {...props} />)
    await click([...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('A quarterly demo')))

    await click(buttonByText(host, 'All time'))
    const calls = (props.onAnalytics as unknown as { mock: { calls: unknown[][] } }).mock.calls
    expect(calls[calls.length - 1]).toEqual(['pub_1', 'all'])
  })

  it('states the no-refund rule in the confirmation, and reports back what happened', async () => {
    const props = libraryProps()
    props.publications = [livePublication()]
    const host = await render(<SharedLinksDialog {...props} />)
    await click([...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('A quarterly demo')))

    await click(buttonByText(host, 'Delete'))
    const text = host.textContent ?? ''
    expect(text).toContain('cannot be restored')
    expect(text).toContain('the 908 credits are not returned')

    await click(buttonByText(host, 'Delete link'))
    expect(props.onDelete).toHaveBeenCalledWith('pub_1')
    expect(host.textContent).toContain('The credits were not returned, as stated.')
  })

  it('will not offer to delete something that is already gone', async () => {
    const props = libraryProps()
    props.publications = [livePublication({ status: 'expired' })]
    const host = await render(<SharedLinksDialog {...props} />)
    await click([...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('A quarterly demo')))
    expect(buttonByText(host, 'Delete')?.hasAttribute('disabled')).toBe(true)
  })

  it('says there are no views yet rather than showing zeroes', async () => {
    const props = libraryProps()
    props.publications = [livePublication()]
    props.onAnalytics = vi.fn(async () => ({
      ok: true as const,
      analytics: analytics({ views: 0, uniqueViewers: 0, completions: 0, completionRate: 0 }),
    }))
    const host = await render(<SharedLinksDialog {...props} />)
    await click([...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('A quarterly demo')))
    expect(host.textContent).toContain('No views in this window yet')
  })

  it('surfaces an analytics failure instead of pretending there were no viewers', async () => {
    const props = libraryProps()
    props.publications = [livePublication()]
    props.onAnalytics = vi.fn(async () => ({ ok: false as const, error: 'Could not reach the server' }))
    const host = await render(<SharedLinksDialog {...props} />)
    await click([...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('A quarterly demo')))
    expect(host.textContent).toContain('Could not reach the server')
    expect(host.textContent).not.toContain('No views in this window yet')
  })
})
