// Opens a `.dthat` project into the editor: guards, extraction and delivery.
//
// Used by the OS integration (open-file / second-instance / argv) and is the
// single place that decides whether it is safe to replace the current session.

import log from 'electron-log/main'
import { dialog } from 'electron'
import { appState } from '../state'
import { PROJECT_FILE_FILTERS, openProject, type OpenedProject } from './project-file'
import { readProjectManifest } from '../lib/project-file-core'
import { createEditorWindowForProject } from '../windows/editor-window'
import { checkForUpdates } from './update-checker'
import { confirmReplaceSession } from './session-guard'

let appReady = false
let pendingOpenPath: string | null = null

/** Called once the app is ready; flushes any open request queued earlier. */
export function markAppReadyForProjects(): void {
  appReady = true
  const queued = pendingOpenPath
  pendingOpenPath = null
  if (queued) requestOpenProject(queued)
}

/**
 * Requests that srcPath be opened. Before the app is ready the request is
 * queued; afterwards it is handled immediately.
 */
export function requestOpenProject(srcPath: string): void {
  if (!appReady) {
    log.info(`[ProjectOpen] Queuing project open until ready: ${srcPath}`)
    pendingOpenPath = srcPath
    return
  }
  void performOpen(srcPath)
}

/** Extracts a project file path from a process argv list, if present. */
export function findProjectArg(argv: string[]): string | null {
  for (const arg of argv) {
    if (!arg || arg.startsWith('-')) continue
    if (arg.toLowerCase().endsWith('.dthat')) return arg
  }
  return null
}

/** Asks the user to choose a project file, then opens it. */
export async function promptOpenProject(): Promise<void> {
  if (appState.currentRecordingSession) {
    dialog.showErrorBox('Recording in Progress', 'Stop the current recording before opening a project.')
    return
  }
  const parent = appState.editorWin ?? appState.recorderWin ?? undefined
  const options: Electron.OpenDialogOptions = {
    title: 'Open Project',
    filters: PROJECT_FILE_FILTERS,
    properties: ['openFile'],
  }
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return
  requestOpenProject(result.filePaths[0])
}

async function performOpen(srcPath: string): Promise<void> {
  if (appState.currentRecordingSession) {
    dialog.showErrorBox('Recording in Progress', 'Stop the current recording before opening a project.')
    return
  }

  // Fail fast on malformed or too-new archives before touching the editor.
  try {
    await readProjectManifest(srcPath)
  } catch (error) {
    log.error('[ProjectOpen] Rejected project:', error)
    dialog.showErrorBox('Could not open project', (error as Error).message)
    return
  }

  if (!(await confirmReplaceSession('open'))) {
    log.info('[ProjectOpen] The session guard declined to replace the current project.')
    return
  }

  let opened: OpenedProject
  try {
    opened = await openProject(srcPath)
  } catch (error) {
    log.error('[ProjectOpen] Failed to open project:', error)
    dialog.showErrorBox('Could not open project', (error as Error).message)
    return
  }

  deliverProject(opened)
}

function deliverProject(opened: OpenedProject): void {
  const existing = appState.editorWin
  if (existing && !existing.isDestroyed()) {
    existing.webContents.send('project:apply', opened)
    existing.show()
    existing.focus()
    return
  }

  const win = createEditorWindowForProject()
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('project:apply', opened)
    checkForUpdates(win)
  })
}
