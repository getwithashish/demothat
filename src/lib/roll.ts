/**
 * Family Values Rolling Number System:
 * Smooth odometer roll for numerical values.
 * - Single source of truth for rolling digit animation.
 * - Digits 0-9 smoothly translate vertically with golden ease.
 * - Symbols (%, px, °, ×, s, .) sit cleanly with visible overflow, zero clipping.
 * - Identical baseline across all characters.
 */
interface Slot {
  e: HTMLElement
  ch?: string
  s?: HTMLElement | null
  w?: string
}

interface RollElement extends HTMLElement {
  _c?: Slot[]
}

export function roll(el: HTMLElement | null, str: string | number) {
  if (!el) return
  const rollEl = el as RollElement
  const isFirstMount = !rollEl._c
  const slots: Slot[] = rollEl._c || (rollEl._c = [])
  const s = String(str)
  const fresh: Slot[] = []

  // Prepend columns from the left if more characters are needed
  while (slots.length < s.length) {
    const e = document.createElement('span')
    if (!isFirstMount) {
      e.style.width = '0px'
    }
    el.prepend(e)
    const slot: Slot = { e }
    slots.unshift(slot)
    if (!isFirstMount) {
      fresh.push(slot)
    }
  }

  // Remove columns from the left if fewer characters are needed
  while (slots.length > s.length) {
    const slot = slots.shift()
    if (slot) {
      slot.e.style.width = '0px'
      slot.e.style.opacity = '0'
      setTimeout(() => slot.e.remove(), 400)
    }
  }

  // Map each character to its slot
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    const slot = slots[i]
    if (!slot || slot.ch === ch) continue
    slot.ch = ch

    if (/\d/.test(ch)) {
      slot.e.className = 'roll-digit'
      if (!slot.s) {
        const strip = document.createElement('span')
        strip.className = 'roll-strip'
        strip.innerHTML =
          '<span>0</span><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span>'
        slot.e.replaceChildren(strip)
        slot.s = strip
      }
      slot.s.style.transform = `translateY(${-Number(ch) * 1.1}em)`
      slot.w = '1ch'
    } else {
      slot.e.className = 'roll-symbol'
      slot.s = null
      slot.e.textContent = ch
      slot.w = 'auto'
    }

    if (!fresh.includes(slot)) {
      slot.e.style.width = slot.w
    }
  }

  if (fresh.length > 0) {
    requestAnimationFrame(() => {
      fresh.forEach((slot) => {
        if (slot.w) slot.e.style.width = slot.w
      })
    })
  }
}
