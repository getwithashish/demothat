import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ZipFile } from 'yazl'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CURRENT_PROJECT_FORMAT,
  MANIFEST_NAME,
  MEDIA_DIR,
  PROJECT_NAME,
  ProjectFileError,
  assertMediaFilesExist,
  buildMediaEntries,
  extractProjectArchive,
  isAllowedArchiveEntry,
  isSafeArchivePath,
  migrateProject,
  prepareProjectForSave,
  restoreProjectPaths,
  validateManifest,
  validateProjectFile,
  writeProjectArchive,
  type ProjectFileState,
  type ProjectManifest,
} from './project-file-core'

let root: string
let sourceDir: string

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dthat-test-'))
  sourceDir = path.join(root, 'source')
  await fsp.mkdir(sourceDir, { recursive: true })
})

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true })
})

async function writeFile(name: string, contents: string): Promise<string> {
  const filePath = path.join(sourceDir, name)
  await fsp.writeFile(filePath, contents)
  return filePath
}

/** A minimal project state that passes validateProjectFile. */
async function makeProjectState(): Promise<ProjectFileState> {
  const videoPath = await writeFile('screen.mp4', 'SCREEN-VIDEO-BYTES')
  const metadataPath = await writeFile('meta.json', '{"events":[]}')
  const audioPath = await writeFile('music.mp3', 'AUDIO-BYTES')
  return {
    videoPath,
    metadataPath,
    webcamVideoPath: null,
    frameStyles: { padding: 5, background: { type: 'color', color: '#000' } },
    aspectRatio: '16:9',
    cameraMotions: [],
    visualEffects: [],
    compositionLayouts: [],
    audioClips: [{ id: 'a', filePath: audioPath, volume: 1 }],
    zoomRegions: { z1: { id: 'z1', zoomLevel: 1.5 } },
    cutRegions: {},
    speedRegions: {},
    videoClips: [{ id: 'v', filePath: await writeFile('clip.mp4', 'CLIP-BYTES') }],
    webcamPosition: { pos: 'top-right' },
    webcamStyles: { size: 20 },
    isWebcamVisible: false,
    cursorStyles: {},
    activePresetId: 'default',
  }
}

function manifestFor(format = CURRENT_PROJECT_FORMAT): ProjectManifest {
  return {
    format,
    appVersion: 'test',
    createdAt: new Date().toISOString(),
    platform: 'linux',
    source: { width: 1920, height: 1080, fps: 30, durationSec: 12 },
  }
}

/** Builds a zip from arbitrary entries (used to forge malicious archives). */
function makeZip(zipPath: string, entries: Array<{ name: string; data: Buffer | string }>): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile()
    const out = fs.createWriteStream(zipPath)
    out.on('error', reject)
    out.on('close', resolve)
    zip.outputStream.on('error', reject)
    zip.outputStream.pipe(out)
    for (const entry of entries) {
      zip.addBuffer(Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data), entry.name, { compress: false })
    }
    zip.end()
  })
}

describe('archive entry safety', () => {
  it('rejects traversal, absolute and windows-style paths', () => {
    expect(isSafeArchivePath('media/screen.mp4')).toBe(true)
    expect(isSafeArchivePath('manifest.json')).toBe(true)

    expect(isSafeArchivePath('../evil.sh')).toBe(false)
    expect(isSafeArchivePath('media/../../evil.sh')).toBe(false)
    expect(isSafeArchivePath('/etc/passwd')).toBe(false)
    expect(isSafeArchivePath('C:/Windows/system32')).toBe(false)
    expect(isSafeArchivePath('media\\screen.mp4')).toBe(false)
    expect(isSafeArchivePath('')).toBe(false)
  })

  it('allows only the known top-level entries', () => {
    expect(isAllowedArchiveEntry(MANIFEST_NAME)).toBe(true)
    expect(isAllowedArchiveEntry(PROJECT_NAME)).toBe(true)
    expect(isAllowedArchiveEntry('thumbnail.jpg')).toBe(true)
    expect(isAllowedArchiveEntry(`${MEDIA_DIR}/screen.mp4`)).toBe(true)
    expect(isAllowedArchiveEntry('evil.txt')).toBe(false)
    expect(isAllowedArchiveEntry(`${MEDIA_DIR}/../evil.txt`)).toBe(false)
  })
})

