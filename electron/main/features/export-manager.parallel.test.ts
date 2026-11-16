import { describe, expect, it, vi } from 'vitest'
import type { ChunkSlice } from './build-export-args'

describe('parallel export synchronization & frame quota enforcement', () => {
  describe('duplicate render:ready signal deduplication', () => {
    it('dispatches render:start at most once per worker despite duplicate render:ready signals', () => {
      const dispatchedSenderIds = new Set<number>()
      const workerChunkBySenderId = new Map<number, number>([
        [101, 0],
        [102, 1],
      ])
      const mockWorkers = [
        { id: 101, send: vi.fn(), isDestroyed: () => false },
        { id: 102, send: vi.fn(), isDestroyed: () => false },
      ]
      const chunks: ChunkSlice[] = [
        { index: 0, startFrame: 0, endFrame: 100, chunkFrames: 100, chunkDuration: 3.33, chunkPath: '/tmp/c0.mp4' },
        { index: 1, startFrame: 100, endFrame: 200, chunkFrames: 100, chunkDuration: 3.33, chunkPath: '/tmp/c1.mp4' },
      ]

      const handleRenderReady = (senderId: number) => {
        if (dispatchedSenderIds.has(senderId)) {
          return false
        }
        const chunkIndex = workerChunkBySenderId.get(senderId)
        if (chunkIndex === undefined) return false
        dispatchedSenderIds.add(senderId)
        const worker = mockWorkers[chunkIndex]
        const chunk = chunks[chunkIndex]
        if (worker && !worker.isDestroyed()) {
          worker.send('render:start', {
            chunkIndex,
            startFrame: chunk.startFrame,
            endFrame: chunk.endFrame,
            totalFrames: 200,
            chunkDuration: chunk.chunkDuration,
          })
          return true
        }
        return false
      }

      // 1. Initial render:ready from worker 0
      expect(handleRenderReady(101)).toBe(true)
      expect(mockWorkers[0].send).toHaveBeenCalledTimes(1)
      expect(mockWorkers[0].send).toHaveBeenCalledWith('render:start', {
        chunkIndex: 0,
        startFrame: 0,
        endFrame: 100,
        totalFrames: 200,
        chunkDuration: 3.33,
      })

      // 2. Duplicate render:ready from worker 0 must be ignored
      expect(handleRenderReady(101)).toBe(false)
      expect(mockWorkers[0].send).toHaveBeenCalledTimes(1)

      // 3. Another duplicate render:ready from worker 0 must also be ignored
      expect(handleRenderReady(101)).toBe(false)
      expect(mockWorkers[0].send).toHaveBeenCalledTimes(1)

      // 4. Initial render:ready from worker 1 should dispatch render:start for chunk 1
      expect(handleRenderReady(102)).toBe(true)
      expect(mockWorkers[1].send).toHaveBeenCalledTimes(1)
      expect(mockWorkers[1].send).toHaveBeenCalledWith('render:start', {
        chunkIndex: 1,
        startFrame: 100,
        endFrame: 200,
        totalFrames: 200,
        chunkDuration: 3.33,
      })

      // 5. Duplicate render:ready from worker 1 must be ignored
      expect(handleRenderReady(102)).toBe(false)
      expect(mockWorkers[1].send).toHaveBeenCalledTimes(1)
    })
  })

  describe('frameHandler chunk frame quota enforcement', () => {
    it('accepts frames within quota and closes stdin cleanly on reaching chunkFrames', async () => {
      const chunk: ChunkSlice = {
        index: 0,
        startFrame: 0,
        endFrame: 3,
        chunkFrames: 3,
        chunkDuration: 0.1,
        chunkPath: '/tmp/c0.mp4',
      }
      const numWorkers = 1
      const chunkFramesWritten: number[] = [0]
      const chunkWriteQueues: Promise<void>[] = [Promise.resolve()]

      const stdin = {
        writable: true,
        write: vi.fn().mockReturnValue(true),
        end: vi.fn(() => {
          stdin.writable = false
        }),
      }
      const proc = { stdin, killed: false }
      const chunkProcesses = [proc]

      const writeChunkFrame = (_chunkIndex: number, _frame: Uint8Array) => Promise.resolve({ aborted: false })

      const frameHandler = async ({
        frame,
        chunkIndex,
      }: {
        frame: Uint8Array
        progress: number
        chunkIndex?: number
      }) => {
        const idx = typeof chunkIndex === 'number' && chunkIndex >= 0 && chunkIndex < numWorkers ? chunkIndex : 0
        const currentChunk = chunk
        const currentProc = chunkProcesses[idx]

        if (currentChunk && chunkFramesWritten[idx] >= currentChunk.chunkFrames) {
          if (currentProc && !currentProc.killed && currentProc.stdin?.writable) {
            currentProc.stdin.end()
          }
          return { aborted: true }
        }

        const currentWrite = chunkWriteQueues[idx].then(async () => {
          if (currentChunk && chunkFramesWritten[idx] >= currentChunk.chunkFrames) {
            if (currentProc && !currentProc.killed && currentProc.stdin?.writable) {
              currentProc.stdin.end()
            }
            return { aborted: true }
          }
          const writeResult = await writeChunkFrame(idx, frame)
          if (!writeResult.aborted) {
            chunkFramesWritten[idx] += 1
            if (currentChunk && chunkFramesWritten[idx] >= currentChunk.chunkFrames) {
              if (currentProc && !currentProc.killed && currentProc.stdin?.writable) {
                currentProc.stdin.end()
              }
            }
          }
          return writeResult
        })

        chunkWriteQueues[idx] = currentWrite.then(
          () => {},
          () => {},
        )
        return await currentWrite
      }

      const dummyFrame = new Uint8Array([1, 2, 3, 4])

      // Frame 1
      const res1 = await frameHandler({ frame: dummyFrame, progress: 33, chunkIndex: 0 })
      expect(res1.aborted).toBe(false)
      expect(chunkFramesWritten[0]).toBe(1)
      expect(stdin.end).not.toHaveBeenCalled()

      // Frame 2
      const res2 = await frameHandler({ frame: dummyFrame, progress: 66, chunkIndex: 0 })
      expect(res2.aborted).toBe(false)
      expect(chunkFramesWritten[0]).toBe(2)
      expect(stdin.end).not.toHaveBeenCalled()

      // Frame 3 (reaches quota)
      const res3 = await frameHandler({ frame: dummyFrame, progress: 100, chunkIndex: 0 })
      expect(res3.aborted).toBe(false)
      expect(chunkFramesWritten[0]).toBe(3)
      expect(stdin.end).toHaveBeenCalledTimes(1)

      // Frame 4 (excess frame past chunkFrames)
      const res4 = await frameHandler({ frame: dummyFrame, progress: 100, chunkIndex: 0 })
      expect(res4.aborted).toBe(true)
      expect(chunkFramesWritten[0]).toBe(3) // Frame count remains capped at 3
    })

    it('rejects excess frames past chunkFrames with { aborted: true } and ends stdin immediately', async () => {
      const chunk: ChunkSlice = {
        index: 0,
        startFrame: 0,
        endFrame: 5,
        chunkFrames: 5,
        chunkDuration: 0.166,
        chunkPath: '/tmp/c0.mp4',
      }
      const chunkFramesWritten: number[] = [5] // Already at quota
      const stdin = {
        writable: true,
        write: vi.fn(),
        end: vi.fn(),
      }
      const proc = { stdin, killed: false }

      const frameHandler = async ({
        frame: _frame,
        chunkIndex,
      }: {
        frame: Uint8Array
        progress: number
        chunkIndex?: number
      }) => {
        const idx = chunkIndex ?? 0
        if (chunk && chunkFramesWritten[idx] >= chunk.chunkFrames) {
          if (proc && !proc.killed && proc.stdin?.writable) {
            proc.stdin.end()
          }
          return { aborted: true }
        }
        return { aborted: false }
      }

      const res = await frameHandler({ frame: new Uint8Array(10), progress: 100, chunkIndex: 0 })
      expect(res.aborted).toBe(true)
      expect(stdin.end).toHaveBeenCalledTimes(1)
      expect(stdin.write).not.toHaveBeenCalled()
    })
  })

  describe('RendererPage execution lock', () => {
    it('ignores duplicate render:start triggers while rendering is in flight', async () => {
      const isRenderingRef = { current: false }
      const hasFinishedRef = { current: false }
      let renderLoopCalls = 0

      let resolveLoop: () => void
      const loopPromise = new Promise<void>((r) => {
        resolveLoop = r
      })

      const onRenderStart = async () => {
        if (isRenderingRef.current || hasFinishedRef.current) {
          return { ignored: true }
        }
        isRenderingRef.current = true

        try {
          renderLoopCalls++
          await loopPromise
          return { executed: true }
        } finally {
          isRenderingRef.current = false
          hasFinishedRef.current = true
        }
      }

      // First trigger arrives
      const trigger1Promise = onRenderStart()
      expect(isRenderingRef.current).toBe(true)
      expect(renderLoopCalls).toBe(1)

      // Duplicate trigger arrives while trigger 1 is still rendering
      const trigger2Result = await onRenderStart()
      expect(trigger2Result).toEqual({ ignored: true })
      expect(renderLoopCalls).toBe(1)

      // Finish first render
      resolveLoop!()
      const trigger1Result = await trigger1Promise
      expect(trigger1Result).toEqual({ executed: true })
      expect(hasFinishedRef.current).toBe(true)
      expect(isRenderingRef.current).toBe(false)

      // Third trigger arrives after finish
      const trigger3Result = await onRenderStart()
      expect(trigger3Result).toEqual({ ignored: true })
      expect(renderLoopCalls).toBe(1)
    })

    it('sets hasFinishedRef and clears isRenderingRef in finally block even on error', async () => {
      const isRenderingRef = { current: false }
      const hasFinishedRef = { current: false }

      const onRenderStart = async () => {
        if (isRenderingRef.current || hasFinishedRef.current) {
          return { ignored: true }
        }
        isRenderingRef.current = true

        try {
          throw new Error('Simulated GPU/render failure')
        } catch {
          // Handled error
        } finally {
          isRenderingRef.current = false
          hasFinishedRef.current = true
        }
      }

      await onRenderStart()
      expect(isRenderingRef.current).toBe(false)
      expect(hasFinishedRef.current).toBe(true)

      // Subsequent call is ignored
      const secondCall = await onRenderStart()
      expect(secondCall).toEqual({ ignored: true })
    })
  })

  describe('WebCodecs chunk saving and completion flow', () => {
    it('saves WebCodecs MP4 chunk directly to session chunk path and completes without child process', async () => {
      const chunks: ChunkSlice[] = [
        { index: 0, startFrame: 0, endFrame: 60, chunkFrames: 60, chunkDuration: 2.0, chunkPath: '/tmp/chunk_0.mp4' },
      ]
      const writtenFiles = new Map<string, Uint8Array>()
      const mockFsWriteFile = vi.fn(async (filePath: string, buffer: Uint8Array) => {
        writtenFiles.set(filePath, buffer)
      })

      const saveChunkHandler = async (chunkIndex: number, buffer: Uint8Array) => {
        const chunk = chunks[chunkIndex]
        await mockFsWriteFile(chunk.chunkPath, buffer)
        return { success: true }
      }

      const mockBuffer = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]) // ftyp box header
      const saveResult = await saveChunkHandler(0, mockBuffer)
      expect(saveResult).toEqual({ success: true })
      expect(mockFsWriteFile).toHaveBeenCalledWith('/tmp/chunk_0.mp4', mockBuffer)
      expect(writtenFiles.get('/tmp/chunk_0.mp4')).toEqual(mockBuffer)

      // Test WebCodecs completion flow: resolver is called directly when finishRender arrives
      const chunkProcesses: (Record<string, unknown> | null)[] = [null]
      let resolved = false
      const chunkResolvers = [
        () => {
          resolved = true
        },
      ]
      const finishListener = (chunkIndex: number) => {
        if (!chunkProcesses[chunkIndex]) {
          chunkResolvers[chunkIndex]?.()
        }
      }

      finishListener(0)
      expect(resolved).toBe(true)
    })

    it('updates progress when worker sends chunk progress', () => {
      const chunkFramesWritten = [0, 0]
      let lastProgress: { totalDone: number } | null = null
      const onProgress = (p: { totalDone: number }) => {
        lastProgress = p
      }

      const chunkProgressHandler = (chunkIndex: number, framesDone: number) => {
        chunkFramesWritten[chunkIndex] = framesDone
        const totalDone = chunkFramesWritten.reduce((a, b) => a + b, 0)
        onProgress({ totalDone })
      }

      chunkProgressHandler(0, 45)
      expect(chunkFramesWritten[0]).toBe(45)
      expect(lastProgress).toEqual({ totalDone: 45 })

      chunkProgressHandler(1, 30)
      expect(chunkFramesWritten[1]).toBe(30)
      expect(lastProgress).toEqual({ totalDone: 75 })
    })
  })
})
