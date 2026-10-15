// @vitest-environment jsdom
/**
 * The stale scroll-lock guard. A React-remove-scroll style lock (body pointer-events:
 * none) that never releases leaves the window painting normally but ignoring every
 * click — indistinguishable from a dead dialog. The guard must clear it when it is
 * provably stale and never when a dropdown legitimately holds it.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { healStaleScrollLock } from './useStaleScrollLockGuard'

const applyLock = () => {
  document.body.style.pointerEvents = 'none'
  document.body.style.overflow = 'hidden'
  document.body.setAttribute('data-scroll-locked', '1')
}
const isUnlocked = () =>
  document.body.style.pointerEvents === '' &&
  document.body.style.overflow === '' &&
  !document.body.hasAttribute('data-scroll-locked')

beforeEach(() => {
  document.body.innerHTML = ''
  document.body.removeAttribute('style')
  document.body.removeAttribute('data-scroll-locked')
})

describe('healStaleScrollLock', () => {
  it('does nothing when no lock is set', () => {
    expect(healStaleScrollLock()).toBe(false)
    expect(document.body.style.pointerEvents).toBe('')
  })

  for (const markup of [
    '<div role="listbox"></div>',
    '<div role="menu"></div>',
    '<div data-radix-popper-content-wrapper=""></div>',
  ]) {
    it(`keeps a live lock while ${markup.slice(1, 20)}… is mounted`, () => {
      applyLock()
      document.body.innerHTML = markup
      expect(healStaleScrollLock()).toBe(false)
      expect(document.body.style.pointerEvents).toBe('none')
      expect(document.body.hasAttribute('data-scroll-locked')).toBe(true)
    })
  }

  it('clears a lock that no popover holds', () => {
    applyLock()
    document.body.innerHTML = '<div id="root"><button>field</button></div>'
    expect(healStaleScrollLock()).toBe(true)
    expect(isUnlocked()).toBe(true)
  })

  it('clears a lock left only as the data attribute', () => {
    document.body.setAttribute('data-scroll-locked', '1')
    expect(healStaleScrollLock()).toBe(true)
    expect(isUnlocked()).toBe(true)
  })
})
