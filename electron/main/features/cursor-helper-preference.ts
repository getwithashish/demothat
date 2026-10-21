// Remembers which desktops cannot hand the pointer over separately.
//
// On a compositor whose portal refuses metadata cursor mode (Sway, and anything else
// backed by xdg-desktop-portal-wlr) trying the helper costs the user a second
// picker: the portal's dialog for the helper's doomed attempt, and then the
// browser's, which is the one that actually records. The desktop has already given
// its answer, so it is remembered and the helper is skipped next time — one picker,
// same recording. The answer is keyed by desktop, so switching to GNOME tries again
// without the user having to know there was anything to reset.

import Store from 'electron-store'

const SETTING = 'recorder.cursorHelperEmbeddedOnlyDesktops'

/** The slice of electron-store this needs, so tests can hand in a Map-backed one. */
export interface PreferenceStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

/**
 * Just the variables this reads. Deliberately not `NodeJS.ProcessEnv`, which this
 * project augments with required Vite entries — a real environment and a two-key
 * object in a test are both fine here.
 */
export type DesktopEnv = Record<string, string | undefined>

interface Options {
  env?: DesktopEnv
  store?: PreferenceStore
}

export function defaultPreferenceStore(): PreferenceStore {
  return new Store() as unknown as PreferenceStore
}

/**
 * The desktop's own name for itself: `GNOME`, `KDE`, `sway`, `ubuntu:GNOME`.
 *
 * `XDG_CURRENT_DESKTOP` may be a colon-separated list whose last entry is the
 * desktop proper. Lowercased so a difference in case does not turn into a second
 * failed attempt.
 */
export function desktopIdentity(env: DesktopEnv = process.env): string | null {
  const raw = env.XDG_CURRENT_DESKTOP || env.XDG_SESSION_DESKTOP
  if (typeof raw !== 'string') return null
  const name = raw
    .split(':')
    .map((part) => part.trim())
    .filter(Boolean)
    .pop()
  return name ? name.toLowerCase() : null
}

function readDesktops(store: PreferenceStore): string[] {
  const raw = store.get(SETTING)
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is string => typeof entry === 'string')
}

/** True when this desktop has already told us it cannot report the pointer. */
export function isEmbeddedOnlyDesktop(options: Options = {}): boolean {
  const desktop = desktopIdentity(options.env ?? process.env)
  if (!desktop) return false
  return readDesktops(options.store ?? defaultPreferenceStore()).includes(desktop)
}

/** Records that this desktop records the pointer into the pixels. */
export function rememberEmbeddedOnlyDesktop(options: Options = {}): void {
  const desktop = desktopIdentity(options.env ?? process.env)
  if (!desktop) return
  const store = options.store ?? defaultPreferenceStore()
  const known = readDesktops(store)
  if (known.includes(desktop)) return
  store.set(SETTING, [...known, desktop])
}

/** Forgets every answer, so the helper is tried again on all of them. */
export function forgetEmbeddedOnlyDesktops(options: Options = {}): void {
  ;(options.store ?? defaultPreferenceStore()).set(SETTING, [])
}
