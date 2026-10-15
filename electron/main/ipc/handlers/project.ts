// Handlers for `.dthat` project files (save, save-as, open).

import log from 'electron-log/main'
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

interface SaveRequest {
  project: SaveProjectPayload
  /** Existing destination; when absent the user is asked to choose one. */
  path?: string | null
  /** Auto-save: never prompt, fall back to the recovery copy when unsaved. */
  auto?: boolean
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

export async function handleProjectLoad(_event: IpcMainInvokeEvent, options?: { path?: string }) {
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
    const win = parentWindow()
    const message = (error as Error).message
    if (win) await dialog.showMessageBox(win, { type: 'error', title: 'Could not open project', message })
    else dialog.showErrorBox('Could not open project', message)
    return { canceled: true, error: message }
  }
}

/** The renderer reports whether the open editor has unsaved changes. */
export function handleProjectSetDirty(_event: Electron.IpcMainEvent, dirty: boolean): void {
  appState.editorProjectDirty = !!dirty
}

/** Opens the file picker and loads the chosen project (used by the recorder). */
export async function handleProjectPromptOpen(): Promise<{ opened: boolean }> {
  await promptOpenProject()
  return { opened: true }
}
