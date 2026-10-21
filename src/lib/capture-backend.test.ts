import { describe, expect, it } from 'vitest'
import { cropsAfterCapture, resolveCaptureBackend } from './capture-backend'

describe('resolveCaptureBackend', () => {
  it('keeps the existing macOS path: renderer capture, grafted audio, picker, telemetry', () => {
    expect(resolveCaptureBackend('darwin', false)).toEqual({
      usesRendererCapture: true,
      systemAudioRidesInScreenStream: true,
      displayPickerSupported: true,
      cursorTelemetry: true,
      notice: null,
    })
  })

  it('keeps the existing X11 path: FFmpeg grabs the screen, picker and telemetry work', () => {
    expect(resolveCaptureBackend('linux', false)).toEqual({
      usesRendererCapture: false,
      systemAudioRidesInScreenStream: false,
      displayPickerSupported: true,
      cursorTelemetry: true,
      notice: null,
    })
  })

  it('keeps the existing Windows path', () => {
    const traits = resolveCaptureBackend('win32', false)
    expect(traits.usesRendererCapture).toBe(false)
    expect(traits.cursorTelemetry).toBe(true)
    expect(traits.notice).toBeNull()
  })

  it('on Wayland: renderer capture, but no picker, no telemetry and no grafted audio', () => {
    const traits = resolveCaptureBackend('linux', true)
    expect(traits.usesRendererCapture).toBe(true)
    // The Linux audio model is kept: the mic and system audio stay on their own writer.
    expect(traits.systemAudioRidesInScreenStream).toBe(false)
    // The portal's picker decides the source, not our display dropdown.
    expect(traits.displayPickerSupported).toBe(false)
    // The pointer is burned into the pixels; there is nothing to read.
    expect(traits.cursorTelemetry).toBe(false)
  })

  it('on Wayland says so up front, in the user\u2019s terms', () => {
    const notice = resolveCaptureBackend('linux', true).notice
    expect(notice).toContain('system dialog')
    expect(notice).toContain('pointer')
  })

  it('assumes nothing before the platform is known', () => {
    // The record button is disabled until initialisation finishes, so this is
    // only a guard, and it must not claim Wayland by accident.
    expect(resolveCaptureBackend(null, null)).toEqual({
      usesRendererCapture: false,
      systemAudioRidesInScreenStream: false,
      displayPickerSupported: true,
      cursorTelemetry: true,
      notice: null,
    })
  })

  it('does not treat a forced-Wayland X11 session as unknown', () => {
    expect(resolveCaptureBackend('linux', true).usesRendererCapture).toBe(true)
  })

  it('a Wayland report on another platform changes nothing', () => {
    expect(resolveCaptureBackend('darwin', true).systemAudioRidesInScreenStream).toBe(true)
    expect(resolveCaptureBackend('win32', true).usesRendererCapture).toBe(false)
  })
})

describe('cropsAfterCapture', () => {
  it('is true only on Wayland, where the selection has to be cut out afterwards', () => {
    expect(cropsAfterCapture('linux', true)).toBe(true)
    expect(cropsAfterCapture('linux', false)).toBe(false)
    expect(cropsAfterCapture('darwin', false)).toBe(false)
    expect(cropsAfterCapture('win32', false)).toBe(false)
    expect(cropsAfterCapture(null, null)).toBe(false)
  })
})

describe('when the native cursor helper is capturing', () => {
  // Main reports this in the session summary once a helper is bundled and this is a
  // Wayland session: the renderer must then keep its hands off the screen, because
  // two capture paths would mean two portals and the pointer recorded twice.
  const traits = resolveCaptureBackend('linux', true, 'helper')

  it('leaves the capture to the helper', () => {
    expect(traits.usesRendererCapture).toBe(false)
  })

  it('reports that the pointer is available as data, so the notice is not a limitation', () => {
    expect(traits.cursorTelemetry).toBe(true)
    expect(traits.notice).toContain('pointer is captured as data')
    expect(traits.notice).not.toContain('cannot be restyled')
  })

  it('still lets the system dialog choose the screen', () => {
    expect(traits.displayPickerSupported).toBe(false)
  })

  it('keeps the Linux audio model, so system audio is unaffected', () => {
    expect(traits.systemAudioRidesInScreenStream).toBe(false)
  })

  it('is ignored on platforms that never have a helper', () => {
    // A stale summary must not stop the renderer capturing on macOS.
    expect(resolveCaptureBackend('darwin', false, 'renderer').usesRendererCapture).toBe(true)
    expect(resolveCaptureBackend('win32', false, 'ffmpeg').usesRendererCapture).toBe(false)
  })
})
