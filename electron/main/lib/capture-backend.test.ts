import { describe, expect, it } from 'vitest'
import { FORCE_OZONE_ENV } from '../../../shared/session'
import { requiresPortalCapture, screenFileCarriesAudio, usesRendererScreenCapture } from './capture-backend'

const env = (values: Record<string, string>): NodeJS.ProcessEnv => values as NodeJS.ProcessEnv
const wayland = env({ XDG_SESSION_TYPE: 'wayland' })
const x11 = env({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' })

describe('usesRendererScreenCapture', () => {
  it('is true on macOS, which captures through ScreenCaptureKit', () => {
    expect(usesRendererScreenCapture('darwin', env({}))).toBe(true)
  })

  it('is true on a Wayland session, where FFmpeg cannot see the screen', () => {
    expect(usesRendererScreenCapture('linux', wayland)).toBe(true)
  })

  it('is false on Linux/X11, which keeps FFmpeg x11grab', () => {
    expect(usesRendererScreenCapture('linux', x11)).toBe(false)
  })

  it('is false on Windows, which keeps FFmpeg gdigrab', () => {
    expect(usesRendererScreenCapture('win32', wayland)).toBe(false)
  })

  it('follows the escape hatch, so forcing X11 restores x11grab', () => {
    expect(usesRendererScreenCapture('linux', env({ XDG_SESSION_TYPE: 'wayland', [FORCE_OZONE_ENV]: 'x11' }))).toBe(
      false,
    )
  })

  it('agrees with the switch decision in main, which is why both read detectSession', () => {
    // Forcing Wayland on an X11 session captures through the portal too, because
    // that is exactly when main appends the Ozone switch.
    expect(usesRendererScreenCapture('linux', env({ DISPLAY: ':0', [FORCE_OZONE_ENV]: 'wayland' }))).toBe(true)
  })
})

describe('screenFileCarriesAudio', () => {
  it('is true only on macOS, where audio rides along in the screen WebM', () => {
    expect(screenFileCarriesAudio('darwin')).toBe(true)
    expect(screenFileCarriesAudio('linux')).toBe(false)
    expect(screenFileCarriesAudio('win32')).toBe(false)
  })

  it('stays false on Wayland, whose audio keeps the Linux path', () => {
    // The two questions are independent: Wayland takes the renderer capture but
    // not macOS's audio model, so a separate system-audio file is still expected.
    expect(screenFileCarriesAudio('linux')).toBe(false)
  })
})

describe('requiresPortalCapture', () => {
  it('is true only on Linux running Wayland', () => {
    expect(requiresPortalCapture('linux', wayland)).toBe(true)
    expect(requiresPortalCapture('linux', x11)).toBe(false)
    expect(requiresPortalCapture('darwin', env({}))).toBe(false)
    expect(requiresPortalCapture('win32', env({}))).toBe(false)
  })
})
