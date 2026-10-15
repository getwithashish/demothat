// Pure helpers for the `.dthat` project archive.
//
// Deliberately free of Electron imports so the whole save/open round-trip,
// the zip-slip checks and the size/format caps can be unit tested with plain
// Node (see project-file-core.test.ts). The Electron glue (userData paths,
// dialogs) lives in features/project-file.ts.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { ZipFile } from 'yazl'
import { open as openZipFile, type Entry, type ZipFile as YauzlZipFile } from 'yauzl'

/** Format version written by this build. Refuse anything newer. */
export const CURRENT_PROJECT_FORMAT = 1

export const MANIFEST_NAME = 'manifest.json'
export const PROJECT_NAME = 'project.json'
export const MEDIA_DIR = 'media'
export const THUMBNAIL_NAME = 'thumbnail.jpg'

/** Hard caps for untrusted archives. */
export const MAX_ENTRY_COUNT = 2000
export const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024 * 1024 // 20 GB
/** manifest.json / project.json are tiny; anything larger is a red flag. */
const MAX_JSON_BYTES = 8 * 1024 * 1024

/** Thrown for any malformed or unsafe project archive. Message is user-facing. */
export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectFileError'
  }
}

export interface ProjectSourceInfo {
  width: number
  height: number
  fps: number
  durationSec: number
}

export interface ProjectManifest {
  format: number
  appVersion: string
  createdAt: string
  platform: string
  source: ProjectSourceInfo
}

/**
 * The serializable editor state stored in project.json. Only the path-bearing
 * fields are typed precisely; everything else rides along untouched.
 */
export interface ProjectFileState {
  videoPath: string
  /** Path to the mouse-event metadata JSON (copied into media/). */
  metadataPath?: string | null
  webcamVideoPath?: string | null
  mouseClickSoundPath?: string | null
  frameStyles?: Record<string, unknown> & {
    background?: Record<string, unknown> & { type?: string; imageUrl?: string }
  }
  audioClips?: Array<Record<string, unknown> & { filePath?: string }>
  videoClips?: Array<Record<string, unknown> & { filePath?: string }>
  [key: string]: unknown
}

export interface MediaEntry {
  /** Absolute path to the source file on disk. */
  source: string
  /** Path inside the archive, always under `media/`. */
  archivePath: string
}

/** Refuses to save a project whose media has gone missing, with a clear message. */
export async function assertMediaFilesExist(media: MediaEntry[]): Promise<void> {
  for (const entry of media) {
    try {
      await fsp.access(entry.source)
    } catch {
      throw new ProjectFileError(`Cannot save the project: media file is missing (${path.basename(entry.source)}).`)
    }
  }
}

/**
 * Decides where a save should go.
 *
 * - an existing destination wins (manual and auto saves alike);
 * - an auto-save with no destination falls back to the recovery copy;
 * - a manual save with no destination returns null, meaning "ask the user".
 */
export function resolveSaveDestination(options: {
  requestedPath?: string | null
  auto?: boolean
  recoveryPath: string
}): { path: string; recovery: boolean } | null {
  if (options.requestedPath) return { path: options.requestedPath, recovery: false }
  if (options.auto) return { path: options.recoveryPath, recovery: true }
  return null
}

// --- Path / entry safety -----------------------------------------------------

/** True for an archive-relative path with no traversal or absolute components. */
export function isSafeArchivePath(name: string): boolean {
  if (!name || name.includes('\\') || name.includes('\0')) return false
  if (name.startsWith('/')) return false
  if (/^[a-zA-Z]:/.test(name)) return false
  const parts = name.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return false
  return true
}

/** Only the known top-level files (and anything under media/) may appear. */
export function isAllowedArchiveEntry(name: string): boolean {
  if (!isSafeArchivePath(name)) return false
  if (name === MANIFEST_NAME || name === PROJECT_NAME || name === THUMBNAIL_NAME) return true
  return name.startsWith(`${MEDIA_DIR}/`) && name.length > MEDIA_DIR.length + 1
}

/** True for app assets that must stay relative (bundled wallpapers). */
export function isBuiltinAsset(value: string): boolean {
  return (
    !value.startsWith('blob:') &&
    !value.startsWith(`${MEDIA_DIR}/`) &&
    !path.isAbsolute(value) &&
    !/^[a-zA-Z]:/.test(value)
  )
}

// --- Validation --------------------------------------------------------------

