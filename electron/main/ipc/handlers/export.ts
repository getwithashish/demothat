// Handlers for export-related IPC (export video).

import { IpcMainInvokeEvent } from 'electron'
import { startExport } from '../../features/export-manager'
import { getEncoderCapabilities } from '../../features/encoder-capabilities'
import { getEntitlement, getUnlockUrl } from '../../features/entitlement'
import { getExportPerfSamples } from '../../features/export-perf'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleStartExport(event: IpcMainInvokeEvent, payload: any) {
  return startExport(event, payload)
}

/** Reports which encoders the bundled FFmpeg has (drives the 8K option). */
export function handleGetExportCapabilities() {
  return getEncoderCapabilities()
}

/** Local Pro state (a soft gate; see features/entitlement.ts). */
export async function handleGetEntitlement() {
  const entitlement = await getEntitlement()
  return { ...entitlement, unlockUrl: getUnlockUrl() }
}

/** Measured export throughput, used for the rough render-time estimates. */
export function handleGetExportPerf() {
  return getExportPerfSamples()
}
