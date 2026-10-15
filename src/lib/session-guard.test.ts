import { describe, expect, it } from 'vitest'
import { decideSessionAction } from './session-guard'

describe('decideSessionAction', () => {
  it('does nothing when there are no unsaved changes', () => {
    expect(decideSessionAction({ isDirty: false, hasProjectPath: true, reason: 'close' })).toBe('nothing-to-do')
    expect(decideSessionAction({ isDirty: false, hasProjectPath: false, reason: 'open' })).toBe('nothing-to-do')
  })

  it('saves a filed project with unsaved changes, whatever the reason', () => {
    for (const reason of ['open', 'close', 'quit'] as const) {
      expect(decideSessionAction({ isDirty: true, hasProjectPath: true, reason })).toBe('save')
    }
  })

  it('asks before discarding a never-saved project when opening', () => {
    expect(decideSessionAction({ isDirty: true, hasProjectPath: false, reason: 'open' })).toBe('ask-untitled')
  })

  it('keeps a recovery copy when leaving a never-saved project', () => {
    expect(decideSessionAction({ isDirty: true, hasProjectPath: false, reason: 'close' })).toBe('recovery-then-ask')
    expect(decideSessionAction({ isDirty: true, hasProjectPath: false, reason: 'quit' })).toBe('recovery-then-ask')
  })
})
