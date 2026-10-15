// Handlers for export-related IPC (export video).

import { IpcMainInvokeEvent } from 'electron'
import { startExport } from '../../features/export-manager'
import { getEncoderCapabilities } from '../../features/encoder-capabilities'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleStartExport(event: IpcMainInvokeEvent, payload: any) {
  return startExport(event, payload)
}

/** Reports which encoders the bundled FFmpeg has (drives the 8K option). */
export function handleGetExportCapabilities() {
  return getEncoderCapabilities()
}
