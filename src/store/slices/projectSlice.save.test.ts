// @vitest-environment jsdom
//
// Save-path tests for the project slice. These drive the real store with a
// stubbed preload, because the interesting behaviour (what happens to edits the
// user makes while a save is in flight) only exists across the async boundary.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '../editorStore'
import { captureProjectSignature, initialProjectState, markProjectClean } from './projectSlice'

type SaveResult = { canceled: boolean; path?: string; recovery?: boolean }

const saveRequests: Array<{ project: unknown; path?: string | null; auto?: boolean }> = []
let resolveSave: ((value: SaveResult) => void) | null = null
let rejectSave: Error | null = null

const electronAPI = {
  saveProject: vi.fn((request: { project: unknown; path?: string | null; auto?: boolean }) => {
    saveRequests.push(request)
    if (rejectSave) return Promise.reject(rejectSave)
    return new Promise<SaveResult>((resolve) => {
      resolveSave = resolve
    })
  }),
  saveProjectAs: vi.fn(() => {
    if (rejectSave) return Promise.reject(rejectSave)
    return new Promise<SaveResult>((resolve) => {
      resolveSave = resolve
    })
  }),
  saveProjectCopy: vi.fn((request: { project: unknown; suggestedName?: string }) => {
    copyRequests.push(request)
    return Promise.resolve({ canceled: false, path: '/tmp/recording copy.dthat' })
  }),
  renameProject: vi.fn((request: { currentPath: string; newName: string }) => {
    renameRequests.push(request)
    if (renameResult) return Promise.resolve(renameResult)
    return new Promise<{ ok: boolean; path?: string; error?: string }>((resolve) => {
      resolveRename = resolve
    })
  }),
  setProjectDirty: vi.fn(),
}

const copyRequests: Array<{ project: unknown; suggestedName?: string }> = []
const renameRequests: Array<{ currentPath: string; newName: string }> = []
let resolveRename: ((value: { ok: boolean; path?: string; error?: string }) => void) | null = null
let renameResult: { ok: boolean; path?: string; error?: string } | null = null

/** Collects the project state a save actually shipped, for assertions. */
function shippedPadding(index: number): number {
  const request = saveRequests[index]
  const state = (request.project as { projectState: { frameStyles: { padding: number } } }).projectState
  return state.frameStyles.padding
}

function resetStore(): void {
  saveRequests.length = 0
  copyRequests.length = 0
  renameRequests.length = 0
  resolveSave = null
  resolveRename = null
  renameResult = null
  rejectSave = null
  useEditorStore.setState({
    ...initialProjectState,
    videoPath: '/tmp/recording.mp4',
    metadataPath: '/tmp/recording.json',
    duration: 12,
    frameStyles: { padding: 5 } as never,
    zoomRegions: {},
    cutRegions: {},
    speedRegions: {},
    audioClips: [],
    saveStatus: 'untitled',
  })
  markProjectClean(useEditorStore.getState())
}

async function waitForSaveRequest(count: number): Promise<void> {
  for (let i = 0; i < 100 && saveRequests.length < count; i++) await Promise.resolve()
  expect(saveRequests.length).toBeGreaterThanOrEqual(count)
}

async function waitForRenameRequest(count: number): Promise<void> {
  for (let i = 0; i < 100 && renameRequests.length < count; i++) await Promise.resolve()
  expect(renameRequests.length).toBeGreaterThanOrEqual(count)
}

