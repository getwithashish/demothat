// @vitest-environment jsdom
/**
 * Credit capsule states (design reference §1) and the devices list (§4). These
 * assertions are the ones the visual reference encodes: which segments appear,
// where the accent fill lands, and when the balance reads as low or empty.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CreditCapsule } from './CreditCapsule'
import { DevicesList } from './DevicesList'
import { devicesSubtitle, formatLastUsed } from './device-copy'
import { useEditorStore } from '../../../store/editorStore'
import { initialLicenseState } from '../../../store/slices/licenseSlice'
import type { DeviceView } from '../../../../shared/license'

// React 18 wants this flag before act() is used in a non-react-testing-library setup.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(node: React.ReactElement): HTMLDivElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(node)
  })
  return container
}

function setLicense(state: Partial<typeof initialLicenseState>): void {
  act(() => {
    useEditorStore.setState({ ...initialLicenseState, ...state })
  })
}

const device: DeviceView = {
  id: 'dev-1',
  label: 'Studio-PC',
  platform: 'Windows',
  active: true,
  activatedAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  current: true,
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
  act(() => {
    useEditorStore.setState({ ...initialLicenseState })
  })
})

const handlers = { onBuyCredits: () => {}, onGetPro: () => {}, onEnterKey: () => {} }

describe('CreditCapsule', () => {
  it('offers Get Pro and Enter key when there is no license', () => {
    setLicense({ plan: null, balance: 0, creditStatus: 'empty' })
    const el = render(<CreditCapsule {...handlers} />)
    expect(el.textContent).toContain('Get Pro')
    expect(el.textContent).toContain('Enter key')
    expect(el.textContent).not.toContain('Buy credits')
  })

  it('shows the Pro badge and the balance when licensed', () => {
    setLicense({ plan: 'pro', balance: 1800, creditStatus: 'normal' })
    const el = render(<CreditCapsule {...handlers} />)
    expect(el.textContent).toContain('Pro')
    expect(el.textContent).toContain('1,800')
    expect(el.textContent).toContain('Buy credits')
    // Normal balance: the Buy segment is not filled with the accent.
    const buy = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Buy credits')
    expect(buy?.className).not.toContain('bg-accent')
    expect(el.querySelector('.animate-credit-pulse')).toBeNull()
  })

  it('fills Buy credits and shows Low at or below the threshold', () => {
    setLicense({ plan: 'pro', balance: 80, creditStatus: 'low' })
    const el = render(<CreditCapsule {...handlers} />)
    expect(el.textContent).toContain('80')
    expect(el.textContent).toContain('Low')
    const buy = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Buy credits')
    expect(buy?.className).toContain('bg-accent')
  })

  it('turns the number danger and pulses when empty', () => {
    setLicense({ plan: 'pro', balance: 0, creditStatus: 'empty' })
    const el = render(<CreditCapsule {...handlers} />)
    expect(el.textContent).toContain('0')
    expect(el.querySelector('.animate-credit-pulse')).not.toBeNull()
    const number = [...el.querySelectorAll('span')].find((s) => s.textContent === '0')
    expect(number?.className).toContain('text-danger')
  })

  it('keeps the devices card closed until the balance is hovered', () => {
    setLicense({ plan: 'pro', balance: 1800, creditStatus: 'normal', licenseDevices: [device] })
    const el = render(<CreditCapsule {...handlers} />)
    expect(el.textContent).not.toContain('Studio-PC')

    const balanceButton = el.querySelector('[aria-haspopup="dialog"]') as HTMLButtonElement
    act(() => {
      balanceButton.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      balanceButton.focus()
    })
    expect(el.textContent).toContain('Studio-PC')
    expect(el.textContent).toContain('This device')
  })
})

describe('DevicesList', () => {
  it('marks the current device and offers Deactivate for the others', () => {
    const other: DeviceView = { ...device, id: 'dev-2', label: 'MacBook Air', platform: 'macOS', current: false }
    const el = render(<DevicesList devices={[device, other]} onDeactivate={() => {}} />)
    expect(el.textContent).toContain('Studio-PC, Windows')
    expect(el.textContent).toContain('This device')
    expect(el.textContent).toContain('MacBook Air, macOS')
    expect(el.textContent).toContain('Deactivate')
    // Only the other device can be deactivated from this computer.
    expect([...el.querySelectorAll('button')]).toHaveLength(1)
  })

  it('says so when the license has no devices yet', () => {
    const el = render(<DevicesList devices={[]} onDeactivate={() => {}} />)
    expect(el.textContent).toContain('No devices are listed')
  })
})

describe('devices copy', () => {
  it('counts the active devices against the 10-slot limit', () => {
    expect(devicesSubtitle([device])).toBe('1 of 10 in use. Deactivate one to free a slot.')
    expect(devicesSubtitle([])).toBe('0 of 10 in use. Deactivate one to free a slot.')
  })

  it('describes when a device was last used', () => {
    const now = Date.UTC(2026, 0, 10)
    expect(formatLastUsed('2026-01-10T00:00:00.000Z', now)).toBe('Last used just now')
    expect(formatLastUsed('2026-01-08T00:00:00.000Z', now)).toBe('Last used 2 days ago')
    expect(formatLastUsed('2025-12-20T00:00:00.000Z', now)).toBe('Last used 3 weeks ago')
    expect(formatLastUsed('not a date', now)).toBe('Last used recently')
  })
})
