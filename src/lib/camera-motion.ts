import type { CameraMotionTrack, CameraPose } from '../types'
import { EASING_MAP } from './easing'

const DEFAULT_POSE: CameraPose = { x: 0, y: 0, scale: 1, rotationX: 0, rotationY: 0, rotationZ: 0, perspective: 50 }

/** Resolve the camera pose at a media timestamp. The function is pure so preview and export render identically. */
export function getCameraPoseAtTime(tracks: CameraMotionTrack[] | undefined, time: number): CameraPose | null {
  const active = (tracks ?? []).filter((track) => time >= track.startTime).sort((a, b) => b.startTime - a.startTime)[0]
  if (!active) return null

  const duration = Math.max(0.001, active.endTime - active.startTime)
  const progress = Math.max(0, Math.min(1, (time - active.startTime) / duration))
  const easing = EASING_MAP[active.easing as keyof typeof EASING_MAP] ?? EASING_MAP.Balanced
  // Keep spring overshoot so the spring curves visibly differ from standard easing.
  const t = easing(progress)
  const pose = {} as CameraPose
  for (const key of Object.keys(DEFAULT_POSE) as (keyof CameraPose)[]) {
    pose[key] = active.from[key] + (active.to[key] - active.from[key]) * t
  }
  if (active.kind === 'breathing') {
    // Gentle, deterministic oscillation based on media time (not wall-clock time).
    const phase = progress * Math.PI * 2
    pose.scale = active.from.scale + (active.to.scale - active.from.scale) * Math.sin(phase)
  }
  return pose
}
