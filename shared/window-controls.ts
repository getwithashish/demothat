export type WindowControlAction = 'close' | 'minimize' | 'maximize'
export type WindowControlsPlacement = 'left' | 'right'
export type WindowControlsVariant = 'windows' | 'macos' | 'gnome' | 'kde' | 'xfce' | 'cinnamon' | 'mate' | 'generic'
export type LinuxDesktopEnvironment = 'gnome' | 'kde' | 'xfce' | 'cinnamon' | 'mate' | 'unknown'
export type WindowControlsAppearance = 'light' | 'dark'

export interface WindowControlsConfig {
  platform: NodeJS.Platform
  desktopEnvironment: LinuxDesktopEnvironment
  distro: string | null
  variant: WindowControlsVariant
  placement: WindowControlsPlacement
  buttons: WindowControlAction[]
  leftButtons: WindowControlAction[]
  rightButtons: WindowControlAction[]
  appearance: WindowControlsAppearance
  rawLayout?: string | null
  themeName?: string | null
  iconTheme?: string | null
}

export interface ParsedButtonSides {
  left: WindowControlAction[]
  right: WindowControlAction[]
}

export interface ResolveWindowControlsInput {
  platform: NodeJS.Platform
  desktopEnvironment?: LinuxDesktopEnvironment
  distro?: string | null
  distroLike?: string[]
  rawLayout?: string | null
  kdeButtonsOnLeft?: string | null
  kdeButtonsOnRight?: string | null
  appearance?: WindowControlsAppearance
  themeName?: string | null
  iconTheme?: string | null
  placementOverride?: WindowControlsPlacement | null
  buttonsOverride?: WindowControlAction[] | null
}

const DEFAULT_RIGHT_ORDER: WindowControlAction[] = ['minimize', 'maximize', 'close']
const DEFAULT_LEFT_ORDER: WindowControlAction[] = ['close', 'minimize', 'maximize']

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

function dedupeSides(left: WindowControlAction[], right: WindowControlAction[]): ParsedButtonSides {
  const seen = new Set<WindowControlAction>()
  const uniqueLeft: WindowControlAction[] = []
  const uniqueRight: WindowControlAction[] = []
  for (const btn of left) {
    if (!seen.has(btn)) {
      seen.add(btn)
      uniqueLeft.push(btn)
    }
  }
  for (const btn of right) {
    if (!seen.has(btn)) {
      seen.add(btn)
      uniqueRight.push(btn)
    }
  }
  return { left: uniqueLeft, right: uniqueRight }
}

/**
 * Identifies the active Linux desktop environment from standard XDG/session env vars.
 * Unrecognized window managers (e.g. sway, hyprland, i3, lxqt) return 'unknown'.
 */
export function detectLinuxDesktopEnvironment(env: Record<string, string | undefined>): LinuxDesktopEnvironment {
  const candidates = [env.XDG_CURRENT_DESKTOP, env.XDG_SESSION_DESKTOP, env.DESKTOP_SESSION]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .flatMap((raw) =>
      raw
        .split(':')
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean),
    )

  for (const token of candidates) {
    if (token === 'kde' || token === 'plasma' || token.includes('kde') || token.includes('plasma')) {
      return 'kde'
    }
    if (token === 'x-cinnamon' || token === 'cinnamon' || token.includes('cinnamon')) {
      return 'cinnamon'
    }
    if (token === 'mate' || token.includes('mate')) {
      return 'mate'
    }
    if (token === 'xfce' || token === 'xfce4' || token === 'xubuntu' || token.includes('xfce')) {
      return 'xfce'
    }
    if (token === 'gnome' || token === 'unity' || token.includes('gnome') || token.includes('unity')) {
      return 'gnome'
    }
  }

  return 'unknown'
}

/**
 * Parses `/etc/os-release` content for distribution ID and ID_LIKE tokens.
 */
export function parseOsRelease(content: string): { id: string | null; idLike: string[] } {
  let id: string | null = null
  let idLike: string[] = []

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex <= 0) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const rawValue = stripQuotes(trimmed.slice(eqIndex + 1)).toLowerCase()
    if (key === 'ID' && rawValue) {
      id = rawValue
    } else if (key === 'ID_LIKE' && rawValue) {
      idLike = rawValue.split(/\s+/).filter(Boolean)
    }
  }

  return { id, idLike }
}

/**
 * Parses GTK-style colon-separated `button-layout` strings used by GNOME, Cinnamon, and MATE.
 * Examples:
 * - `':minimize,maximize,close'` -> `{ left: [], right: ['minimize', 'maximize', 'close'] }`
 * - `'close,minimize,maximize:'` -> `{ left: ['close', 'minimize', 'maximize'], right: [] }`
 * - `'close:minimize,maximize'`  -> `{ left: ['close'], right: ['minimize', 'maximize'] }`
 */
