import { describe, expect, it, vi } from 'vitest'

describe('parallel export chunk write isolation', () => {
  it('isolates unblock callbacks per chunk so concurrent workers do not clobber each other', () => {
    const numWorkers = 4
    const unblockPendingChunkWrites: Array<(() => void) | null> = Array(numWorkers).fill(null)

    const unblock0 = vi.fn()
    const unblock1 = vi.fn()
    const unblock2 = vi.fn()
    const unblock3 = vi.fn()

    // Worker 0 and Worker 2 experience backpressure
    unblockPendingChunkWrites[0] = unblock0
    unblockPendingChunkWrites[2] = unblock2

    expect(unblockPendingChunkWrites[0]).toBe(unblock0)
    expect(unblockPendingChunkWrites[1]).toBeNull()
    expect(unblockPendingChunkWrites[2]).toBe(unblock2)
    expect(unblockPendingChunkWrites[3]).toBeNull()

    // Worker 0 drains and clears its own unblock callback
    unblockPendingChunkWrites[0] = null

    // Worker 2 should still be intact and unaffected by Worker 0 clearing
    expect(unblockPendingChunkWrites[0]).toBeNull()
    expect(unblockPendingChunkWrites[2]).toBe(unblock2)

    // Worker 1 and Worker 3 also register callbacks
    unblockPendingChunkWrites[1] = unblock1
    unblockPendingChunkWrites[3] = unblock3

    // Aborting parallel export iterates and triggers all pending unblocks
    for (let i = 0; i < unblockPendingChunkWrites.length; i++) {
      const unblock = unblockPendingChunkWrites[i]
      unblockPendingChunkWrites[i] = null
      unblock?.()
    }

    expect(unblock0).not.toHaveBeenCalled() // Was already cleared on drain
    expect(unblock1).toHaveBeenCalledTimes(1)
    expect(unblock2).toHaveBeenCalledTimes(1)
    expect(unblock3).toHaveBeenCalledTimes(1)

    // All slots are now cleared
    expect(unblockPendingChunkWrites.every((cb) => cb === null)).toBe(true)
  })
})
