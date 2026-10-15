// Electron-facing glue for `.dthat` projects: userData paths, atomic saves and
// extraction. All archive/validation logic lives in lib/project-file-core.ts.

import path from 'node:path'
import log from 'electron-log/main'
import { app } from 'electron'
import {
  CURRENT_PROJECT_FORMAT,
  assertMediaFilesExist,
  extractProjectArchive,
  prepareProjectForSave,
  restoreProjectPaths,
  writeProjectArchive,
  type ProjectFileState,
  type ProjectManifest,
  type ProjectSourceInfo,
} from '../lib/project-file-core'

export const PROJECT_EXTENSION = 'dthat'

export interface SaveProjectPayload {
  /** Serializable editor state; media paths must be absolute. */
  projectState: ProjectFileState
  /** Source video facts for the manifest. */
  source: ProjectSourceInfo
  /** Custom background image bytes (renderer-side blob), if any. */
  backgroundImage?: { data: Uint8Array; ext: string }
}

export interface OpenedProject {
  project: ProjectFileState
  manifest: ProjectManifest
  /** Directory the archive was extracted into. */
  projectDir: string
  /** The archive this project was opened from. */
  projectPath: string
}

/** Dialogs offered when choosing a project file. */
export const PROJECT_FILE_FILTERS = [{ name: 'DemoThat Project', extensions: [PROJECT_EXTENSION] }]

export function getProjectsDir(): string {
  return path.join(app.getPath('userData'), 'projects')
}

/**
 * Rolling recovery copy for projects that have never been saved to a `.dthat`.
 * Auto-save writes here so unsaved work survives a crash; the file is a normal
 * archive and can be opened through File → Open Project.
 */
export function getRecoveryProjectPath(): string {
  return path.join(app.getPath('userData'), 'autosave', 'recovery.dthat')
}

function buildManifest(source: ProjectSourceInfo): ProjectManifest {
  return {
    format: CURRENT_PROJECT_FORMAT,
    appVersion: app.getVersion(),
    createdAt: new Date().toISOString(),
    platform: process.platform,
    source: {
      width: Number(source?.width) || 0,
      height: Number(source?.height) || 0,
      fps: Number(source?.fps) || 0,
      durationSec: Number(source?.durationSec) || 0,
    },
  }
}

/** Saves the project state to destPath as a `.dthat` archive. */
export async function saveProject(payload: SaveProjectPayload, destPath: string): Promise<void> {
  const prepared = prepareProjectForSave(payload.projectState, { backgroundImage: payload.backgroundImage })
  await assertMediaFilesExist(prepared.media)

  await writeProjectArchive({
    destPath,
    manifest: buildManifest(payload.source),
    project: prepared.project,
    media: prepared.media,
    backgroundImage: payload.backgroundImage,
  })
  log.info(`[ProjectFile] Saved project to ${destPath} (${prepared.media.length} media file(s)).`)
}

/** Validates and opens a `.dthat` archive, extracting it under userData. */
export async function openProject(srcPath: string): Promise<OpenedProject> {
  const id = `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const projectDir = path.join(getProjectsDir(), id)

  const { manifest, project } = await extractProjectArchive(srcPath, projectDir)
  const restored = restoreProjectPaths(project, projectDir)
  log.info(`[ProjectFile] Opened project from ${srcPath} into ${projectDir}.`)

  return { project: restored, manifest, projectDir, projectPath: srcPath }
}

/** Ensures the saved path ends with the project extension. */
export function ensureProjectExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`) ? filePath : `${filePath}.${PROJECT_EXTENSION}`
}