export function validateManifest(value: unknown): ProjectManifest {
  if (!value || typeof value !== 'object') {
    throw new ProjectFileError('manifest.json is missing or malformed.')
  }
  const m = value as Partial<ProjectManifest>
  if (typeof m.format !== 'number' || !Number.isInteger(m.format) || m.format < 1) {
    throw new ProjectFileError('manifest.json has an invalid format version.')
  }
  if (m.format > CURRENT_PROJECT_FORMAT) {
    throw new ProjectFileError(
      `This project was created by a newer version of DemoThat (format ${m.format}). ` +
        `This build supports up to format ${CURRENT_PROJECT_FORMAT}.`,
    )
  }
  const source = (m.source ?? {}) as Partial<ProjectSourceInfo>
  return {
    format: m.format,
    appVersion: typeof m.appVersion === 'string' ? m.appVersion : 'unknown',
    createdAt: typeof m.createdAt === 'string' ? m.createdAt : new Date().toISOString(),
    platform: typeof m.platform === 'string' ? m.platform : 'unknown',
    source: {
      width: Number(source.width) || 0,
      height: Number(source.height) || 0,
      fps: Number(source.fps) || 0,
      durationSec: Number(source.durationSec) || 0,
    },
  }
}

export function validateProjectFile(value: unknown): ProjectFileState {
  if (!value || typeof value !== 'object') {
    throw new ProjectFileError('project.json is missing or malformed.')
  }
  const p = value as Partial<ProjectFileState>
  if (typeof p.videoPath !== 'string' || p.videoPath.length === 0) {
    throw new ProjectFileError('project.json does not reference a screen recording.')
  }
  if (typeof p.metadataPath !== 'string' || p.metadataPath.length === 0) {
    throw new ProjectFileError('project.json does not reference a metadata file.')
  }
  const required: Array<[string, unknown]> = [
    ['frameStyles', p.frameStyles],
    ['zoomRegions', p.zoomRegions],
    ['cutRegions', p.cutRegions],
    ['speedRegions', p.speedRegions],
    ['videoClips', p.videoClips],
    ['audioClips', p.audioClips],
    ['webcamPosition', p.webcamPosition],
    ['webcamStyles', p.webcamStyles],
  ]
  for (const [key, val] of required) {
    if (val === undefined || val === null) {
      throw new ProjectFileError(`project.json is missing the "${key}" field.`)
    }
  }
  if (!Array.isArray(p.videoClips) || !Array.isArray(p.audioClips)) {
    throw new ProjectFileError('project.json has malformed clip lists.')
  }
  if (typeof p.frameStyles !== 'object') {
    throw new ProjectFileError('project.json has malformed frame styles.')
  }
  return p as ProjectFileState
}

/** Gives future format changes somewhere to live. Format 1 is the identity. */
export function migrateProject(json: ProjectFileState, fromFormat: number): ProjectFileState {
  if (fromFormat === CURRENT_PROJECT_FORMAT) return json
  throw new ProjectFileError(`Cannot migrate a project from format ${fromFormat}.`)
}

// --- Path remapping ----------------------------------------------------------

/** Every media file the project references, as absolute source paths. */
export function collectMediaSources(project: ProjectFileState): string[] {
  const sources: string[] = []
  if (project.videoPath) sources.push(project.videoPath)
  if (project.metadataPath) sources.push(project.metadataPath)
  if (project.webcamVideoPath) sources.push(project.webcamVideoPath)
  if (project.mouseClickSoundPath) sources.push(project.mouseClickSoundPath)
  for (const clip of project.audioClips ?? []) {
    if (clip.filePath) sources.push(clip.filePath)
  }
  for (const clip of project.videoClips ?? []) {
    if (clip.filePath) sources.push(clip.filePath)
  }
  const image = project.frameStyles?.background?.imageUrl
  if (image && !isBuiltinAsset(image) && !image.startsWith('blob:')) sources.push(image)
  return sources
}

/** Assigns each unique source an archive name under media/, avoiding collisions. */
export function buildMediaEntries(sources: string[]): MediaEntry[] {
  const seen = new Set<string>()
  const usedNames = new Set<string>()
  const entries: MediaEntry[] = []
  for (const source of sources) {
    if (!source || seen.has(source)) continue
    seen.add(source)
    const base = path.basename(source)
    let name = base
    let counter = 1
    while (usedNames.has(name)) name = `${counter++}-${base}`
    usedNames.add(name)
    entries.push({ source, archivePath: `${MEDIA_DIR}/${name}` })
  }
  return entries
}