describe('manifest and project validation', () => {
  it('accepts the current format and rejects a newer one with a clear message', () => {
    expect(validateManifest(manifestFor()).format).toBe(CURRENT_PROJECT_FORMAT)
    expect(() => validateManifest(manifestFor(CURRENT_PROJECT_FORMAT + 1))).toThrow(/newer version/i)
  })

  it('rejects a project without media paths', () => {
    expect(() => validateProjectFile({})).toThrow(ProjectFileError)
    expect(() => validateProjectFile({ videoPath: 'x' })).toThrow(/metadata/i)
  })

  it('migrateProject is the identity for the current format', () => {
    const state = {
      videoPath: 'a',
      metadataPath: 'b',
      frameStyles: {},
      zoomRegions: {},
      cutRegions: {},
      speedRegions: {},
      videoClips: [],
      audioClips: [],
      webcamPosition: {},
      webcamStyles: {},
    }
    expect(migrateProject(state, CURRENT_PROJECT_FORMAT)).toBe(state)
    expect(() => migrateProject(state, 99)).toThrow(ProjectFileError)
  })
})

describe('path remapping', () => {
  it('assigns unique archive names under media/', () => {
    const entries = buildMediaEntries(['/a/same.mp4', '/b/same.mp4', '/a/same.mp4'])
    expect(entries).toHaveLength(2)
    expect(entries[0].archivePath).toBe('media/same.mp4')
    expect(entries[1].archivePath).toBe('media/1-same.mp4')
  })

  it('rewrites absolute paths for save and restores them on open', async () => {
    const state = await makeProjectState()
    const prepared = prepareProjectForSave(state)

    expect(prepared.project.videoPath).toBe('media/screen.mp4')
    expect(prepared.project.metadataPath).toBe('media/meta.json')
    expect((prepared.project.audioClips as Array<{ filePath: string }>)[0].filePath).toBe('media/music.mp3')

    const restored = restoreProjectPaths(prepared.project, path.join(root, 'extracted'))
    expect(restored.videoPath).toBe(path.join(root, 'extracted', 'media', 'screen.mp4'))
    expect(restored.metadataPath).toBe(path.join(root, 'extracted', 'media', 'meta.json'))
  })
})

describe('round-trip', () => {
  it('save then open equals the original state after path remapping', async () => {
    const state = await makeProjectState()
    const zipPath = path.join(root, 'project.dthat')

    const prepared = prepareProjectForSave(state)
    await writeProjectArchive({
      destPath: zipPath,
      manifest: manifestFor(),
      project: prepared.project,
      media: prepared.media,
    })

    const extractDir = path.join(root, 'extracted')
    const { manifest, project, entries } = await extractProjectArchive(zipPath, extractDir)

    expect(manifest.format).toBe(CURRENT_PROJECT_FORMAT)
    expect(entries).toContain('media/screen.mp4')
    expect(entries).toContain(PROJECT_NAME)

    const restored = restoreProjectPaths(project, extractDir)
    expect(restored.videoPath).toBe(path.join(extractDir, 'media', 'screen.mp4'))
    expect(await fsp.readFile(restored.videoPath, 'utf-8')).toBe('SCREEN-VIDEO-BYTES')
    expect(await fsp.readFile(restored.metadataPath as string, 'utf-8')).toBe('{"events":[]}')

    // Edit fields survive the round-trip unchanged.
    expect(restored.zoomRegions).toEqual(state.zoomRegions)
    expect(restored.frameStyles).toEqual(state.frameStyles)
    expect(restored.activePresetId).toBe('default')
  })

  it('stores a custom background image and rewrites its URL', async () => {
    const state = await makeProjectState()
    state.frameStyles = { background: { type: 'image', imageUrl: 'blob:http://localhost/abc' } }
    const zipPath = path.join(root, 'bg.dthat')
    const backgroundImage = { data: new Uint8Array([1, 2, 3, 4]), ext: '.png' }

    const prepared = prepareProjectForSave(state, { backgroundImage })
    expect(prepared.project.frameStyles?.background?.imageUrl).toBe('media/background.png')

    await writeProjectArchive({
      destPath: zipPath,
      manifest: manifestFor(),
      project: prepared.project,
      media: prepared.media,
      backgroundImage,
    })
    const { entries } = await extractProjectArchive(zipPath, path.join(root, 'bg-extracted'))
    expect(entries).toContain('media/background.png')
  })
})

