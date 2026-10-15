// @vitest-environment jsdom
//
// The renderer half of the session guard: what it reports to the main process
// when asked whether the current project may be replaced.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useSessionGuard } from './useSessionGuard'
import { useEditorStore } from '../store/editorStore'
import { initialProjectState, markProjectClean } from '../store/slices/projectSlice'

type Reason = 'open' | 'close' | 'quit'
type BeforeReplace = (payload: { requestId: string; reason: Reason }) => void | Promise<void>

let beforeReplace: BeforeReplace | null = null
let performSave: ((payload: { requestId: string }) => void | Promise<void>) | null = null
const verdicts: Array<{ requestId: string; verdict: unknown }> = []
const saveAnswers: Array<{ requestId: string; ok: boolean }> = []

const saveProject = vi.fn(async (options?: { auto?: boolean }) => {
  if (failure) throw new Error('Disk is full')
  if (cancelled) return { canceled: true }
  if (options?.auto) return { canceled: false, path: '/tmp/userData/autosave/recovery.dthat', recovery: true }
  return { canceled: false, path: '/tmp/recording.dthat' }
})

let failure = false
let cancelled = false

const electronAPI = {
  onBeforeReplace: (callback: BeforeReplace) => {
    beforeReplace = callback
    return () => {
      beforeReplace = null
    }
  },
  settleBeforeReplace: (payload: { requestId: string; verdict: unknown }) => {
    verdicts.push(payload)
  },
  onPerformSave: (callback: (payload: { requestId: string }) => void | Promise<void>) => {
    performSave = callback
    return () => {
      performSave = null
    }
  },
  settlePerformSave: (payload: { requestId: string; ok: boolean }) => {
    saveAnswers.push(payload)
  },
  saveProject,
  setProjectDirty: vi.fn(),
}

const Harness = () => {
  useSessionGuard()
  return null
}

let container: HTMLDivElement
let root: Root

/** Loads a titled or untitled project and leaves it dirty (a real tracked edit). */
function loadProject(path: string | null, dirty: boolean): void {
  useEditorStore.setState({
    ...initialProjectState,
    videoPath: '/tmp/recording.mp4',
    metadataPath: '/tmp/recording.json',
    frameStyles: { padding: 5 } as never,
    zoomRegions: {},
  } as never)
  markProjectClean(useEditorStore.getState())
  useEditorStore.setState((state) => {
    state.currentProjectPath = path
  })
  if (dirty) {
    useEditorStore.setState((state) => {
      state.frameStyles.padding = 9
    })
  }
  useEditorStore.setState({} as never)
}

async function ask(reason: Reason): Promise<void> {
  await act(async () => {
    await beforeReplace?.({ requestId: 'req-1', reason })
  })
}

describe('useSessionGuard', () => {
  beforeEach(() => {
    ;(window as unknown as { electronAPI: unknown }).electronAPI = electronAPI
    verdicts.length = 0
    saveAnswers.length = 0
    beforeReplace = null
    performSave = null
    failure = false
    cancelled = false
    vi.clearAllMocks()

    container = document.createElement('div')
    document.body.appendChild(container)
    act(() => {
      root = createRoot(container)
      root.render(<Harness />)
    })
  })

  it('reports a clean titled session as saved', async () => {
    loadProject('/tmp/recording.dthat', false)
    await ask('close')
    expect(verdicts).toEqual([{ requestId: 'req-1', verdict: { state: 'saved' } }])
    expect(saveProject).not.toHaveBeenCalled()
  })

  it('reports a clean untitled session as clean', async () => {
    loadProject(null, false)
    await ask('open')
    expect(verdicts[0].verdict).toEqual({ state: 'clean' })
  })

  it('saves a dirty titled project and reports it saved', async () => {
    loadProject('/tmp/recording.dthat', true)
    await ask('quit')
    expect(saveProject).toHaveBeenCalledTimes(1)
    expect(verdicts[0].verdict).toEqual({ state: 'saved' })
  })

  it('reports a failed save, with the message', async () => {
    loadProject('/tmp/recording.dthat', true)
    failure = true
    await ask('close')
    expect(verdicts[0].verdict).toEqual({ state: 'save-failed', error: 'Disk is full' })
  })

  it('reports a dismissed save dialog as a failure rather than a save', async () => {
    loadProject('/tmp/recording.dthat', true)
    cancelled = true
    await ask('close')
    expect(verdicts[0].verdict).toEqual({ state: 'save-failed' })
  })

  it('asks before discarding a dirty untitled project when opening', async () => {
    loadProject(null, true)
    await ask('open')
    // Nothing is written for an open: main shows "Open Without Saving".
    expect(saveProject).not.toHaveBeenCalled()
    expect(verdicts[0].verdict).toEqual({ state: 'untitled-dirty', recoveryWritten: false })
  })

  it('writes the recovery copy before asking to leave a dirty untitled project', async () => {
    loadProject(null, true)
    await ask('close')
    // The slice passes the whole IPC request; the recovery write is the auto one.
    expect(saveProject.mock.calls[0][0]).toMatchObject({ auto: true })
    expect(verdicts[0].verdict).toEqual({ state: 'untitled-dirty', recoveryWritten: true })
  })

  it('does not claim a recovery copy when the write failed', async () => {
    loadProject(null, true)
    failure = true
    await ask('quit')
    expect(verdicts[0].verdict).toEqual({ state: 'untitled-dirty', recoveryWritten: false })
  })

  it('runs a save on demand for main and answers with the outcome', async () => {
    loadProject('/tmp/recording.dthat', true)
    await act(async () => {
      await performSave?.({ requestId: 'req-2' })
    })
    expect(saveProject).toHaveBeenCalledTimes(1)
    expect(saveAnswers).toEqual([{ requestId: 'req-2', ok: true }])
  })

  it('answers ok:false when the on-demand save fails', async () => {
    loadProject('/tmp/recording.dthat', true)
    failure = true
    await act(async () => {
      await performSave?.({ requestId: 'req-3' })
    })
    expect(saveAnswers).toEqual([{ requestId: 'req-3', ok: false }])
  })
})
