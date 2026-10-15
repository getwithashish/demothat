/**
 * Design-token contract (DESIGN_SPEC §2). Guards the invariants the revamp depends
 * on: one token set per theme, no dangling var() references, a >=11px type scale and
 * locally bundled fonts.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../../src', import.meta.url))
const TOKENS = join(SRC, 'styles', 'tokens.css')
const raw = readFileSync(TOKENS, 'utf8')
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')

/** --sa-* declarations from the block(s) whose selector matches `marker`. */
function themeTokens(marker: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const chunk of css.split('}')) {
    const brace = chunk.indexOf('{')
    if (brace < 0) continue
    if (!chunk.slice(0, brace).includes(marker)) continue
    for (const m of chunk.slice(brace + 1).matchAll(/(--sa-[a-z-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  }
  return out
}

const light = themeTokens('[data-theme="light"]')
const dark = themeTokens('[data-theme="dark"]')

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, acc)
    else if (
      ['.ts', '.tsx', '.css'].includes(extname(entry)) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx')
    )
      acc.push(full)
  }
  return acc
}
const files = sourceFiles(SRC)

describe('tokens.css', () => {
  it('defines the same token names in both themes', () => {
    expect(Object.keys(light).length).toBeGreaterThan(10)
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort())
    // Derived states live outside the two theme blocks on purpose.
    expect(readFileSync(TOKENS, 'utf8')).toContain('--sa-ctl-hover:')
  })

  it('has no dangling var(--sa-*) references anywhere in src', () => {
    const defined = new Set([...Object.keys(light), ...Object.keys(dark), '--sa-ctl-hover'])
    const missing = new Set<string>()
    for (const file of files) {
      for (const m of readFileSync(file, 'utf8').matchAll(/var\((--sa-[a-z-]+)[,)]/g)) {
        if (!defined.has(m[1])) missing.add(`${m[1]} (${file.replace(SRC, 'src')})`)
      }
    }
    expect([...missing]).toEqual([])
  })

  it('keeps every type-scale step at or above 11px', () => {
    const scale = [...raw.matchAll(/--text-([a-z-]+):\s*(\d+)px/g)].map((m) => [m[1], Number(m[2])] as const)
    expect(scale.length).toBeGreaterThan(2)
    expect(scale.filter(([, px]) => px < 11)).toEqual([])
  })

  it('provides a global focus-visible indicator for every focusable element', () => {
    expect(raw).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--sa-accent\)/)
  })

  it('bundles fonts locally (no CDN) and declares none outside tokens.css', () => {
    const faces = [...raw.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0])
    expect(faces.length).toBeGreaterThan(0)
    for (const face of faces) {
      expect(face).not.toMatch(/https?:\/\//)
      expect(face).toMatch(/\.woff2/)
    }
    const offenders = files.filter((f) => f !== TOKENS && /font-family|fontFamily/.test(readFileSync(f, 'utf8')))
    expect(offenders.map((f) => f.replace(SRC, 'src'))).toEqual([])
  })
})
