// --- Types ---
export type BackgroundType = 'color' | 'gradient' | 'image' | 'wallpaper'
export type AspectRatio = '16:9' | '9:16' | '4:3' | '3:4' | '1:1'
export type SidePanelTab = 'general' | 'camera' | 'cursor' | 'audio' | 'animation' | 'settings'

export interface Background {
  type: BackgroundType
  color?: string
  gradientStart?: string
  gradientEnd?: string
  gradientDirection?: string
  imageUrl?: string
  thumbnailUrl?: string
}

export interface FrameStyles {
  padding: number
  background: Background
  borderRadius: number
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  shadowColor: string
  borderWidth: number
  borderColor: string
}

export interface CursorStyles {
  showCursor: boolean
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  shadowColor: string
  // Click Effects
  clickRippleEffect: boolean
  clickRippleColor: string
  clickRippleSize: number
  clickRippleDuration: number
  clickScaleEffect: boolean
  clickScaleAmount: number
  clickScaleDuration: number
  clickScaleEasing: string
}

export interface Preset {
  id: string
  name: string
  styles: FrameStyles
  aspectRatio: AspectRatio
  isDefault?: boolean
  webcamStyles?: WebcamStyles
  webcamPosition?: WebcamPosition
  isWebcamVisible?: boolean
}

export interface ZoomRegion {
  id: string
  type: 'zoom'
  startTime: number
  duration: number
  zoomLevel: number
  easing: string // Changed from 'linear' | 'ease-in-out'
  transitionDuration: number // New property for speed
  targetX: number
  targetY: number
  mode: 'auto' | 'fixed'
  zIndex: number
}

export interface CutRegion {
  id: string
  type: 'cut'
  startTime: number
  duration: number
  trimType?: 'start' | 'end'
  zIndex: number
}

export interface VideoClip {
  id: string
  name: string
  filePath: string
  startTime: number
  duration: number
  sourceDuration: number
  /** Offset into the source media where this clip starts playing (left-trim). */
  sourceStart: number
  /**
   * Stacking order for the composite. Higher values draw on top of lower ones.
   * The screen recording always sits below every imported clip.
   */
  order: number
}

export interface SpeedRegion {
  id: string
  type: 'speed'
  startTime: number
  duration: number
  speed: number // e.g., 1.5 for 1.5x speed
  zIndex: number
}

export type TimelineRegion = ZoomRegion | CutRegion | SpeedRegion

export interface MetaDataItem {
  timestamp: number
  x: number
  y: number
  type: 'click' | 'move' | 'scroll'
  button?: string
  pressed?: boolean
  cursorImageKey?: string
}

export interface CursorFrame {
  width: number
  height: number
  xhot: number
  yhot: number
  delay: number
  rgba: Buffer
}

export interface CursorImageBase {
  width: number
  height: number
  xhot: number
  yhot: number
}

export interface CursorImage extends CursorImageBase {
  image: number[]
}

export interface CursorImageBitmap extends CursorImageBase {
  imageBitmap: ImageBitmap
}

export interface WebcamPosition {
  pos:
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right'
    | 'left-center'
    | 'right-center'
}

export type WebcamShape = 'circle' | 'square' | 'rectangle'

export interface WebcamStyles {
  shape: WebcamShape
  borderRadius: number
  size: number
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  shadowColor: string
  isFlipped: boolean
  scaleOnZoom: boolean
  smartPosition: boolean
}

export type Dimensions = { width: number; height: number }
export type RecordingGeometry = { x: number; y: number; width: number; height: number }
export type VideoDimensions = Dimensions
export type ScreenSize = Dimensions
export type CursorTheme = Record<number, Record<string, CursorFrame[]>>

// --- Slice State & Actions Types ---

export interface ProjectState {
  videoPath: string | null
  metadataPath: string | null
  videoUrl: string | null
  videoDimensions: VideoDimensions
  recordingGeometry: RecordingGeometry | null
  screenSize: ScreenSize | null
  canvasDimensions: Dimensions
  metadata: MetaDataItem[]
  duration: number
  cursorImages: Record<string, CursorImage>
  cursorBitmapsToRender: Map<string, CursorImageBitmap>
  syncOffset: number
  platform: NodeJS.Platform | null
  cursorTheme: CursorTheme | null
  hasAudioTrack: boolean
  /** Path of the `.dthat` this session was saved to / opened from. */
  currentProjectPath: string | null
  /** True when the project has changes since the last save/open. */
  isDirty: boolean
}