export function parseGtkButtonLayout(raw: string | null | undefined): ParsedButtonSides | null {
  if (typeof raw !== 'string') return null
  const cleaned = stripQuotes(raw)
  if (!cleaned) return null

  const colonIdx = cleaned.indexOf(':')
  const leftPart = colonIdx === -1 ? '' : cleaned.slice(0, colonIdx)
  const rightPart = colonIdx === -1 ? cleaned : cleaned.slice(colonIdx + 1)

  const parseSide = (part: string): WindowControlAction[] => {
    const out: WindowControlAction[] = []
    for (const token of part.split(',')) {
      const normalized = token.trim().toLowerCase()
      if (normalized === 'close' || normalized === 'minimize' || normalized === 'maximize') {
        out.push(normalized)
      }
    }
    return out
  }

  const parsed = dedupeSides(parseSide(leftPart), parseSide(rightPart))
  if (parsed.left.length === 0 && parsed.right.length === 0) return null
  return parsed
}

/**
 * Parses KDE KDecoration2 `ButtonsOnLeft` / `ButtonsOnRight` strings from `kwinrc`.
 * KDE codes: `X` = close, `I` = minimize (iconify), `A` = maximize (all).
 * When `ButtonsOnRight` is omitted (`null`/`undefined`) and `ButtonsOnLeft` has no
 * window-control codes (e.g. `ButtonsOnLeft=MFS`), KDE Breeze defaults to `IAX` on the right.
 */
export function parseKdeButtonLayout(
  buttonsOnLeft?: string | null,
  buttonsOnRight?: string | null,
): ParsedButtonSides | null {
  if (buttonsOnLeft == null && buttonsOnRight == null) return null

  const parseCodes = (raw: string | null | undefined): WindowControlAction[] => {
    if (typeof raw !== 'string') return []
    const cleaned = stripQuotes(raw)
    const out: WindowControlAction[] = []
    for (const ch of cleaned) {
      if (ch === 'X') out.push('close')
      else if (ch === 'I') out.push('minimize')
      else if (ch === 'A') out.push('maximize')
    }
    return out
  }

  const left = parseCodes(buttonsOnLeft)
  const rightExplicit = buttonsOnRight != null
  const right = rightExplicit ? parseCodes(buttonsOnRight) : left.length === 0 ? [...DEFAULT_RIGHT_ORDER] : []

  const parsed = dedupeSides(left, right)
  if (parsed.left.length === 0 && parsed.right.length === 0) return null
  return parsed
}

/**
 * Parses XFCE Xfwm4 `button_layout` strings (e.g. `'O|SHMC'`, `'CMH|O'`).
 * Codes: `C` = close, `H` = minimize (hide), `M` = maximize, `|` = left/right separator.
 */
export function parseXfceButtonLayout(raw: string | null | undefined): ParsedButtonSides | null {
  if (typeof raw !== 'string') return null
  const cleaned = stripQuotes(raw)
  if (!cleaned) return null

  const pipeIdx = cleaned.indexOf('|')
  const leftPart = pipeIdx === -1 ? '' : cleaned.slice(0, pipeIdx)
  const rightPart = pipeIdx === -1 ? cleaned : cleaned.slice(pipeIdx + 1)

  const parseCodes = (part: string): WindowControlAction[] => {
    const out: WindowControlAction[] = []
    for (const ch of part) {
      if (ch === 'C') out.push('close')
      else if (ch === 'H') out.push('minimize')
      else if (ch === 'M') out.push('maximize')
    }
    return out
  }

  const parsed = dedupeSides(parseCodes(leftPart), parseCodes(rightPart))
  if (parsed.left.length === 0 && parsed.right.length === 0) return null
  return parsed
}

/**
 * Infers light/dark appearance from Linux desktop theme strings when available.
 */
export function parseLinuxThemeDarkHint(
  themeName?: string | null,
  colorScheme?: string | null,
): WindowControlsAppearance | null {
  if (typeof colorScheme === 'string') {
    const normalized = stripQuotes(colorScheme).toLowerCase()
    if (normalized === 'prefer-dark') return 'dark'
    if (normalized === 'prefer-light') return 'light'
  }
  if (typeof themeName === 'string') {
    const normalized = stripQuotes(themeName).toLowerCase()
    if (!normalized) return null
    if (normalized.includes('dark') || normalized.includes('noir') || normalized.includes('night')) {
      return 'dark'
    }
    return 'light'
  }
  return null
}

