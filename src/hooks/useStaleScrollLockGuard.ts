import { useEffect } from 'react'

/**
 * Selectors that mean "a popper is genuinely on screen right now".
 * Radix renders listboxes, menus and popper wrappers into the document root.
 */
const OPEN_POPOVER_SELECTOR = '[role="listbox"],[role="menu"],[data-radix-popper-content-wrapper]'

/**
 * Radix applies a scroll lock to `<body>` (`pointer-events: none`,
 * `overflow: hidden`, `data-scroll-locked`) while a dropdown is open, and releases
 * it on close. When that release is missed — overlapping locks, or a component
 * unmounting while its dropdown is open — the window keeps painting normally but
 * ignores every click, which is indistinguishable from a dead dialog: the fields
 * are visible and simply do not respond.
 *
 * Heal the lock as soon as it is provably stale: it is set, yet no popover is
 * mounted anywhere in the document.
 *
 * @returns true when a stale lock was cleared.
 */
export function healStaleScrollLock(): boolean {
  const body = document.body
  if (!body) return false

  const locked = body.style.pointerEvents === 'none' || body.hasAttribute('data-scroll-locked')
  if (!locked) return false

  // A live dropdown legitimately holds the lock — leave it alone.
  if (document.querySelector(OPEN_POPOVER_SELECTOR)) return false

  body.style.pointerEvents = ''
  body.style.overflow = ''
  body.removeAttribute('data-scroll-locked')
  return true
}

/**
 * Installs the stale-lock guard for the lifetime of the app. A `<body>` that is
 * inert still delivers `pointerdown` to `<html>`, so this is the earliest a user
 * interaction can be observed.
 */
export function useStaleScrollLockGuard() {
  useEffect(() => {
    healStaleScrollLock()

    const onPointerDown = () => healStaleScrollLock()
    document.addEventListener('pointerdown', onPointerDown, true)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [])
}
