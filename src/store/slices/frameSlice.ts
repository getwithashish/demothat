import { WALLPAPERS } from '../../lib/constants'
import { getCameraPoseAtTime } from '../../lib/camera-motion'
import type { FrameState, FrameActions, Slice } from '../../types'
import type { AspectRatio, FrameStyles, CameraMotionTrack, CameraMoveKind, CameraPose } from '../../types'

const DEFAULT_CAMERA_POSE: CameraPose = { x: 0, y: 0, scale: 1, rotationX: 0, rotationY: 0, rotationZ: 0, perspective: 50 }

export const initialFrameState: FrameState = {
  cameraMotions: [],
  visualEffects: [],
  frameStyles: {
    padding: 5,
    background: {
      type: 'wallpaper',
      thumbnailUrl: WALLPAPERS[0].thumbnailUrl,
      imageUrl: WALLPAPERS[0].imageUrl,
    },
    borderRadius: 16,
    shadowBlur: 35,
    shadowOffsetX: 0,
    shadowOffsetY: 15,
    shadowColor: 'rgba(0, 0, 0, 0.8)',
    borderWidth: 4,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  aspectRatio: '16:9' as AspectRatio,
}

/**
 * Calculates new canvas dimensions based on screen size and aspect ratio.
 * This helper ensures the output canvas fits within the screen while maintaining the target aspect ratio.
 * @param state - The current EditorState draft.
 */
export const recalculateCanvasDimensions = (state: {
  screenSize: { width: number; height: number } | null
  aspectRatio: AspectRatio
  canvasDimensions: { width: number; height: number }
}) => {
  if (!state.screenSize || !state.aspectRatio) {
    state.canvasDimensions = { width: 1920, height: 1080 } // Fallback
    return
  }
  const { width: screenWidth, height: screenHeight } = state.screenSize
  const [ratioW, ratioH] = state.aspectRatio.split(':').map(Number)
  const screenAspectRatio = screenWidth / screenHeight
  const targetAspectRatio = ratioW / ratioH

  let canvasWidth: number, canvasHeight: number

  if (targetAspectRatio > screenAspectRatio) {
    canvasWidth = screenWidth
    canvasHeight = Math.round(screenWidth / targetAspectRatio)
  } else {
    canvasHeight = screenHeight
    canvasWidth = Math.round(screenHeight * targetAspectRatio)
  }

  // Ensure dimensions are even numbers for video encoders
  state.canvasDimensions = {
    width: canvasWidth % 2 === 0 ? canvasWidth : canvasWidth + 1,
    height: canvasHeight % 2 === 0 ? canvasHeight : canvasHeight + 1,
  }
}

export const createFrameSlice: Slice<FrameState, FrameActions> = (set, get) => ({
  ...initialFrameState,
  addVisualEffect: (kind) => {
    const { currentTime, duration } = get()
    if (duration <= 0) return
    const defaults = { mask: { color: '#111827', blur: 0 }, blur: { color: '#ffffff', blur: 18 }, focus: { color: '#ffffff', blur: 8 }, border: { color: '#38bdf8', blur: 0 } }[kind]
    const effect = { id: `effect-${Date.now()}`, kind, shape: 'rectangle' as const, startTime: currentTime, duration: Math.max(0.5, Math.min(3, duration-currentTime)), x: 0.3, y: 0.3, width: 0.4, height: 0.3, points: [{x:0,y:0},{x:1,y:0.08},{x:0.82,y:0.62},{x:0.55,y:1},{x:0.12,y:0.78}], color: defaults.color, borderWidth: 5, blur: defaults.blur, dimOutside: 0.65, scale: 1.5, animated: kind === 'border' || kind === 'focus', direction: 'both' as const, loop: false, enterDuration: 0.25, exitDuration: 0.25 }
    set((state) => { state.visualEffects.push(effect); state.selectedRegionId = effect.id; state.activeSidePanelTab = 'general' })
  },
  updateVisualEffect: (id, updates) => set((state) => { const effect = state.visualEffects.find((item) => item.id === id); if (effect) Object.assign(effect, updates) }),
  deleteVisualEffect: (id) => set((state) => { state.visualEffects = state.visualEffects.filter((item) => item.id !== id) }),
  addCameraMotion: (kind: CameraMoveKind, startTime: number, endTime: number) => {
    const state = get()
    // Start from the camera's actual pose at this timeline position. If no 3D
    // New camera clips begin at the currently rendered camera pose, or the neutral pose.
    const currentPose = getCameraPoseAtTime(state.cameraMotions, startTime) ?? { ...DEFAULT_CAMERA_POSE }
    const from = { ...currentPose }
    const to = { ...currentPose }
    switch (kind) {
      case 'dolly-in': to.scale = from.scale * 1.18; to.rotationY = from.rotationY - 3; break
      case 'dolly-out': to.scale = from.scale / 1.18; to.rotationY = from.rotationY + 3; break
      case 'pan-left': to.x = from.x - 8; to.rotationY = from.rotationY + 5; break
      case 'pan-right': to.x = from.x + 8; to.rotationY = from.rotationY - 5; break
      case 'entrance': to.y = from.y - 10; to.scale = from.scale * 1.12; to.rotationX = from.rotationX - 4; to.rotationY = from.rotationY + 6; break
      case 'orbit': to.rotationY = from.rotationY + 24; to.rotationX = from.rotationX + 3; break
      case 'reset': Object.assign(to, { ...DEFAULT_CAMERA_POSE }); break
      case 'breathing': to.scale = from.scale * 1.035; break
      default: break
    }
    const names: Record<CameraMoveKind, string> = { custom: 'Custom move', 'dolly-in': 'Dolly in', 'dolly-out': 'Dolly out', 'pan-left': 'Pan left', 'pan-right': 'Pan right', entrance: 'Entrance', orbit: 'Orbit', reset: 'Reset', breathing: 'Breathing' }
    const track: CameraMotionTrack = { id: `camera-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: names[kind], kind, startTime: Math.max(0, startTime), endTime: Math.max(startTime + 0.1, endTime), easing: 'Balanced', from, to }
    set((state) => { state.cameraMotions.push(track) })
  },
  updateCameraMotion: (id, updates) => set((state) => {
    const track = state.cameraMotions.find((item) => item.id === id)
    if (track) Object.assign(track, updates)
  }),
  deleteCameraMotion: (id) => set((state) => { state.cameraMotions = state.cameraMotions.filter((item) => item.id !== id) }),
  updateFrameStyle: (style: Partial<Omit<FrameStyles, 'background'>>) => {
    set((state) => {
      Object.assign(state.frameStyles, style)
    })
    get()._ensureActivePresetIsWritable()
  },
  updateBackground: (bg) => {
    set((state) => {
      Object.assign(state.frameStyles.background, bg)
    })
    get()._ensureActivePresetIsWritable()
  },
  setAspectRatio: (ratio) => {
    set((state) => {
      state.aspectRatio = ratio
      recalculateCanvasDimensions(state)
    })
    get()._ensureActivePresetIsWritable()
  },
})