function defaultLinuxSidesForSetup(
  de: LinuxDesktopEnvironment,
  distro: string | null,
  distroLike: string[],
): ParsedButtonSides {
  // elementary OS / Pantheon places controls on the left by default.
  if (distro === 'elementary' || distroLike.includes('elementary')) {
    return { left: [...DEFAULT_LEFT_ORDER], right: [] }
  }
  // Standard default for GNOME (Ubuntu/modern), KDE Breeze, XFCE, Cinnamon, MATE, and fallback.
  void de
  return { left: [], right: [...DEFAULT_RIGHT_ORDER] }
}

/**
 * Resolves the complete window-control configuration (variant, placement, button order,
 * left/right split, and theme appearance) for Windows, macOS, and Linux desktops.
 */
export function resolveWindowControlsConfig(input: ResolveWindowControlsInput): WindowControlsConfig {
  const appearance: WindowControlsAppearance = input.appearance ?? 'light'
  const distro = input.distro ?? null
  const distroLike = input.distroLike ?? []

  if (input.platform === 'win32') {
    const buttons = input.buttonsOverride?.length ? [...input.buttonsOverride] : [...DEFAULT_RIGHT_ORDER]
    const placement = input.placementOverride ?? 'right'
    return {
      platform: 'win32',
      desktopEnvironment: 'unknown',
      distro,
      variant: 'windows',
      placement,
      buttons,
      leftButtons: placement === 'left' ? buttons : [],
      rightButtons: placement === 'right' ? buttons : [],
      appearance,
      rawLayout: input.rawLayout ?? null,
      themeName: input.themeName ?? null,
      iconTheme: input.iconTheme ?? null,
    }
  }

  if (input.platform === 'darwin') {
    const buttons = input.buttonsOverride?.length ? [...input.buttonsOverride] : [...DEFAULT_LEFT_ORDER]
    const placement = input.placementOverride ?? 'left'
    return {
      platform: 'darwin',
      desktopEnvironment: 'unknown',
      distro,
      variant: 'macos',
      placement,
      buttons,
      leftButtons: placement === 'left' ? buttons : [],
      rightButtons: placement === 'right' ? buttons : [],
      appearance,
      rawLayout: input.rawLayout ?? null,
      themeName: input.themeName ?? null,
      iconTheme: input.iconTheme ?? null,
    }
  }

  const de: LinuxDesktopEnvironment = input.desktopEnvironment ?? 'unknown'
  const variant: WindowControlsVariant = de === 'unknown' ? 'generic' : de

  let parsedSides: ParsedButtonSides | null = null
  if (de === 'kde') {
    parsedSides = parseKdeButtonLayout(input.kdeButtonsOnLeft, input.kdeButtonsOnRight)
  } else if (de === 'xfce') {
    parsedSides = parseXfceButtonLayout(input.rawLayout)
  } else if (de === 'gnome' || de === 'cinnamon' || de === 'mate') {
    parsedSides = parseGtkButtonLayout(input.rawLayout)
  } else if (input.rawLayout) {
    // Custom/unrecognized Linux setup with a user-supplied GTK or XFCE layout string
    parsedSides = parseGtkButtonLayout(input.rawLayout) ?? parseXfceButtonLayout(input.rawLayout)
  }

  let { left, right } = parsedSides ?? defaultLinuxSidesForSetup(de, distro, distroLike)

  if (input.buttonsOverride?.length) {
    const targetSide = input.placementOverride ?? (left.length > 0 && right.length === 0 ? 'left' : 'right')
    left = targetSide === 'left' ? [...input.buttonsOverride] : []
    right = targetSide === 'right' ? [...input.buttonsOverride] : []
  } else if (input.placementOverride) {
    const combined = [...left, ...right]
    if (input.placementOverride === 'left') {
      left = combined
      right = []
    } else {
      left = []
      right = combined
    }
  }

  const placement: WindowControlsPlacement =
    left.length > 0 && right.length === 0
      ? 'left'
      : right.length > 0 && left.length === 0
        ? 'right'
        : left.includes('close')
          ? 'left'
          : 'right'

  const buttons: WindowControlAction[] =
    placement === 'left' && right.length === 0
      ? left
      : placement === 'right' && left.length === 0
        ? right
        : [...left, ...right]

  return {
    platform: input.platform,
    desktopEnvironment: de,
    distro,
    variant,
    placement,
    buttons,
    leftButtons: left,
    rightButtons: right,
    appearance,
    rawLayout: input.rawLayout ?? null,
    themeName: input.themeName ?? null,
    iconTheme: input.iconTheme ?? null,
  }
}
