/**
 * WCAG AA contrast (Phase 7 audit): text and muted text must reach 4.5:1 against every
 * surface they sit on, in both themes. Values are computed from tokens.css, so a token
 * change that breaks legibility fails here.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)
// Prettier may rewrite attribute selectors to single quotes (`[data-theme='light']`),
// so match markers independently of quote style.
const normalizeQuotes = (value: string) => value.replace(/"/g, "'")

function themeTokens(marker: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const chunk of css.split('}')) {
    const brace = chunk.indexOf('{')
    if (brace < 0 || !normalizeQuotes(chunk.slice(0, brace)).includes(normalizeQuotes(marker))) continue
    for (const m of chunk.slice(brace + 1).matchAll(/(--sa-[a-z-]+):\s*([^;]+);/g))
      out[m[1].replace('--sa-', '')] = m[2].trim()
  }
  return out
}

const luminance = (color: string): number | null => {
  if (!color.startsWith('#')) return null
  let hex = color.slice(1)
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)]
  if (la === null || lb === null) throw new Error(`not a hex colour: ${a} / ${b}`)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

const themes = { light: themeTokens('[data-theme="light"]'), dark: themeTokens('[data-theme="dark"]') }

const pairs: Array<[string, string]> = [
  ['text', 'panel'],
  ['text', 'bg'],
  ['text', 'ctl'],
  ['muted', 'panel'],
  ['muted', 'bg'],
  ['muted', 'ctl'],
  ['accent', 'panel'],
  ['accent', 'bg'],
  ['danger', 'panel'],
  ['on-accent', 'accent'],
]

describe('contrast (WCAG AA, 4.5:1 minimum)', () => {
  for (const theme of ['light', 'dark'] as const) {
    describe(theme, () => {
      for (const [fg, bg] of pairs) {
        it(`${fg} on ${bg}`, () => {
          const ratio = contrastRatio(themes[theme][fg], themes[theme][bg])
          expect(
            Number(ratio.toFixed(2)),
            `${fg} ${themes[theme][fg]} on ${bg} ${themes[theme][bg]}`,
          ).toBeGreaterThanOrEqual(4.5)
        })
      }
    })
  }
})
