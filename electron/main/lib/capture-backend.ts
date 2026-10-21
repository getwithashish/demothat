// Which half of the code records the screen, and what that implies for audio.
//
// Two questions, often confused, which is why they are two functions:
//
//   1. Where do the screen *pixels* come from? Either FFmpeg grabbing the
//      display (X11, Windows) or the renderer's Chromium capture (macOS via
//      ScreenCaptureKit, Wayland via xdg-desktop-portal). The renderer path
//      writes a WebM that the main process then muxes.
//
//   2. Does that renderer WebM already carry the audio the user asked for?
//      On macOS yes — the system-audio loopback is grafted onto the screen
//      stream before MediaRecorder sees it. On Linux (Wayland included) no:
//      the microphone and system audio are captured separately and folded in
//      by the mux step. Keeping this separate from (1) is what lets Wayland
//      reuse the renderer capture without also inheriting macOS's audio model.

import { detectSession } from '../../../shared/session'

/**
 * True when the renderer captures the screen (and main muxes a WebM), false
 * when FFmpeg grabs the display itself.
 */
export function usesRendererScreenCapture(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (platform === 'darwin') return true
  return platform === 'linux' && detectSession(env).wayland
}

/**
 * True when the renderer's screen file already contains the requested audio,
 * so main must not expect a separate system-audio file.
 */
export function screenFileCarriesAudio(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin'
}

/** True when the FFmpeg screen input is unusable and the portal path is the only option. */
export function requiresPortalCapture(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return platform === 'linux' && detectSession(env).wayland
}
