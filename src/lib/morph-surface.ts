/**
 * DemoThat — "One Living Organism" Geometry Morph Surface Engine
 * Based on Section 5.5 of Family Values Design Principles.
 *
 * Physically morphs a dialog/surface from its trigger button's exact coordinates,
 * size, and border-radius to the destination rect, and reverses into the trigger on close.
 */

export interface Rect {
  l: number
  t: number
  w: number
  h: number
}

const bez = (x1: number, y1: number, x2: number, y2: number) => (t: number) => {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  let u = t
  for (let i = 0; i < 8; i++) {
    const x = ((ax * u + bx) * u + cx) * u - t
    const d = (3 * ax * u + 2 * bx) * u + cx
    if (Math.abs(x) < 1e-5 || !d) break
    u -= x / d
  }
  return ((ay * u + by) * u + cy) * u
}

/** Travel easing for large distance flight */
export const EZ = bez(0.32, 0.72, 0, 1)

/** Exit easing for closing flight */
export const EX = bez(0.4, 0, 0.2, 1)

/** Golden easing for micro-transitions */
export const EG = bez(0.16, 1, 0.3, 1)

export const rc = (e: Element): Rect => {
  const r = e.getBoundingClientRect()
  return { l: r.left, t: r.top, w: r.width, h: r.height }
}

export const rad = (t: Element): number => {
  if (typeof window === 'undefined') return 6
  const cs = window.getComputedStyle(t)
  const r = parseFloat(cs.borderTopLeftRadius) || 6
  const el = t as HTMLElement
  return Math.min(r, Math.min(el.offsetWidth || 32, el.offsetHeight || 32) / 2)
}

export const getEffectiveBg = (el: HTMLElement): string => {
  if (typeof window === 'undefined') return 'var(--sa-panel)'
  let curr: HTMLElement | null = el
  while (curr && curr !== document.body) {
    const bg = window.getComputedStyle(curr).backgroundColor
    if (bg && bg !== 'transparent' && !bg.endsWith(', 0)') && !bg.endsWith(',0)')) {
      return bg
    }
    curr = curr.parentElement
  }
  return 'var(--sa-panel)'
}

const FROZEN_PROPERTIES = [
  'position',
  'transform',
  'animation',
  'margin',
  'right',
  'bottom',
  'overflow',
  'boxSizing',
  'maxWidth',
  'left',
  'top',
  'width',
  'height',
  'borderRadius',
  'boxShadow',
  'opacity',
] as const

const kids = (el: HTMLElement) => [...el.children].filter((c) => !c.classList.contains('morph-skin')) as HTMLElement[]

export function freeze(el: HTMLElement, r: Rect) {
  const cs = window.getComputedStyle(el)
  const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
  kids(el).forEach((k) => {
    k.style.width = `${r.w - pad}px`
    k.style.minWidth = `${r.w - pad}px`
    k.style.flex = 'none'
  })
  Object.assign(el.style, {
    position: 'fixed',
    transform: 'none',
    animation: 'none',
    margin: '0',
    right: 'auto',
    bottom: 'auto',
    overflow: 'hidden',
    boxSizing: 'border-box',
    maxWidth: 'none',
  })
}

export function thaw(el: HTMLElement, originalStyle?: string) {
  FROZEN_PROPERTIES.forEach((prop) => {
    el.style[prop as unknown as number] = ''
  })
  kids(el).forEach((k) => {
    k.style.width = ''
    k.style.minWidth = ''
    k.style.flex = ''
  })
  if (originalStyle !== undefined) {
    el.setAttribute('style', originalStyle)
  }
}

interface MorphTargetElement extends HTMLElement {
  _morphId?: number
  _morphAnims?: Animation[]
}

export function fly(
  el: MorphTargetElement,
  from: () => Rect,
  to: () => Rect,
  dur: number,
  ease: (t: number) => number,
  r0: number,
  r1: number,
  shadowProgress: (e: number) => number,
  onStep?: (k: number, e: number) => void,
): Promise<boolean> {
  const id = (el._morphId = (el._morphId || 0) + 1)

  return new Promise((resolve) => {
    const t0 = performance.now()
    ;(function frame(now) {
      if (el._morphId !== id) return resolve(false)
      const k = Math.min(1, (now - t0) / dur)
      const e = ease(k)
      const a = from()
      const b = to()
      const m = (x: number, y: number) => x + (y - x) * e

      Object.assign(el.style, {
        left: `${m(a.l, b.l)}px`,
        top: `${m(a.t, b.t)}px`,
        width: `${m(a.w, b.w)}px`,
        height: `${m(a.h, b.h)}px`,
        borderRadius: `${m(r0, r1)}px`,
        boxShadow: `var(--sa-preview-shadow)`,
        opacity: `${Math.min(1, shadowProgress(e) + 0.1)}`,
      })

      onStep?.(k, e)

      if (k < 1) {
        requestAnimationFrame(frame)
      } else {
        resolve(true)
      }
    })(t0)
  })
}

