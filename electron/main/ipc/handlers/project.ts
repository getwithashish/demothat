// Handlers for `.dthat` project files (save, save-as, open).

import log from 'electron-log/main'
import fs from 'node:fs/promises'
import path from 'node:path'
import { dialog, type IpcMainInvokeEvent } from 'electron'
import { appState } from '../../state'
import {
  PROJECT_FILE_FILTERS,
  ensureProjectExtension,
  getRecoveryProjectPath,
  openProject,
  saveProject,
  type SaveProjectPayload,
} from '../../features/project-file'
import { resolveSaveDestination } from '../../lib/project-file-core'
import { promptOpenProject } from '../../features/project-open'
import { confirmReplaceSession, settleGuardRequest, type SessionVerdict } from '../../features/session-guard'

interface SaveRequest {
  project: SaveProjectPayload
  /** Existing destination; when absent the user is asked to choose one. */
  path?: string | null
  /** Auto-save: never prompt, fall back to the recovery copy when unsaved. */
  auto?: boolean
}

interface SaveCopyRequest {
  project: SaveProjectPayload
  /** Project name without its extension; the copy is "<name> copy.dthat". */
  suggestedName?: string
}

interface RenameRequest {
  currentPath: string
  newName: string
}

interface LoadRequest {
  path?: string
  /** Quiet: do not raise native dialogs (used for "Open recent" entries). */
  quiet?: boolean
}

function parentWindow(): Electron.BrowserWindow | undefined {
  const win = appState.editorWin
  return win && !win.isDestroyed() ? win : undefined
}

function defaultProjectName(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `DemoThat-${stamp}.dthat`
}

async function chooseSavePath(): Promise<string | undefined> {
  const parent = parentWindow()
  const options = {
    title: 'Save Project',
    defaultPath: defaultProjectName(),
    filters: PROJECT_FILE_FILTERS,
  }
  const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return undefined
  return ensureProjectExtension(result.filePath)
}

export async function handleProjectSave(_event: IpcMainInvokeEvent, request: SaveRequest) {
  const destination = resolveSaveDestination({
    requestedPath: request.path,
    auto: request.auto,
    recoveryPath: getRecoveryProjectPath(),
  })
  const destPath = destination
    ? destination.recovery
      ? destination.path
      : ensureProjectExtension(destination.path)
    : await chooseSavePath()
  if (!destPath) return { canceled: true }

  await saveProject(request.project, destPath)
  // A recovery write does not count as "saved" for the dirty flag.
  const recovery = destination?.recovery ?? false
  if (!recovery) appState.editorProjectDirty = false
  return { canceled: false, path: destPath, recovery }
}

export async function handleProjectSaveAs(_event: IpcMainInvokeEvent, project: SaveProjectPayload) {
  const destPath = await chooseSavePath()
  if (!destPath) return { canceled: true }

  await saveProject(project, destPath)
  appState.editorProjectDirty = false
  return { canceled: false, path: destPath }
}

/**
 * Writes a snapshot to a new file.
 *
 * Deliberately does NOT adopt the destination or clear the dirty flag: the
 * project being edited stays where it was and autosave keeps writing there.
 */
export async function handleProjectSaveCopy(_event: IpcMainInvokeEvent, request: SaveCopyRequest) {
  const suggested = typeof request?.suggestedName === 'string' ? request.suggestedName.trim() : ''
  const options = {
    title: 'Save a Copy',
    defaultPath: suggested ? `${suggested} copy.dthat` : defaultProjectName(),
    filters: PROJECT_FILE_FILTERS,
  }
  const parent = parentWindow()
  const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { canceled: true }

  const destPath = ensureProjectExtension(result.filePath)
  try {
    await saveProject(request.project, destPath)
  } catch (error) {
    log.error('[ProjectIpc] Failed to save the copy:', error)
    return { canceled: true, error: (error as Error).message }
  }
  return { canceled: false, path: destPath }
}