describe('saveProject', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { window: unknown }).window = { electronAPI }
    vi.clearAllMocks()
    resetStore()
  })

  it('writes the project, adopts the path and clears the dirty flag', async () => {
    useEditorStore.setState((state) => {
      state.frameStyles.padding = 9
    })
    expect(useEditorStore.getState().isDirty).toBe(true)
    // No path yet, so "Not saved yet" — not "Unsaved changes".
    expect(useEditorStore.getState().saveStatus).toBe('untitled')

    const saving = useEditorStore.getState().saveProject()
    await waitForSaveRequest(1)
    expect(useEditorStore.getState().saveStatus).toBe('saving')

    resolveSave!({ canceled: false, path: '/tmp/recording.dthat' })
    await saving

    const state = useEditorStore.getState()
    expect(state.currentProjectPath).toBe('/tmp/recording.dthat')
    expect(state.isDirty).toBe(false)
    expect(state.saveStatus).toBe('saved')
    expect(state.lastSavedAt).not.toBeNull()
  })

  it('keeps edits made while a save is in flight dirty, and writes them next time', async () => {
    const saving = useEditorStore.getState().saveProject()
    await waitForSaveRequest(1)

    // The user edits during the write.
    useEditorStore.setState((state) => {
      state.frameStyles.padding = 12
    })

    resolveSave!({ canceled: false, path: '/tmp/recording.dthat' })
    await saving

    // The completed write carried the older state...
    expect(shippedPadding(0)).toBe(5)
    // ...so the project must not have been marked clean.
    expect(useEditorStore.getState().isDirty).toBe(true)
    expect(useEditorStore.getState().saveStatus).toBe('unsaved')

    // The next save picks the edit up and only then clears the flag.
    const secondSave = useEditorStore.getState().saveProject()
    await waitForSaveRequest(2)
    resolveSave!({ canceled: false, path: '/tmp/recording.dthat' })
    await secondSave

    expect(shippedPadding(1)).toBe(12)
    expect(useEditorStore.getState().isDirty).toBe(false)
  })

  it('clears the dirty flag when nothing changed during the save', async () => {
    const signatureBefore = captureProjectSignature(useEditorStore.getState())
    const saving = useEditorStore.getState().saveProject()
    await waitForSaveRequest(1)
    resolveSave!({ canceled: false, path: '/tmp/recording.dthat' })
    await saving

    expect(captureProjectSignature(useEditorStore.getState())).toBe(signatureBefore)
    expect(useEditorStore.getState().isDirty).toBe(false)
  })

  it('records a recovery copy without adopting it as the project path', async () => {
    const saving = useEditorStore.getState().saveProject({ auto: true })
    await waitForSaveRequest(1)
    resolveSave!({ canceled: false, path: '/tmp/userData/autosave/recovery.dthat', recovery: true })
    await saving

    const state = useEditorStore.getState()
    expect(state.currentProjectPath).toBeNull()
    expect(state.saveStatus).toBe('untitled')
    expect(state.lastRecoveryAt).not.toBeNull()
  })

  it('leaves the project untouched when the save dialog is dismissed', async () => {
    useEditorStore.setState((state) => {
      state.frameStyles.padding = 20
    })
    const saving = useEditorStore.getState().saveProject()
    await waitForSaveRequest(1)
    resolveSave!({ canceled: true })
    await saving

    const state = useEditorStore.getState()
    expect(state.currentProjectPath).toBeNull()
    // Nothing was written, so the status returns to what it was: untitled.
    expect(state.saveStatus).toBe('untitled')
    expect(state.isDirty).toBe(true)
  })

  it('reports a failed save, keeps the work dirty and stays retryable', async () => {
    useEditorStore.setState((state) => {
      state.frameStyles.padding = 20
    })

    rejectSave = new Error('Disk is full')
    await expect(useEditorStore.getState().saveProject()).rejects.toThrow('Disk is full')

    const failed = useEditorStore.getState()
    expect(failed.saveStatus).toBe('error')
    expect(failed.saveError).toBe('Disk is full')
    expect(failed.isDirty).toBe(true)

    // The next attempt (a tick, or the Retry link) recovers.
    rejectSave = null
    const retry = useEditorStore.getState().saveProject()
    await waitForSaveRequest(1)
    expect(useEditorStore.getState().saveStatus).toBe('saving')
    resolveSave!({ canceled: false, path: '/tmp/recording.dthat' })
    await retry

    const recovered = useEditorStore.getState()
    expect(recovered.saveStatus).toBe('saved')
    expect(recovered.saveError).toBeNull()
    expect(recovered.isDirty).toBe(false)
  })
})

describe('saveProjectCopy', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { window: unknown }).window = { electronAPI }
    vi.clearAllMocks()
    resetStore()
  })

  it('writes a snapshot without changing the edited project', async () => {
    // A titled, edited project: the copy must leave all of this alone.
    useEditorStore.setState({
      currentProjectPath: '/tmp/recording.dthat',
      saveStatus: 'unsaved',
      isDirty: true,
    } as never)
    useEditorStore.setState((state) => {
      state.frameStyles.padding = 9
    })

    const before = useEditorStore.getState()
    const result = await useEditorStore.getState().saveProjectCopy()
    const after = useEditorStore.getState()

    expect(result.path).toBe('/tmp/recording copy.dthat')
    expect(copyRequests).toHaveLength(1)
    // Still editing the original file, still dirty, save state untouched.
    expect(after.currentProjectPath).toBe(before.currentProjectPath)
    expect(after.isDirty).toBe(true)
    expect(after.saveStatus).toBe('unsaved')
  })

  it('names the copy after the project it came from', async () => {
    useEditorStore.setState({ currentProjectPath: '/home/me/My Demo.dthat' } as never)
    await useEditorStore.getState().saveProjectCopy()
    expect(copyRequests[0].suggestedName).toBe('My Demo')
  })

  it('does nothing without a recording', async () => {
    useEditorStore.setState({ videoPath: null } as never)
    const result = await useEditorStore.getState().saveProjectCopy()
    expect(result.canceled).toBe(true)
    expect(copyRequests).toHaveLength(0)
  })
})

describe('renameCurrentProject', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { window: unknown }).window = { electronAPI }
    vi.clearAllMocks()
    resetStore()
  })

  it('marks the session as renaming, then repoints it at the new path', async () => {
    useEditorStore.setState({ currentProjectPath: '/tmp/recording.dthat' } as never)

    const renaming = useEditorStore.getState().renameCurrentProject('New Name')
    await waitForRenameRequest(1)
    // Autosave stands still while the file is moving.
    expect(useEditorStore.getState().isRenaming).toBe(true)
    expect(renameRequests[0]).toEqual({ currentPath: '/tmp/recording.dthat', newName: 'New Name' })

    resolveRename!({ ok: true, path: '/tmp/New Name.dthat' })
    const result = await renaming

    expect(result.ok).toBe(true)
    expect(useEditorStore.getState().currentProjectPath).toBe('/tmp/New Name.dthat')
    expect(useEditorStore.getState().isRenaming).toBe(false)
  })

  it('leaves the path alone when the main process refuses', async () => {
    useEditorStore.setState({ currentProjectPath: '/tmp/recording.dthat' } as never)
    renameResult = { ok: false, error: 'A project with that name already exists here' }

    const result = await useEditorStore.getState().renameCurrentProject('Taken')

    expect(result.ok).toBe(false)
    expect(result.error).toBe('A project with that name already exists here')
    expect(useEditorStore.getState().currentProjectPath).toBe('/tmp/recording.dthat')
    expect(useEditorStore.getState().isRenaming).toBe(false)
  })

  it('refuses to rename a project that has never been saved', async () => {
    useEditorStore.setState({ currentProjectPath: null } as never)
    const result = await useEditorStore.getState().renameCurrentProject('Whatever')
    expect(result.ok).toBe(false)
    expect(renameRequests).toHaveLength(0)
  })
})
