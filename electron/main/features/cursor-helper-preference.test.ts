// The preference that keeps a Wayland desktop from being asked twice.
//
// The behaviour worth testing is not "does electron-store work" but the three
// decisions here: which name identifies a desktop, when the helper is skipped, and
// that remembering one desktop does not change the answer for another.

import { describe, expect, it, beforeEach } from 'vitest'
import {
  desktopIdentity,
  forgetEmbeddedOnlyDesktops,
  isEmbeddedOnlyDesktop,
  rememberEmbeddedOnlyDesktop,
  type PreferenceStore,
} from './cursor-helper-preference'

function memoryStore(initial: Record<string, unknown> = {}): PreferenceStore & { data: Record<string, unknown> } {
  const data = { ...initial }
  return {
    data,
    get: (key) => data[key],
    set: (key, value) => {
      data[key] = value
    },
  }
}

const sway = { env: { XDG_CURRENT_DESKTOP: 'sway' } }
const gnome = { env: { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' } }

describe('cursor helper preference', () => {
  let store: ReturnType<typeof memoryStore>

  beforeEach(() => {
    store = memoryStore()
  })

  it('reads the desktop out of the environment, list form included', () => {
    expect(desktopIdentity({ XDG_CURRENT_DESKTOP: 'sway' })).toBe('sway')
    expect(desktopIdentity({ XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' })).toBe('gnome')
    expect(desktopIdentity({ XDG_CURRENT_DESKTOP: 'KDE' })).toBe('kde')
    expect(desktopIdentity({ XDG_SESSION_DESKTOP: 'plasma' })).toBe('plasma')
    // A session with neither variable set is not a desktop we can name, and an
    // unnamed desktop must never be remembered: it would be every desktop.
    expect(desktopIdentity({})).toBeNull()
    expect(desktopIdentity({ XDG_CURRENT_DESKTOP: '  ' })).toBeNull()
  })

  it('starts out unknown, and remembers only what it is told', () => {
    expect(isEmbeddedOnlyDesktop({ ...sway, store })).toBe(false)

    rememberEmbeddedOnlyDesktop({ ...sway, store })
    expect(isEmbeddedOnlyDesktop({ ...sway, store })).toBe(true)
    // A different desktop is a different answer: the user may have switched, and
    // GNOME reports the pointer properly.
    expect(isEmbeddedOnlyDesktop({ ...gnome, store })).toBe(false)
  })

  it('remembering the same desktop twice does not grow the list', () => {
    rememberEmbeddedOnlyDesktop({ ...sway, store })
    rememberEmbeddedOnlyDesktop({ ...sway, store })
    expect(store.data['recorder.cursorHelperEmbeddedOnlyDesktops']).toEqual(['sway'])
  })

  it('does not remember a desktop it cannot name', () => {
    rememberEmbeddedOnlyDesktop({ env: {}, store })
    expect(isEmbeddedOnlyDesktop({ env: {}, store })).toBe(false)
    expect(store.data['recorder.cursorHelperEmbeddedOnlyDesktops']).toBeUndefined()
  })

  it('ignores anything stored that is not a list of names', () => {
    // A hand-edited config, or an older shape. The answer is "not known", which
    // costs one picker, rather than a crash.
    store = memoryStore({ 'recorder.cursorHelperEmbeddedOnlyDesktops': 'sway' })
    expect(isEmbeddedOnlyDesktop({ ...sway, store })).toBe(false)

    store = memoryStore({ 'recorder.cursorHelperEmbeddedOnlyDesktops': [42, 'sway'] })
    expect(isEmbeddedOnlyDesktop({ ...sway, store })).toBe(true)
  })

  it('can forget every answer', () => {
    rememberEmbeddedOnlyDesktop({ ...sway, store })
    rememberEmbeddedOnlyDesktop({ ...gnome, store })
    forgetEmbeddedOnlyDesktops({ store })
    expect(isEmbeddedOnlyDesktop({ ...sway, store })).toBe(false)
    expect(isEmbeddedOnlyDesktop({ ...gnome, store })).toBe(false)
  })
})
