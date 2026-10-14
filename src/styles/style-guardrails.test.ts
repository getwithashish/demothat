/**
 * Style guardrails (Phase 7 audit, enforced): UI chrome takes its colours from
 * tokens.css only, and nothing renders below the 11px type-scale floor.
 *
 * The allowlist below is deliberate: these modules hold USER-CONTENT colours
 * (wallpapers, preset/effect defaults, canvas + native-titlebar values) which are
 * data, not chrome. Each entry has to justify itself here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../../src', import.meta.url))
const TOKENS = join(SRC, 'styles', 'tokens.css')

const DATA_COLOUR_MODULES = new Set([
  'lib/constants.ts', // default colours for user-editable effects
  'lib/renderer.ts', // canvas fill colours used during export
  'lib/utils.ts', // hex/rgba parsing helpers
  'store/slices/frameSlice.ts', // user-editable frame/mask/border defaults
  'store/slices/webcamSlice.ts', // user-editable webcam shadow default
  'store/slices/uiSlice.ts', // Windows native titlebar (Electron takes literals; mirrors --sa-panel/--sa-text)
  'components/editor/PresetPreview.tsx', // preset thumbnail mock of user content
  'components/editor/sidepanel/BackgroundSettings.tsx', // wallpaper + gradient preset palette
  'components/editor/sidepanel/VisualEffectsSettings.tsx', // fallback colour for a user-editable effect
  'components/editor/timeline/Playhead.tsx', // canvas fallback for --sa-accent
])

const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, acc)
    else if (['.ts', '.tsx', '.css'].includes(extname(entry)) && !entry.includes('.test.')) acc.push(full)
  }
  return acc
}

const files = sourceFiles(SRC)

describe('hardcoded styles', () => {
  it('has no colour literals in UI chrome outside tokens.css', () => {
    const offenders: string[] = []
    for (const file of files) {
      if (file === TOKENS) continue
      const rel = relative(SRC, file)
      if (DATA_COLOUR_MODULES.has(rel)) continue
      const code = stripComments(readFileSync(file, 'utf8'))
      // Hex colour, or rgb()/hsl() with numeric literals (not template interpolation).
      const hits = code.match(/#[0-9a-fA-F]{3,8}\b|(?:rgb|hsl)a?\(\s*[0-9]/g) ?? []
      if (hits.length) offenders.push(`${rel}: ${[...new Set(hits)].join(', ')}`)
    }
    expect(offenders).toEqual([])
  })

  it('renders no type below the 11px floor', () => {
    const offenders: string[] = []
    for (const file of files) {
      const code = readFileSync(file, 'utf8')
      for (const m of code.matchAll(/text-\[([\d.]+)(px|rem)\]/g)) {
        const px = m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 16
        if (px < 11) offenders.push(`${relative(SRC, file)}: ${m[0]}`)
      }
      for (const m of code.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)) {
        const px = m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 16
        if (px < 11 && Number(m[1]) !== 0) offenders.push(`${relative(SRC, file)}: ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
