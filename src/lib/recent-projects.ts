// Recent `.dthat` projects: the list logic is pure, the persistence is not.
//
// Kept separate from the store so the dedupe/cap/parse rules can be unit-tested
// without Electron or zustand.

import type { RecentProject } from '../types'

/** How many projects the "Open recent" submenu remembers. */
export const MAX_RECENT_PROJECTS = 10

/** Adds (or refreshes) a project at the front of the list, deduped and capped. */
export function addRecentProject(
  list: RecentProject[],
  entry: RecentProject,
  max: number = MAX_RECENT_PROJECTS,
): RecentProject[] {
  if (!entry?.path) return list
  const withoutDuplicate = list.filter((item) => item.path !== entry.path)
  return [entry, ...withoutDuplicate].slice(0, max)
}

/** Drops one project from the list. */
export function removeRecentProject(list: RecentProject[], path: string): RecentProject[] {
  return list.filter((item) => item.path !== path)
}

/**
 * Reads a stored list defensively: electron-store can hold anything, including
 * a list written by a different version.
 */
export function parseRecentProjects(raw: unknown, max: number = MAX_RECENT_PROJECTS): RecentProject[] {
  if (!Array.isArray(raw)) return []
  const entries: RecentProject[] = []
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue
    const entry = value as Partial<RecentProject>
    if (typeof entry.path !== 'string' || !entry.path) continue
    entries.push({
      path: entry.path,
      name: typeof entry.name === 'string' && entry.name ? entry.name : projectNameFromPath(entry.path),
      openedAt: typeof entry.openedAt === 'number' && Number.isFinite(entry.openedAt) ? entry.openedAt : 0,
    })
  }
  return entries.slice(0, max)
}

/** Display name for a project file path ("/a/b/My Clip.dthat" → "My Clip"). */
export function projectNameFromPath(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? ''
  const withoutExtension = file.replace(/\.dthat$/i, '')
  return withoutExtension || 'Untitled project'
}

/** Characters Windows, macOS and Linux all refuse in a file name. */
const INVALID_NAME_CHARS = /[\\/:*?"<>|]/

/** Control characters are never valid in a file name. */
function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32)
}

/**
 * Validates a new project name (without the extension).
 * Returns an error message for the inline field, or null when it is usable.
 *
 * `existingNames` covers the names already known to the renderer; the main
 * process still checks the filesystem before renaming.
 */
export function validateProjectName(name: string, existingNames: string[] = []): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Enter a name'
  if (trimmed === '.' || trimmed === '..') return 'Enter a name'
  if (INVALID_NAME_CHARS.test(trimmed) || hasControlCharacters(trimmed)) {
    return 'A name cannot contain \\ / : * ? " < > |'
  }
  // A trailing space is trimmed above; a trailing dot is rejected because
  // Windows cannot store such a file.
  if (trimmed.endsWith('.')) return 'A name cannot end with a dot'
  if (trimmed.length > 120) return 'That name is too long'
  const lower = trimmed.toLowerCase()
  if (existingNames.some((existing) => existing.trim().toLowerCase() === lower)) {
    return 'A project with that name already exists here'
  }
  return null
}