export interface ProjectActions {
  loadProject: (paths: { videoPath: string; metadataPath: string; webcamVideoPath?: string }) => Promise<void>
  setVideoDimensions: (dims: { width: number; height: number }) => void
  setDuration: (duration: number) => void
  resetProjectState: () => void
  setPostProcessingCursorScale: (scale: number) => Promise<void>
  reloadCursorTheme: (themeName: string) => Promise<void>
  setHasAudioTrack: (hasAudio: boolean) => void
  /** Applies a project opened from a `.dthat` archive over a fresh load. */
  applyOpenedProject: (project: Record<string, unknown>, projectPath: string) => Promise<void>
  /** Saves the project; with saveAs the user is asked for a destination. */
  saveProject: (options?: { saveAs?: boolean; auto?: boolean }) => Promise<{
    canceled: boolean
    path?: string
    /** True when the write went to the crash-recovery copy, not a real project file. */
    recovery?: boolean
  }>
}

export interface PlaybackState {
  isPlaying: boolean
  currentTime: number
}
export interface PlaybackActions {
  setCurrentTime: (time: number) => void
  togglePlay: () => void
  setPlaying: (isPlaying: boolean) => void
  seekToPreviousFrame: () => void
  seekToNextFrame: () => void
  seekBackward: (seconds: number) => void
  seekForward: (seconds: number) => void
}

export type CameraMoveKind =
  'custom' | 'dolly-in' | 'dolly-out' | 'pan-left' | 'pan-right' | 'entrance' | 'orbit' | 'reset' | 'breathing'

export interface CameraPose {
  x: number // horizontal offset as a percentage of output width
  y: number // vertical offset as a percentage of output height
  scale: number
  rotationX: number
  rotationY: number
  rotationZ: number
  perspective: number
}

export interface CameraMotionTrack {
  id: string
  name: string
  kind: CameraMoveKind
  startTime: number
  endTime: number
  easing: string
  from: CameraPose
  to: CameraPose
}

export type VisualEffectKind = 'mask' | 'blur' | 'focus' | 'border'
export type EffectShape = 'rectangle' | 'square' | 'circle' | 'freeform'
export interface VisualEffectRegion {
  id: string
  kind: VisualEffectKind
  shape: EffectShape
  startTime: number
  duration: number
  x: number // normalized 0..1 output coordinate
  y: number
  width: number
  height: number
  points: { x: number; y: number }[] // normalized polygon points for freeform masks
  color: string
  borderWidth: number
  blur: number
  dimOutside: number
  scale: number
  animated: boolean
  direction: 'in' | 'out' | 'both'
  loop: boolean
  enterDuration: number
  exitDuration: number
}
export type CompositionLayout =
  | 'picture-in-picture'
  | 'side-by-side'
  | 'presenter-focus'
  | 'screen-only'
  | 'presenter-top'
  | 'presenter-bottom'
  | 'split-vertical'
  | 'large-picture-in-picture'
export interface CompositionLayoutRange {
  id: string
  layout: CompositionLayout
  startTime: number
  duration: number
  transitionDuration: number
}

export interface FrameState {
  compositionLayouts: CompositionLayoutRange[]
  frameStyles: FrameStyles
  aspectRatio: AspectRatio
  cameraMotions: CameraMotionTrack[]
  visualEffects: VisualEffectRegion[]
}
export interface FrameActions {
  addCameraMotion: (kind: CameraMoveKind, startTime: number, endTime: number) => void
  updateCameraMotion: (id: string, updates: Partial<CameraMotionTrack>) => void
  deleteCameraMotion: (id: string) => void
  updateFrameStyle: (style: Partial<Omit<FrameStyles, 'background'>>) => void
  updateBackground: (bg: Partial<Background>) => void
  setAspectRatio: (ratio: AspectRatio) => void
  addVisualEffect: (kind: VisualEffectKind) => void
  updateVisualEffect: (id: string, updates: Partial<VisualEffectRegion>) => void
  deleteVisualEffect: (id: string) => void
  addCompositionLayout: (layout: CompositionLayout) => void
  updateCompositionLayout: (id: string, updates: Partial<CompositionLayoutRange>) => void
  deleteCompositionLayout: (id: string) => void
}

export interface TimelineState {
  zoomRegions: Record<string, ZoomRegion>
  cutRegions: Record<string, CutRegion>
  speedRegions: Record<string, SpeedRegion>
  videoClips: VideoClip[]
  previewCutRegion: CutRegion | null
  selectedRegionId: string | null
  activeZoomRegionId: string | null
  isCurrentlyCut: boolean
  timelineZoom: number
}
export interface TimelineActions {
  addZoomRegion: () => void
  addCutRegion: (regionData?: Partial<CutRegion>) => void
  addSpeedRegion: () => void
  addVideoClip: (clip: Omit<VideoClip, 'id' | 'order' | 'sourceStart'>) => void
  updateVideoClip: (id: string, updates: Partial<VideoClip>) => void
  deleteVideoClip: (id: string) => void
  /** Assigns stacking order from a bottom-to-top list of clip ids. */
  setVideoClipOrder: (orderedIds: string[]) => void
  updateRegion: (id: string, updates: Partial<TimelineRegion>) => void
  deleteRegion: (id: string) => void
  setSelectedRegionId: (id: string | null) => void
  setPreviewCutRegion: (region: CutRegion | null) => void
  setTimelineZoom: (zoom: number) => void
  applyAnimationSettingsToAll: (settings: { transitionDuration: number; easing: string; zoomLevel: number }) => void
  applySpeedToAll: (speed: number) => void
}

