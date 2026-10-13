import { describe, expect, it } from 'vitest'
import { getCameraPoseAtTime } from './camera-motion'
import type { CameraMotionTrack } from '../types'

const track: CameraMotionTrack = {
  id: 'camera-test', name: 'Dolly in', kind: 'dolly-in', startTime: 2, endTime: 4, easing: 'Balanced',
  from: { x: 0, y: 0, scale: 1, rotationX: 0, rotationY: 0, rotationZ: 0, perspective: 50 },
  to: { x: 0, y: 0, scale: 1.2, rotationX: 0, rotationY: -8, rotationZ: 0, perspective: 60 },
}

describe('getCameraPoseAtTime', () => {
  it('returns null before the first motion range', () => {
    expect(getCameraPoseAtTime([track], 1)).toBeNull()
  })

  it('interpolates a camera pose inside the range', () => {
    const pose = getCameraPoseAtTime([track], 3)
    expect(pose).not.toBeNull()
    expect(pose!.scale).toBeGreaterThan(1)
    expect(pose!.scale).toBeLessThan(1.2)
    expect(pose!.rotationY).toBeLessThan(0)
  })

  it('holds the final pose after the motion ends', () => {
    expect(getCameraPoseAtTime([track], 6)).toEqual(track.to)
  })

  it('uses the most recently started track when ranges overlap', () => {
    const later = { ...track, id: 'later', startTime: 3, endTime: 5, to: { ...track.to, x: 12 } }
    expect(getCameraPoseAtTime([track, later], 3.5)?.x).toBeGreaterThan(0)
  })
})