/** A file name no platform will accept (path separators, reserved chars). */
function hasUnsafeNameCharacters(name: string): boolean {
  if (/[\\/:*?"<>|]/.test(name)) return true
  return Array.from(name).some((character) => character.charCodeAt(0) < 32)
}

/**
 * Renames the `.dthat` in place. The renderer repoints the session afterwards;
 * anything inside the archive is path-independent, so nothing else moves.
 */
export async function handleProjectRename(_event: IpcMainInvokeEvent, request: RenameRequest) {
  const currentPath = typeof request?.currentPath === 'string' ? request.currentPath : ''
  const newName = typeof request?.newName === 'string' ? request.newName.trim() : ''
  if (!currentPath) return { ok: false, error: 'Save the project before renaming it' }
  if (!newName) return { ok: false, error: 'Enter a name' }
  if (hasUnsafeNameCharacters(newName)) return { ok: false, error: 'A name cannot contain \\ / : * ? " < > |' }

  const directory = path.dirname(currentPath)
  const destPath = path.join(directory, `${newName}.dthat`)
  // Guard against a name that escapes the project's own directory.
  if (path.dirname(destPath) !== directory) return { ok: false, error: 'Enter a name' }
  if (destPath === currentPath) return { ok: true, path: currentPath }

  const taken = await fs
    .access(destPath)
    .then(() => true)
    .catch(() => false)
  if (taken) return { ok: false, error: 'A project with that name already exists here' }

  try {
    await fs.rename(currentPath, destPath)
  } catch (error) {
    log.error('[ProjectIpc] Failed to rename the project:', error)
    return { ok: false, error: (error as Error).message }
  }
  log.info(`[ProjectIpc] Renamed project to ${destPath}`)
  return { ok: true, path: destPath }
}

export async function handleProjectLoad(_event: IpcMainInvokeEvent, options?: LoadRequest) {
  const quiet = !!options?.quiet

  // One guard for every way a session gets replaced, so a renderer-initiated
  // open cannot skip the check the OS-initiated one performs.
  if (!(await confirmReplaceSession('open'))) return { canceled: true }

  let srcPath = options?.path
  if (!srcPath) {
    const parent = parentWindow()
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Open Project',
      filters: PROJECT_FILE_FILTERS,
      properties: ['openFile'],
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    srcPath = result.filePaths[0]
  }

  // A remembered path can point at a file the user has since moved or deleted.
  // Say so plainly rather than failing inside the archive reader.
  if (options?.path) {
    const exists = await fs
      .access(srcPath)
      .then(() => true)
      .catch(() => false)
    if (!exists) {
      log.info(`[ProjectIpc] Project file is missing: ${srcPath}`)
      return { canceled: true, missing: true, error: "That project can't be found" }
    }
  }

  try {
    const opened = await openProject(srcPath)
    appState.editorProjectDirty = false
    return {
      canceled: false,
      project: opened.project,
      manifest: opened.manifest,
      projectPath: opened.projectPath,
    }
  } catch (error) {
    log.error('[ProjectIpc] Failed to open project:', error)
    const message = (error as Error).message
    if (!quiet) {
      const win = parentWindow()
      if (win) await dialog.showMessageBox(win, { type: 'error', title: 'Could not open project', message })
      else dialog.showErrorBox('Could not open project', message)
    }
    return { canceled: true, missing: false, error: message }
  }
}

/** The renderer reports whether the open editor has unsaved changes. */
export function handleProjectSetDirty(_event: Electron.IpcMainEvent, dirty: boolean): void {
  appState.editorProjectDirty = !!dirty
}

/** The renderer's answer to the session guard's "may I replace this session?". */
export function handleBeforeReplaceResult(
  _event: Electron.IpcMainEvent,
  payload: { requestId: string; verdict: SessionVerdict },
): void {
  settleGuardRequest(payload?.requestId, payload?.verdict)
}

/** The renderer's answer to the guard's "please save now". */
export function handlePerformSaveResult(
  _event: Electron.IpcMainEvent,
  payload: { requestId: string; ok: boolean },
): void {
  settleGuardRequest(payload?.requestId, { ok: !!payload?.ok })
}

/** Opens the file picker and loads the chosen project (used by the recorder). */
export async function handleProjectPromptOpen(): Promise<{ opened: boolean }> {
  await promptOpenProject()
  return { opened: true }
}

/** Where a never-saved project's crash copy is, and how old it is. */
export async function handleProjectRecoveryInfo(): Promise<{ exists: boolean; modifiedAt: number | null }> {
  const recoveryPath = getRecoveryProjectPath()
  try {
    const stats = await fs.stat(recoveryPath)
    return { exists: true, modifiedAt: stats.mtimeMs }
  } catch {
    return { exists: false, modifiedAt: null }
  }
}

/**
 * Opens the rolling recovery copy.
 *
 * The returned path is deliberately EMPTY: a recovered project has never been
 * saved by the user, so it must be adopted as untitled (and left dirty), or
 * autosave would start overwriting the recovery copy itself.
 */
export async function handleProjectOpenRecovery() {
  const recoveryPath = getRecoveryProjectPath()
  const exists = await fs
    .access(recoveryPath)
    .then(() => true)
    .catch(() => false)
  if (!exists) return { canceled: true, missing: true, error: 'There is no recovery copy to open.' }

  try {
    const opened = await openProject(recoveryPath)
    log.info('[ProjectIpc] Opened the recovery copy as an unsaved project.')
    return {
      canceled: false,
      project: opened.project,
      manifest: opened.manifest,
      projectPath: '',
      recovered: true,
    }
  } catch (error) {
    log.error('[ProjectIpc] Failed to open the recovery copy:', error)
    return { canceled: true, error: (error as Error).message }
  }
}

/**
 * Deletes the recovery copy. Only ever called once the work it holds has been
 * saved to a real file, by the session that wrote or opened it.
 */
export async function handleProjectDiscardRecovery(): Promise<{ removed: boolean }> {
  try {
    await fs.rm(getRecoveryProjectPath(), { force: true })
    log.info('[ProjectIpc] Removed the recovery copy.')
    return { removed: true }
  } catch (error) {
    log.warn('[ProjectIpc] Could not remove the recovery copy:', error)
    return { removed: false }
  }
}