export interface PresetState {
  presets: Record<string, Preset>
  activePresetId: string | null
  presetSaveStatus: 'idle' | 'saving' | 'saved'
}
export interface PresetActions {
  initializePresets: () => Promise<void>
  applyPreset: (id: string) => void
  resetPreset: (id: string) => void
  updatePresetName: (id: string, name: string) => void
  saveCurrentStyleAsPreset: (name: string) => void
  updateActivePreset: () => void
  deletePreset: (id: string) => void
  _ensureActivePresetIsWritable: () => void
  _persistPresets: (presets: Record<string, Preset>) => Promise<void>
}

export interface WebcamState {
  webcamVideoPath: string | null
  webcamVideoUrl: string | null
  isWebcamVisible: boolean
  webcamPosition: WebcamPosition
  webcamStyles: WebcamStyles
}
export interface WebcamActions {
  setWebcamPosition: (position: WebcamPosition) => void
  setWebcamVisibility: (isVisible: boolean) => void
  updateWebcamStyle: (style: Partial<WebcamStyles>) => void
}

export interface UIState {
  mode: 'light' | 'dark'
  isPreviewFullScreen: boolean
  cursorThemeName: string
  cursorStyles: CursorStyles
  activeSidePanelTab: SidePanelTab
  autoSaveEnabled: boolean
  autoSaveIntervalSec: number
}
export interface UIActions {
  toggleMode: () => void
  initializeSettings: () => Promise<void>
  togglePreviewFullScreen: () => void
  setCursorThemeName: (themeName: string) => void
  updateCursorStyle: (style: Partial<CursorStyles>) => void
  setActiveSidePanelTab: (tab: SidePanelTab) => void
  setAutoSaveEnabled: (enabled: boolean) => void
  setAutoSaveIntervalSec: (seconds: number) => void
}

export interface AudioClip {
  id: string
  name: string
  filePath: string
  startTime: number
  duration: number
  sourceStart: number
  sourceDuration: number
  volume: number
  fadeIn: number
  fadeOut: number
  loop: boolean
  /** Music clips use a source file; click clips represent one removable mouse-click sound. */
  kind?: 'music' | 'click'
  /** Playback rate, where 1 is normal speed. */
  speed?: number
}

export interface AudioState {
  volume: number // 0 to 1, original-video master volume
  isMuted: boolean
  audioClips: AudioClip[]
  mouseClickSoundsEnabled: boolean
  mouseClickSoundPath: string | null
  mouseClickSoundName: string | null
  mouseClickSoundVolume: number
}

export interface AudioActions {
  setVolume: (volume: number) => void
  toggleMute: () => void
  setIsMuted: (isMuted: boolean) => void
  addAudioClip: (clip: Omit<AudioClip, 'id'>) => void
  updateAudioClip: (id: string, updates: Partial<AudioClip>) => void
  deleteAudioClip: (id: string) => void
  setMouseClickSoundsEnabled: (enabled: boolean) => void
  setMouseClickSound: (path: string | null, name: string | null) => void
  setMouseClickSoundVolume: (volume: number) => void
}

export type RenderableState = Pick<
  EditorState,
  | 'platform'
  | 'frameStyles'
  | 'cameraMotions'
  | 'visualEffects'
  | 'compositionLayouts'
  | 'videoDimensions'
  | 'aspectRatio'
  | 'webcamPosition'
  | 'webcamStyles'
  | 'isWebcamVisible'
  | 'zoomRegions'
  | 'cutRegions'
  | 'speedRegions'
  | 'videoClips'
  | 'metadata'
  | 'recordingGeometry'
  | 'cursorImages'
  | 'cursorBitmapsToRender'
  | 'syncOffset'
  | 'cursorTheme'
  | 'cursorStyles'
>

// Combined state type for the editor store
export type EditorState = ProjectState &
  PlaybackState &
  FrameState &
  TimelineState &
  PresetState &
  WebcamState &
  UIState &
  AudioState

// Combined actions type for the editor store
export type EditorActions = ProjectActions &
  PlaybackActions &
  FrameActions &
  TimelineActions &
  PresetActions &
  WebcamActions &
  UIActions &
  AudioActions & {
    // Global reset action
    reset: () => void
  }

// A utility type to create actions for a slice
export type Slice<T extends object, A extends object> = (
  set: (fn: (draft: EditorState) => void) => void,
  get: () => EditorState & EditorActions,
) => T & A
