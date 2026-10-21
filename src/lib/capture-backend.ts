// Which capture backend the recorder is running, and what the UI has to do
// differently because of it.
//
// The backend is decided in the main process (shared/session.ts → detectSession,
// lib/capture-backend.ts), because that is also where the Chromium switches are
// set. It is exposed to the renderer as a SessionSummary; this module turns that
// summary into the handful of questions the recorder UI actually asks, so the
// answer lives in one place instead of being spelled out at each call site.
//
// Nothing here captures anything. src/lib/screen-capture.ts does the capturing,
// for macOS and Wayland alike — the browser APIs are the same, the differences
// are these traits.

export interface CaptureTraits {
  /** The renderer captures the screen and main muxes a WebM (macOS, Wayland). */
  usesRendererCapture: boolean
  /** The renderer folds system audio into the screen stream itself (macOS only). */
  systemAudioRidesInScreenStream: boolean
  /** The app's own display picker decides the source (false when the portal does). */
  displayPickerSupported: boolean
  /** Global cursor position and clicks are observable, so a synthetic cursor can be drawn. */
  cursorTelemetry: boolean
  /** Something the user should know about this backend, or null when there is nothing to say. */
  notice: string | null
}

export type CaptureKind = 'renderer' | 'ffmpeg' | 'helper'

const FALLBACK: CaptureTraits = {
  usesRendererCapture: false,
  systemAudioRidesInScreenStream: false,
  displayPickerSupported: true,
  cursorTelemetry: true,
  notice: null,
}

/**
 * @param platform - process.platform, or null before it is known.
 * @param wayland - Whether main decided to use the Wayland backend, or null when unknown.
 * @param capture - Which backend main will use, from the session summary.
 */
export function resolveCaptureBackend(
  platform: NodeJS.Platform | null,
  wayland: boolean | null,
  capture: CaptureKind | null = null,
): CaptureTraits {
  if (capture === 'helper') {
    // The native helper captures. It owns the screen-cast session, so the renderer
    // must not open one of its own — and the pointer is data rather than pixels,
    // which is what makes the editor's cursor work at all on Wayland.
    //
    // No notice: everything the user cares about works, and the system dialog
    // explains itself. A note here would only be noise.
    return {
      usesRendererCapture: false,
      systemAudioRidesInScreenStream: false,
      displayPickerSupported: false,
      cursorTelemetry: true,
      notice: null,
    }
  }

  if (platform === 'darwin') {
    return {
      usesRendererCapture: true,
      systemAudioRidesInScreenStream: true,
      displayPickerSupported: true,
      cursorTelemetry: true,
      notice: null,
    }
  }

  if (platform === 'linux' && wayland) {
    return {
      usesRendererCapture: true,
      systemAudioRidesInScreenStream: false,
      displayPickerSupported: false,
      cursorTelemetry: false,
      // One short sentence, only when something the user might expect is missing.
      // The screen-share dialog explains the rest by itself.
      notice: 'This desktop records the pointer into the video, so cursor effects are unavailable.',
    }
  }

  return FALLBACK
}

/** True when the recorder should ask the user for an area, then crop to it. */
export function cropsAfterCapture(platform: NodeJS.Platform | null, wayland: boolean | null): boolean {
  return platform === 'linux' && wayland === true
}