function mapProjectPaths(project: ProjectFileState, map: (value: string) => string): void {
  project.videoPath = map(project.videoPath)
  if (project.metadataPath) project.metadataPath = map(project.metadataPath)
  if (project.webcamVideoPath) project.webcamVideoPath = map(project.webcamVideoPath)
  if (project.mouseClickSoundPath) project.mouseClickSoundPath = map(project.mouseClickSoundPath)
  for (const clip of project.audioClips ?? []) {
    if (clip.filePath) clip.filePath = map(clip.filePath)
  }
  for (const clip of project.videoClips ?? []) {
    if (clip.filePath) clip.filePath = map(clip.filePath)
  }
  const image = project.frameStyles?.background?.imageUrl
  if (image && !isBuiltinAsset(image) && !image.startsWith('blob:')) {
    project.frameStyles!.background!.imageUrl = map(image)
  }
}

export interface PreparedProject {
  project: ProjectFileState
  media: MediaEntry[]
}

/**
 * Rewrites every media path to its archive-relative form and returns the files
 * that must be copied into the archive. Also folds an optional custom
 * background image (a blob URL held only in the renderer) into media/.
 */
export function prepareProjectForSave(
  project: ProjectFileState,
  options: { backgroundImage?: { ext: string } } = {},
): PreparedProject {
  const clone = structuredClone(project) as ProjectFileState
  const media = buildMediaEntries(collectMediaSources(clone))
  const toArchive = new Map(media.map((entry) => [entry.source, entry.archivePath]))
  mapProjectPaths(clone, (value) => toArchive.get(value) ?? value)

  const image = clone.frameStyles?.background?.imageUrl
  if (image?.startsWith('blob:')) {
    const ext = options.backgroundImage?.ext
    if (ext) {
      clone.frameStyles!.background!.imageUrl = `${MEDIA_DIR}/background${ext}`
    } else {
      // No bytes were supplied for the custom image: fall back to a solid
      // colour rather than storing a blob: URL that cannot survive a reload.
      clone.frameStyles!.background = { ...clone.frameStyles!.background, type: 'color', imageUrl: undefined }
    }
  }
  return { project: clone, media }
}

/** Resolves archive-relative media paths back to absolute paths on disk. */
export function restoreProjectPaths(project: ProjectFileState, extractDir: string): ProjectFileState {
  const clone = structuredClone(project) as ProjectFileState
  mapProjectPaths(clone, (value) =>
    value.startsWith(`${MEDIA_DIR}/`) ? path.join(extractDir, ...value.split('/')) : value,
  )
  return clone
}

// --- Archive IO --------------------------------------------------------------

export interface WriteArchiveOptions {
  destPath: string
  manifest: ProjectManifest
  project: ProjectFileState
  media: MediaEntry[]
  backgroundImage?: { data: Uint8Array; ext: string }
  thumbnailPath?: string
}

/** Writes the archive to a temp file, then renames it into place. */
export async function writeProjectArchive(options: WriteArchiveOptions): Promise<void> {
  const { destPath } = options
  await fsp.mkdir(path.dirname(destPath), { recursive: true })
  const tmpPath = `${destPath}.tmp-${process.pid}-${Date.now()}`

  try {
    await new Promise<void>((resolve, reject) => {
      const zip = new ZipFile()
      const out = fs.createWriteStream(tmpPath)
      const fail = (error: Error) => {
        out.destroy()
        reject(error)
      }
      zip.outputStream.on('error', fail)
      out.on('error', fail)
      out.on('close', resolve)
      zip.outputStream.pipe(out)

      zip.addBuffer(Buffer.from(JSON.stringify(options.manifest)), MANIFEST_NAME)
      zip.addBuffer(Buffer.from(JSON.stringify(options.project)), PROJECT_NAME)
      for (const entry of options.media) {
        // Media is already compressed; store it to keep saves fast.
        zip.addFile(entry.source, entry.archivePath, { compress: false })
      }
      if (options.backgroundImage) {
        zip.addBuffer(
          Buffer.from(options.backgroundImage.data),
          `${MEDIA_DIR}/background${options.backgroundImage.ext}`,
          { compress: false },
        )
      }
      if (options.thumbnailPath) zip.addFile(options.thumbnailPath, THUMBNAIL_NAME)
      zip.end()
    })
    await fsp.rename(tmpPath, destPath)
  } catch (error) {
    await fsp.unlink(tmpPath).catch(() => {})
    throw error
  }
}

export interface ExtractedProject {
  manifest: ProjectManifest
  project: ProjectFileState
  /** Archive entry names that were extracted. */
  entries: string[]
}

function openZip(zipPath: string): Promise<YauzlZipFile> {
  return new Promise((resolve, reject) => {
    openZipFile(zipPath, { lazyEntries: true, autoClose: true, validateEntrySizes: true }, (error, zipfile) => {
      if (error || !zipfile) {
        reject(new ProjectFileError(`Could not read the project archive: ${error?.message ?? 'unknown error'}`))
        return
      }
      resolve(zipfile)
    })
  })
}

