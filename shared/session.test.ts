import { describe, expect, it } from 'vitest'
import { detectSession, isWaylandSession, FORCE_OZONE_ENV } from './session'

const env = (values: Record<string, string>): NodeJS.ProcessEnv => values as NodeJS.ProcessEnv

describe('detectSession', () => {
  it('detects Wayland from XDG_SESSION_TYPE', () => {
    expect(detectSession(env({ XDG_SESSION_TYPE: 'wayland' }))).toEqual({
      wayland: true,
      reason: 'wayland-session',
    })
  })

  it('detects Wayland from WAYLAND_DISPLAY alone', () => {
    expect(detectSession(env({ WAYLAND_DISPLAY: 'wayland-0' }))).toEqual({
      wayland: true,
      reason: 'wayland-session',
    })
  })

  it('detects Wayland when both are present, as on a normal session', () => {
    expect(isWaylandSession(env({ XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-1', DISPLAY: ':0' }))).toBe(
      true,
    )
  })

  it('treats GNOME on X11 as X11 even though it may also export WAYLAND_DISPLAY-less env', () => {
    expect(detectSession(env({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }))).toEqual({
      wayland: false,
      reason: 'x11-session',
    })
  })

  it('falls back to X11 when only DISPLAY is set', () => {
    expect(detectSession(env({ DISPLAY: ':0' })).reason).toBe('x11-session')
  })

  it('says unknown rather than guessing when nothing is set', () => {
    expect(detectSession(env({}))).toEqual({ wayland: false, reason: 'unknown' })
  })

  it('ignores empty and whitespace values', () => {
    expect(detectSession(env({ WAYLAND_DISPLAY: '  ', DISPLAY: '   ' })).reason).toBe('unknown')
  })

  it('is case and whitespace insensitive', () => {
    expect(isWaylandSession(env({ XDG_SESSION_TYPE: ' Wayland ' }))).toBe(true)
  })

  describe('the escape hatch', () => {
    it('forces X11 on a Wayland session', () => {
      expect(detectSession(env({ XDG_SESSION_TYPE: 'wayland', [FORCE_OZONE_ENV]: 'x11' }))).toEqual({
        wayland: false,
        reason: 'forced-x11',
      })
    })

    it('forces Wayland even when detection says X11', () => {
      expect(detectSession(env({ XDG_SESSION_TYPE: 'x11', [FORCE_OZONE_ENV]: 'wayland' }))).toEqual({
        wayland: true,
        reason: 'forced-wayland',
      })
    })

    it('ignores a value it does not understand', () => {
      expect(detectSession(env({ XDG_SESSION_TYPE: 'wayland', [FORCE_OZONE_ENV]: 'banana' })).reason).toBe(
        'wayland-session',
      )
    })
  })
})
