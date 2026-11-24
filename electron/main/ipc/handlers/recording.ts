// Handlers for recording-related IPC (recording).

import { desktopCapturer } from 'electron'
import path from 'node:path'
import os from 'node:os'
import {
  startRecording,
  loadVideoFromFile,
  stopRecording,
  getSystemAudioWriter,
  getScreenVideoWriter,
  markSystemAudioStopped,
  markScreenCaptureStopped,
} from '../../features/recording-manager'
import { reorderRecordingsInProject, type RecordingSegment } from '../../features/recording-splice'
import { showRecorderWindow } from './app'
import { appState } from '../../state'

export interface ScreenSourceInfo {
  id: string
  name: string
  display_id: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function handleStartRecording(_event: any, options: any) {
  return startRecording(options)
}

export function handleLoadVideoFromFile() {
  return loadVideoFromFile()
}

export async function handleStopRecording() {
  await stopRecording()
}

export function handleRequestClipRecording(_event: unknown, insertTime: number): void {
  appState.recordingTarget = 'editor-clip'
  appState.pendingClipInsertTime =
    typeof insertTime === 'number' && Number.isFinite(insertTime) ? Math.max(0, insertTime) : 0
  showRecorderWindow()
}

/**
 * Receives a chunk of system-audio data (WebM cluster) from the renderer's
 * MediaRecorder and appends it to the on-disk file. Idempotent across
 * stop/abort: if no active session, the writer silently no-ops.
 */
export async function handleWriteSystemAudioChunk(_event: unknown, chunk: ArrayBuffer): Promise<number> {
  if (!(chunk instanceof ArrayBuffer)) {
    throw new Error('writeSystemAudioChunk: payload must be an ArrayBuffer')
  }
  return getSystemAudioWriter().write(Buffer.from(chunk))
}

export function handleSystemAudioStopped(): void {
  markSystemAudioStopped()
}

/**
 * macOS only: receives a chunk of renderer-recorded screen video (WebM
 * cluster) from the renderer's MediaRecorder and appends it to the on-disk
 * file. Same idempotency contract as the system-audio variant.
 */
export async function handleWriteScreenVideoChunk(_event: unknown, chunk: ArrayBuffer): Promise<number> {
  if (!(chunk instanceof ArrayBuffer)) {
    throw new Error('writeScreenVideoChunk: payload must be an ArrayBuffer')
  }
  return getScreenVideoWriter().write(Buffer.from(chunk))
}

export function handleScreenCaptureStopped(): void {
  markScreenCaptureStopped()
}

/**
 * macOS only: returns the list of available screen sources so the renderer
 * can resolve a chosen display.id to a chromeMediaSourceId for getUserMedia.
 * Bypasses the standard display picker — we already know which display the
 * user selected in the recorder UI.
 */
export async function handleGetScreenSources(): Promise<ScreenSourceInfo[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1, height: 1 },
  })
  return sources.map((s) => ({ id: s.id, name: s.name, display_id: s.display_id }))
}

export async function handleReorderRecordings(
  _event: unknown,
  options: { segments: RecordingSegment[]; outputDir?: string },
) {
  const firstSource = options.segments?.[0]?.sourceVideoPath
  const dir = options.outputDir || (firstSource ? path.dirname(firstSource) : os.tmpdir())
  return reorderRecordingsInProject({
    segments: options.segments,
    outputDir: dir,
  })
}