function readEntryBuffer(zipfile: YauzlZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new ProjectFileError(`Could not read ${entry.fileName}.`))
        return
      }
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('error', reject)
      stream.on('end', () => resolve(Buffer.concat(chunks)))
    })
  })
}

async function pipeEntryToFile(zipfile: YauzlZipFile, entry: Entry, destPath: string): Promise<void> {
  await fsp.mkdir(path.dirname(destPath), { recursive: true })
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new ProjectFileError(`Could not read ${entry.fileName}.`))
        return
      }
      const out = fs.createWriteStream(destPath)
      stream.on('error', reject)
      out.on('error', reject)
      out.on('close', resolve)
      stream.pipe(out)
    })
  })
}

export interface ExtractLimits {
  maxEntries?: number
  maxUncompressedBytes?: number
}

/**
 * Validates and extracts an untrusted `.dthat` archive into destDir.
 * Rejects traversal entries, unknown top-level files, oversized archives and
 * unsupported formats with a clear ProjectFileError.
 */
export async function extractProjectArchive(
  zipPath: string,
  destDir: string,
  limits: ExtractLimits = {},
): Promise<ExtractedProject> {
  const maxEntries = limits.maxEntries ?? MAX_ENTRY_COUNT
  const maxBytes = limits.maxUncompressedBytes ?? MAX_UNCOMPRESSED_BYTES
  await fsp.mkdir(destDir, { recursive: true })
  const zipfile = await openZip(zipPath)

  const buffers = new Map<string, Buffer>()
  const entries: string[] = []
  let entryCount = 0
  let totalBytes = 0

  try {
    await new Promise<void>((resolve, reject) => {
      const fail = (error: unknown) =>
        reject(error instanceof ProjectFileError ? error : new ProjectFileError(String(error)))

      const handleEntry = async (entry: Entry) => {
        entryCount += 1
        if (entryCount > maxEntries) {
          throw new ProjectFileError(`The project archive has too many files (limit ${maxEntries}).`)
        }
        totalBytes += entry.uncompressedSize
        if (totalBytes > maxBytes) {
          throw new ProjectFileError('The project archive is too large to open.')
        }

        const name = entry.fileName
        if (!isAllowedArchiveEntry(name)) {
          throw new ProjectFileError(`The project archive contains an unexpected file: ${name}`)
        }

        entries.push(name)
        if (name === MANIFEST_NAME || name === PROJECT_NAME) {
          if (entry.uncompressedSize > MAX_JSON_BYTES) {
            throw new ProjectFileError(`${name} is unexpectedly large.`)
          }
          buffers.set(name, await readEntryBuffer(zipfile, entry))
          return
        }
        await pipeEntryToFile(zipfile, entry, path.join(destDir, ...name.split('/')))
      }

      zipfile.on('entry', (entry: Entry) => {
        handleEntry(entry).then(
          () => zipfile.readEntry(),
          (error) => fail(error),
        )
      })
      zipfile.on('error', fail)
      zipfile.on('end', () => resolve())
      zipfile.readEntry()
    })
  } catch (error) {
    await fsp.rm(destDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }

  const manifestBuffer = buffers.get(MANIFEST_NAME)
  const projectBuffer = buffers.get(PROJECT_NAME)
  if (!manifestBuffer) throw new ProjectFileError('The project archive is missing manifest.json.')
  if (!projectBuffer) throw new ProjectFileError('The project archive is missing project.json.')

  const manifest = validateManifest(JSON.parse(manifestBuffer.toString('utf-8')))
  const rawProject = validateProjectFile(JSON.parse(projectBuffer.toString('utf-8')))
  const project = migrateProject(rawProject, manifest.format)

  return { manifest, project, entries }
}

/** Reads just the manifest from an archive (cheap validation before extraction). */
export async function readProjectManifest(zipPath: string): Promise<ProjectManifest> {
  const zipfile = await openZip(zipPath)
  try {
    return await new Promise<ProjectManifest>((resolve, reject) => {
      zipfile.on('entry', (entry: Entry) => {
        if (entry.fileName !== MANIFEST_NAME) {
          zipfile.readEntry()
          return
        }
        readEntryBuffer(zipfile, entry)
          .then((buffer) => resolve(validateManifest(JSON.parse(buffer.toString('utf-8')))))
          .catch(reject)
      })
      zipfile.on('error', reject)
      zipfile.on('end', () => reject(new ProjectFileError('The project archive is missing manifest.json.')))
      zipfile.readEntry()
    })
  } finally {
    zipfile.close()
  }
}