export async function morphOpen({
  surfaceEl,
  triggerEl,
  targetRadius = 12,
  duration = 640,
}: {
  surfaceEl: HTMLElement
  triggerEl: HTMLElement
  targetRadius?: number
  duration?: number
}) {
  const el = surfaceEl as MorphTargetElement
  el._morphId = (el._morphId || 0) + 1

  const finalRect = rc(el)
  const initialRadius = rad(triggerEl)
  const initialInlineStyle = el.getAttribute('style') || ''

  // Find or create skin element for dissolving trigger color into surface
  let skin = el.querySelector<HTMLElement>('.morph-skin')
  if (!skin) {
    skin = document.createElement('div')
    skin.className = 'morph-skin pointer-events-none absolute inset-0 z-50'
    el.prepend(skin)
  }
  const triggerBg = getEffectiveBg(triggerEl)
  skin.style.backgroundColor = triggerBg
  skin.style.borderRadius = 'inherit'

  freeze(el, finalRect)

  // Immediately pin surface over the trigger so it NEVER flashes in the center
  const triggerRect = rc(triggerEl)
  Object.assign(el.style, {
    left: `${triggerRect.l}px`,
    top: `${triggerRect.t}px`,
    width: `${triggerRect.w}px`,
    height: `${triggerRect.h}px`,
    borderRadius: `${initialRadius}px`,
    boxShadow: 'none',
    opacity: '1',
  })

  // Hide the trigger via opacity so layout is never altered and it never gets stuck hidden
  triggerEl.style.opacity = '0'
  triggerEl.style.pointerEvents = 'none'

  // Animate skin dissolving and content fading in
  if (skin.animate) {
    el._morphAnims = [
      skin.animate([{ opacity: 1 }, { opacity: 0.8, offset: 0.25 }, { opacity: 0 }], {
        duration,
        easing: 'ease-out',
        fill: 'forwards',
      }),
      ...kids(el).map((k) =>
        k.animate([{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }], {
          duration,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'forwards',
        }),
      ),
    ]
  }

  const ok = await fly(
    el,
    () => rc(triggerEl),
    () => finalRect,
    duration,
    EZ,
    initialRadius,
    targetRadius,
    (e) => e,
  )

  if (ok) {
    thaw(el, initialInlineStyle)
    if (skin) skin.remove()
  }

  return () => {
    triggerEl.style.opacity = ''
    triggerEl.style.pointerEvents = ''
    triggerEl.style.visibility = ''
  }
}

export async function morphClose({
  surfaceEl,
  triggerEl,
  targetRadius = 12,
  duration = 480,
  onComplete,
}: {
  surfaceEl: HTMLElement
  triggerEl: HTMLElement
  targetRadius?: number
  duration?: number
  onComplete?: () => void
}) {
  const el = surfaceEl as MorphTargetElement
  el._morphId = (el._morphId || 0) + 1

  const currentRect = rc(el)
  const triggerRadius = rad(triggerEl)

  let skin = el.querySelector<HTMLElement>('.morph-skin')
  if (!skin) {
    skin = document.createElement('div')
    skin.className = 'morph-skin pointer-events-none absolute inset-0 z-50'
    el.prepend(skin)
  }
  const triggerBg = getEffectiveBg(triggerEl)
  skin.style.backgroundColor = triggerBg
  skin.style.borderRadius = 'inherit'

  freeze(el, currentRect)

  // Fade out backdrop smoothly along with the return flight
  const backdrop = el.closest<HTMLElement>('.modal-backdrop')
  if (backdrop && backdrop.animate) {
    backdrop.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration,
      fill: 'forwards',
      easing: 'ease-out',
    })
  }

  if (skin.animate) {
    skin.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }], {
      duration,
      fill: 'forwards',
    })
    kids(el).forEach((k) =>
      k.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: Math.round(duration * 0.4),
        fill: 'forwards',
      }),
    )
  }

  await fly(
    el,
    () => currentRect,
    () => rc(triggerEl),
    duration,
    EX,
    targetRadius,
    triggerRadius,
    (e) => 1 - e,
    (k) => {
      // Seamless "One Living Organism" handoff:
      // As the dialog shrinks down into the trigger button's spot (k >= 0.5),
      // crossfade the trigger button in under the shrinking surface so it is
      // ALREADY fully rendered in place when the dialog completes its shrink!
      if (k >= 0.45) {
        const triggerAlpha = Math.min(1, (k - 0.45) / 0.55)
        triggerEl.style.opacity = `${triggerAlpha}`
      }
      if (k >= 0.8) {
        const surfaceAlpha = Math.min(1, (1 - k) / 0.2)
        el.style.opacity = `${surfaceAlpha}`
      }
    },
  )

  // Ensure trigger is completely restored, interactive and visible
  triggerEl.style.opacity = ''
  triggerEl.style.pointerEvents = ''
  triggerEl.style.visibility = ''
  // Hide element completely so it NEVER flashes in center during React unmount
  el.style.display = 'none'
  el.style.opacity = '0'
  el.style.pointerEvents = 'none'
  if (skin) skin.remove()
  onComplete?.()
}
