// Which display server the app is running against, and what follows from that.
//
// Wayland changes three things the recorder assumed: FFmpeg cannot grab the
// screen (`x11grab` only ever sees Xwayland's own X11 clients, so native Wayland
// windows come out blank), there is no global cursor coordinate to poll, and the
// screen has to be captured through xdg-desktop-portal instead.
//
// Everything here is a pure function of the environment so it can be tested, and
// so one decision drives both the Chromium switches (main/index.ts) and the
// capture backend (lib/capture-backend.ts) — they must never disagree.

/** Set to `x11` to force the old XWayland/x11grab path, or `wayland` to force the new one. */
export const FORCE_OZONE_ENV = 'DEMOTHAT_OZONE_PLATFORM'

export type SessionReason = 'wayland-session' | 'forced-wayland' | 'forced-x11' | 'x11-session' | 'unknown'

export interface SessionInfo {
  /** The app should run on the Wayland backend and capture through the portal. */
  wayland: boolean
  /** Why we decided that — logged at startup, and used to explain the UI to the user. */
  reason: SessionReason
}

/** What the renderer gets asked-once at startup. */
export interface SessionSummary extends SessionInfo {
  platform: NodeJS.Platform
  /** Which backend the recorder will use: the renderer's portal capture, or FFmpeg grabbing the display. */
  capture: 'renderer' | 'ffmpeg'
}

/**
 * Chromium features that make an Electron 31 app behave properly on Wayland:
 * `WebRTCPipeWireCapturer` routes screen capture through the portal/PipeWire,
 * `WaylandWindowDecorations` draws window decorations the app owns (which Wayland
 * compositors require), and `GlobalShortcutsPortal` lets the recording shortcuts
 * work through the desktop's own shortcut portal instead of failing silently.
 */
export const WAYLAND_CHROMIUM_FEATURES = [
  'WaylandWindowDecorations',
  'WebRTCPipeWireCapturer',
  'GlobalShortcutsPortal',
] as const

/**
 * Reads the session type from the environment.
 *
 * `unknown` (no DISPLAY, no WAYLAND_DISPLAY, no XDG_SESSION_TYPE — a strange
 * launcher, or a test) deliberately keeps the old behaviour rather than
 * guessing: nothing about a running X11 setup changes.
 */
export function detectSession(env: NodeJS.ProcessEnv = process.env): SessionInfo {
  const forced = (env[FORCE_OZONE_ENV] ?? '').trim().toLowerCase()
  if (forced === 'wayland') return { wayland: true, reason: 'forced-wayland' }
  if (forced === 'x11') return { wayland: false, reason: 'forced-x11' }

  const sessionType = (env.XDG_SESSION_TYPE ?? '').trim().toLowerCase()
  const hasWaylandDisplay = (env.WAYLAND_DISPLAY ?? '').trim().length > 0
  if (sessionType === 'wayland' || hasWaylandDisplay) return { wayland: true, reason: 'wayland-session' }

  if (sessionType.length > 0 || (env.DISPLAY ?? '').trim().length > 0) {
    return { wayland: false, reason: 'x11-session' }
  }
  return { wayland: false, reason: 'unknown' }
}

/** Shorthand for the common question. */
export function isWaylandSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return detectSession(env).wayland
}
