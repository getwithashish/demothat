import { describe, expect, it } from 'vitest'
import {
  SAVING_INDICATOR_DELAY_MS,
  deriveSaveStatus,
  formatInterval,
  formatRelativeTime,
  selectSaveIndicator,
  shouldAutoSave,
} from './auto-save'

const TICK = { autoSaveEnabled: true, hasVideo: true, isDirty: true, inFlight: false }

describe('shouldAutoSave', () => {
  it('saves when autosave is on, there is a video and there are changes', () => {
    expect(shouldAutoSave(TICK)).toBe(true)
  })

  it('skips when autosave is turned off', () => {
    expect(shouldAutoSave({ ...TICK, autoSaveEnabled: false })).toBe(false)
  })

  it('skips with no recording loaded', () => {
    expect(shouldAutoSave({ ...TICK, hasVideo: false })).toBe(false)
  })

  it('skips when the project is already clean', () => {
    expect(shouldAutoSave({ ...TICK, isDirty: false })).toBe(false)
  })

  it('skips while a save is already in flight', () => {
    expect(shouldAutoSave({ ...TICK, inFlight: true })).toBe(false)
  })

  it('skips while the project file is being renamed', () => {
    expect(shouldAutoSave({ ...TICK, renaming: true })).toBe(false)
  })
})

describe('deriveSaveStatus', () => {
  it('is untitled without a project path', () => {
    expect(deriveSaveStatus({ currentProjectPath: null, saveStatus: 'saved' }, false)).toBe('untitled')
  })

  it('stays untitled even when the untitled project has edits', () => {
    expect(deriveSaveStatus({ currentProjectPath: null, saveStatus: 'untitled' }, true)).toBe('untitled')
  })

  it('is unsaved when a titled project has edits', () => {
    expect(deriveSaveStatus({ currentProjectPath: '/p/a.dthat', saveStatus: 'saved' }, true)).toBe('unsaved')
  })

  it('is saved when a titled project has no edits', () => {
    expect(deriveSaveStatus({ currentProjectPath: '/p/a.dthat', saveStatus: 'unsaved' }, false)).toBe('saved')
  })

  it('never overrides an in-flight save', () => {
    expect(deriveSaveStatus({ currentProjectPath: '/p/a.dthat', saveStatus: 'saving' }, true)).toBe('saving')
  })

  it('keeps an error visible until the next attempt', () => {
    expect(deriveSaveStatus({ currentProjectPath: '/p/a.dthat', saveStatus: 'error' }, false)).toBe('error')
  })
})

describe('formatInterval', () => {
  it('reads in seconds below a minute', () => {
    expect(formatInterval(15)).toBe('15 seconds')
    expect(formatInterval(30)).toBe('30 seconds')
    expect(formatInterval(1)).toBe('1 second')
  })

  it('reads in minutes above that', () => {
    expect(formatInterval(60)).toBe('1 minute')
    expect(formatInterval(300)).toBe('5 minutes')
  })

  it('degrades gracefully for nonsense input', () => {
    expect(formatInterval(0)).toBe('a moment')
    expect(formatInterval(Number.NaN)).toBe('a moment')
  })
})

describe('formatRelativeTime', () => {
  const now = 1_700_000_000_000

  it('reads seconds, minutes and hours', () => {
    expect(formatRelativeTime(now - 12_000, now)).toBe('12 seconds ago')
    expect(formatRelativeTime(now - 120_000, now)).toBe('2 minutes ago')
    expect(formatRelativeTime(now - 7_200_000, now)).toBe('2 hours ago')
    expect(formatRelativeTime(now - 60_000, now)).toBe('1 minute ago')
  })

  it('says just now for the last few seconds', () => {
    expect(formatRelativeTime(now - 1_000, now)).toBe('just now')
  })

  it('is null when there is no timestamp', () => {
    expect(formatRelativeTime(null, now)).toBeNull()
  })
})

const INDICATOR = {
  saveStatus: 'saved' as const,
  savingElapsedMs: 0,
  autoSaveEnabled: true,
  autoSaveIntervalSec: 30,
  lastSavedClock: '3:42 PM',
  recoveryClock: null,
  saveError: null,
}

describe('selectSaveIndicator', () => {
  it('labels a completed save and shows when it happened', () => {
    const view = selectSaveIndicator(INDICATOR)
    expect(view.kind).toBe('saved')
    expect(view.label).toBe('Saved')
    expect(view.tooltip).toBe('Last saved at 3:42 PM')
    expect(view.holdPrevious).toBe(false)
  })

  it('holds the previous state for a save younger than the flicker window', () => {
    const view = selectSaveIndicator({
      ...INDICATOR,
      saveStatus: 'saving',
      savingElapsedMs: SAVING_INDICATOR_DELAY_MS - 1,
    })
    expect(view.holdPrevious).toBe(true)
  })

  it('shows Saving… once the save passes the flicker window', () => {
    const view = selectSaveIndicator({
      ...INDICATOR,
      saveStatus: 'saving',
      savingElapsedMs: SAVING_INDICATOR_DELAY_MS,
    })
    expect(view.holdPrevious).toBe(false)
    expect(view.kind).toBe('saving')
    expect(view.label).toBe('Saving…')
  })

  it('explains that auto-save is coming, using the real interval', () => {
    const view = selectSaveIndicator({ ...INDICATOR, saveStatus: 'unsaved', autoSaveIntervalSec: 5 })
    expect(view.label).toBe('Unsaved changes')
    expect(view.tooltip).toBe('Auto-saves within 5 seconds')
  })

  it('says auto-save is off when it is off', () => {
    const view = selectSaveIndicator({ ...INDICATOR, saveStatus: 'unsaved', autoSaveEnabled: false })
    expect(view.tooltip).toBe('Auto-save is off. Turn it on in Settings.')
  })

  it('surfaces the save error text', () => {
    const view = selectSaveIndicator({ ...INDICATOR, saveStatus: 'error', saveError: 'Disk is full' })
    expect(view.kind).toBe('error')
    expect(view.label).toBe("Couldn't save")
    expect(view.tooltip).toBe('Disk is full')
  })

  it('reports the recovery copy age for an untitled project', () => {
    const view = selectSaveIndicator({ ...INDICATOR, saveStatus: 'untitled', recoveryClock: '12 seconds ago' })
    expect(view.label).toBe('Not saved yet')
    expect(view.tooltip).toBe('Recovery copy saved 12 seconds ago')
  })

  it('says plainly when nothing has been written yet', () => {
    const view = selectSaveIndicator({ ...INDICATOR, saveStatus: 'untitled' })
    expect(view.tooltip).toBe('This project has not been saved to a file yet')
  })
})
