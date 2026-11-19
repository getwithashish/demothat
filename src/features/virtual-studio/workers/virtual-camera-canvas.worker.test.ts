import { describe, it, expect } from 'vitest'
import { createVirtualCameraCanvasWorkerUrl, VIRTUAL_CAMERA_CANVAS_WORKER_CODE } from './virtual-camera-canvas.worker'

describe('virtual-camera-canvas.worker', () => {
  it('exports worker code containing OffscreenCanvas and RGBA handling', () => {
    expect(VIRTUAL_CAMERA_CANVAS_WORKER_CODE).toContain('OffscreenCanvas')
    expect(VIRTUAL_CAMERA_CANVAS_WORKER_CODE).toContain("format: 'rgba'")
    expect(VIRTUAL_CAMERA_CANVAS_WORKER_CODE).toContain('drawImage')
  })

  it('creates a valid blob URL in browser-like environments', () => {
    const url = createVirtualCameraCanvasWorkerUrl()
    expect(typeof url).toBe('string')
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      expect(url.startsWith('blob:')).toBe(true)
    }
  })
})