describe('untrusted input', () => {
  it('rejects an archive with a zip-slip entry', async () => {
    const zipPath = path.join(root, 'slip.dthat')
    // yazl refuses to write traversal names, so forge one by swapping a benign
    // entry name of identical length after the archive is written.
    await makeZip(zipPath, [
      { name: MANIFEST_NAME, data: JSON.stringify(manifestFor()) },
      { name: PROJECT_NAME, data: JSON.stringify(await makeProjectState()) },
      { name: 'media/evil', data: 'rm -rf /' },
    ])
    const raw = await fsp.readFile(zipPath)
    const patched = Buffer.from(raw.toString('latin1').split('media/evil').join('../evil.sh'), 'latin1')
    await fsp.writeFile(zipPath, patched)

    await expect(extractProjectArchive(zipPath, path.join(root, 'slip-out'))).rejects.toThrow(ProjectFileError)
  })

  it('rejects an unexpected top-level file', async () => {
    const zipPath = path.join(root, 'unknown.dthat')
    await makeZip(zipPath, [
      { name: MANIFEST_NAME, data: JSON.stringify(manifestFor()) },
      { name: PROJECT_NAME, data: JSON.stringify(await makeProjectState()) },
      { name: 'notes.txt', data: 'hello' },
    ])
    await expect(extractProjectArchive(zipPath, path.join(root, 'unknown-out'))).rejects.toThrow(/unexpected file/i)
  })

  it('rejects a too-new format', async () => {
    const zipPath = path.join(root, 'newer.dthat')
    await makeZip(zipPath, [
      { name: MANIFEST_NAME, data: JSON.stringify(manifestFor(CURRENT_PROJECT_FORMAT + 1)) },
      { name: PROJECT_NAME, data: JSON.stringify(await makeProjectState()) },
    ])
    await expect(extractProjectArchive(zipPath, path.join(root, 'newer-out'))).rejects.toThrow(/newer version/i)
  })

  it('caps the entry count', async () => {
    const state = await makeProjectState()
    const zipPath = path.join(root, 'many.dthat')
    const prepared = prepareProjectForSave(state)
    await writeProjectArchive({
      destPath: zipPath,
      manifest: manifestFor(),
      project: prepared.project,
      media: prepared.media,
    })

    await expect(extractProjectArchive(zipPath, path.join(root, 'many-out'), { maxEntries: 1 })).rejects.toThrow(
      /too many files/i,
    )
  })

  it('caps the total uncompressed size', async () => {
    const state = await makeProjectState()
    const zipPath = path.join(root, 'big.dthat')
    const prepared = prepareProjectForSave(state)
    await writeProjectArchive({
      destPath: zipPath,
      manifest: manifestFor(),
      project: prepared.project,
      media: prepared.media,
    })

    await expect(
      extractProjectArchive(zipPath, path.join(root, 'big-out'), { maxUncompressedBytes: 4 }),
    ).rejects.toThrow(/too large/i)
  })

  it('reports a missing media file clearly on save', async () => {
    const state = await makeProjectState()
    state.videoPath = path.join(sourceDir, 'gone.mp4')
    const prepared = prepareProjectForSave(state)
    await expect(assertMediaFilesExist(prepared.media)).rejects.toThrow(/media file is missing/i)
  })
})
