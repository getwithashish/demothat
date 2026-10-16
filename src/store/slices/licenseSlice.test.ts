// @vitest-environment jsdom
/**
 * The license slice is the renderer's only view of the plan/balance/devices. Its
 * job is small but load-bearing: map an IPC summary onto the capsule's state, and
 * surface activation failures without throwing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '../editorStore'
import { initialLicenseState } from './licenseSlice'
import type { DeviceView } from '../../../shared/license'

const device: DeviceView = {
  id: 'dev-1',
  label: 'Studio-PC',
  platform: 'Windows',
  active: true,
  activatedAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  current: true,
}

type Bridge = NonNullable<typeof window.electronAPI>

function stubBridge(overrides: Partial<Bridge>): void {
  ;(window as unknown as { electronAPI: unknown }).electronAPI = overrides
}

beforeEach(() => {
  useEditorStore.setState({ ...initialLicenseState })
})

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
  useEditorStore.setState({ ...initialLicenseState })
})

describe('refreshBalance', () => {
  it('maps the summary onto plan, balance and status', async () => {
    stubBridge({
      getLicenseSummary: vi.fn(async () => ({ plan: 'pro', balance: 80, devices: [device] })),
    } as unknown as Partial<Bridge>)

    await useEditorStore.getState().refreshBalance()

    const state = useEditorStore.getState()
    expect(state.plan).toBe('pro')
    expect(state.balance).toBe(80)
    expect(state.creditStatus).toBe('low')
    expect(state.licenseDevices).toEqual([device])
  })

  it('reports empty for an unlicensed device', async () => {
    stubBridge({
      getLicenseSummary: vi.fn(async () => ({ plan: null, balance: 0, devices: [] })),
    } as unknown as Partial<Bridge>)

    await useEditorStore.getState().refreshBalance()

    expect(useEditorStore.getState().creditStatus).toBe('empty')
  })

  it('keeps the last known values when the bridge is missing', async () => {
    await expect(useEditorStore.getState().refreshBalance()).resolves.toBeUndefined()
    expect(useEditorStore.getState().balance).toBe(0)
  })
})

describe('activateLicense', () => {
  it('returns true and adopts the result on success', async () => {
    stubBridge({
      activateLicense: vi.fn(async () => ({ ok: true as const, plan: 'pro', balance: 1800, devices: [device] })),
    } as unknown as Partial<Bridge>)

    await expect(useEditorStore.getState().activateLicense('DODO-1234')).resolves.toBe(true)
    expect(useEditorStore.getState().balance).toBe(1800)
    expect(useEditorStore.getState().licenseError).toBeNull()
  })

  it('returns false and keeps the message on failure', async () => {
    stubBridge({
      activateLicense: vi.fn(async () => ({
        ok: false as const,
        code: 'device_limit_reached',
        message: 'This license has no free device slots.',
        devices: [device],
      })),
    } as unknown as Partial<Bridge>)

    await expect(useEditorStore.getState().activateLicense('DODO-1234')).resolves.toBe(false)
    const state = useEditorStore.getState()
    expect(state.licenseError).toBe('This license has no free device slots.')
    expect(state.licenseDevices).toEqual([device])
    expect(state.licenseBusy).toBe(false)
  })
})

describe('deactivateDevice', () => {
  it('replaces the device list on success', async () => {
    stubBridge({
      deactivateLicenseDevice: vi.fn(async () => ({ ok: true as const, devices: [] })),
    } as unknown as Partial<Bridge>)

    await expect(useEditorStore.getState().deactivateDevice('dev-2')).resolves.toBe(true)
    expect(useEditorStore.getState().licenseDevices).toEqual([])
  })

  it('records the failure message', async () => {
    stubBridge({
      deactivateLicenseDevice: vi.fn(async () => ({ ok: false as const, message: 'Offline.' })),
    } as unknown as Partial<Bridge>)

    await expect(useEditorStore.getState().deactivateDevice('dev-2')).resolves.toBe(false)
    expect(useEditorStore.getState().licenseError).toBe('Offline.')
  })
})
