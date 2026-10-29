// --- Types ---
import type { CreditStatus, DeviceView } from '../../shared/license'
import type { TranscriptDocument } from '../../shared/transcript'
import type { SubtitleCue, SubtitleFormat } from '../../shared/subtitles'
import type { AudioTrack } from '../../shared/audio-tracks'

export type BackgroundType = 'color' | 'gradient' | 'image' | 'wallpaper'
export type AspectRatio = '16:9' | '9:16' | '4:3' | '3:4' | '1:1'
export type SidePanelTab = 'general' | 'camera' | 'cursor' | 'audio' | 'animation' | 'subtitles' | 'settings'

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
  /** Which pointer glyph to draw. `recorded` uses the OS cursor as captured. */
  cursorIcon: 'recorded' | 'arrow' | 'text' | 'hand' | 'crosshair' | 'pointer'
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
  // Cursor motion (path smoothing and optics-based motion blur)
  /** Smooth the recorded path so erratic movements become a glide. */
  smoothingEnabled: boolean
  /** 0..1; scales the averaging window. */
  smoothing: number
  /** Draw the shutter-angle smear. */
  motionBlurEnabled: boolean
  /** Shutter angle in degrees: 360 covers the whole frame interval. */
  motionBlurShutterAngle: number
  /** How many ghosts the smear is drawn with. */
  motionBlurSamples: number
  /** Scales the smear length (1 = physically derived from speed). */
  motionBlurStrength: number
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
  /** Post-processing scale the bitmap was rasterized at (Linux Size control). */
  scale?: number
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
  /** Selectable pointer icons, keyed by style name ('arrow','text',…). */
  cursorIconsToRender: Map<string, CursorImageBitmap>
  syncOffset: number
  platform: NodeJS.Platform | null
  cursorTheme: CursorTheme | null
  hasAudioTrack: boolean
  /**
   * The recording's audio sources, one entry per source. A recording made before
   * the sources were separated has a single `mixed` track.
   */
  audioTracks: AudioTrack[]
  /**
   * True when `audioTracks` came from the recording's own manifest.
   *
   * When it is false the manifest predates the split and could not say how many
   * sources there were, so the tracks are provisional until the player reports
   * whether the recording has audio at all. Not serialized: it describes where the
   * tracks came from, not the edit.
   */
  audioTracksFromManifest: boolean
  /**
   * The cloud transcription of this recording, in **source time**, or null when it
   * has not been transcribed. It is part of the project rather than a transient:
   * a transcription costs credits, so re-running it after a reload would charge the
   * user twice for the same audio.
   */
  transcript: TranscriptDocument | null
  /** The captions on the exported video's timeline, in export time. */
  subtitleCues: SubtitleCue[]
  /** Whether a sidecar is written beside the exported video. */
  subtitlesEnabled: boolean
  /** Which sidecar format to write. */
  subtitleFormat: SubtitleFormat
  /** Path of the `.dthat` this session was saved to / opened from. */
  currentProjectPath: string | null
  /** True when the project has changes since the last save/open. */
  isDirty: boolean
  /** Where the save lifecycle currently is; drives the header indicator. */
  saveStatus: SaveStatus
  /** Epoch ms of the last successful save to a real `.dthat`. */
  lastSavedAt: number | null
  /** Epoch ms of the last crash-recovery copy write. */
  lastRecoveryAt: number | null
  /** Message from the last failed save; cleared on the next success. */
  saveError: string | null
  /** True while the project file is being renamed; autosave stands still. */
  isRenaming: boolean
  /** The rolling crash-recovery copy on disk, if there is one. */
  recoveryCopy: { exists: boolean; modifiedAt: number | null }
  /** True when this session wrote (or opened) that recovery copy. */
  recoveryCopyOwned: boolean
}

/** Save lifecycle shown in the header's save indicator. */
export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error' | 'untitled'

/** A project the user opened or saved recently (most recent first). */
export interface RecentProject {
  /** Absolute path of the `.dthat` archive. */
  path: string
  /** Display name, without the extension. */
  name: string
  /** Epoch ms it was last opened or saved. */
  openedAt: number
}

export interface ProjectActions {
  loadProject: (paths: { videoPath: string; metadataPath: string; webcamVideoPath?: string }) => Promise<void>
  setVideoDimensions: (dims: { width: number; height: number }) => void
  setDuration: (duration: number) => void
  resetProjectState: () => void
  setPostProcessingCursorScale: (scale: number) => Promise<void>
  reloadCursorTheme: (themeName: string) => Promise<void>
  setHasAudioTrack: (hasAudio: boolean) => void
  /** Replace the recording's tracks — from a manifest, or from an opened project. */
  setAudioTracks: (tracks: AudioTrack[]) => void
  /** Change one track's volume or mute, leaving the others alone. */
  updateAudioTrack: (id: string, patch: Partial<Pick<AudioTrack, 'volume' | 'muted'>>) => void
  /** Store a transcription (or clear it). It is part of the project, so this marks
   *  the project dirty: a transcription cost credits, and losing it on reload would
   *  mean paying for it twice. */
  setTranscript: (transcript: TranscriptDocument | null) => void
  /** Replace the caption list — from a transcription, or from an opened project. */
  setSubtitleCues: (cues: SubtitleCue[]) => void
  /** Change one cue's text or timing, leaving the others alone. */
  updateSubtitleCue: (id: string, patch: { start?: number; end?: number; text?: string }) => void
  /** Remove one cue. */
  removeSubtitleCue: (id: string) => void
  /** Turn the sidecar on or off, and choose its format. */
  setSubtitlesEnabled: (enabled: boolean) => void
  setSubtitleFormat: (format: SubtitleFormat) => void
  /** Applies a project opened from a `.dthat` archive over a fresh load. */
  applyOpenedProject: (
    project: Record<string, unknown>,
    projectPath: string,
    /** `asUntitled` adopts a recovered project: no path, and left dirty. */
    options?: { asUntitled?: boolean },
  ) => Promise<void>
  /** Saves the project; with saveAs the user is asked for a destination. */
  saveProject: (options?: { saveAs?: boolean; auto?: boolean }) => Promise<{
    canceled: boolean
    path?: string
    /** True when the write went to the crash-recovery copy, not a real project file. */
    recovery?: boolean
  }>
  /**
   * Writes a snapshot to a new file. Never adopts the path and never touches the
   * dirty flag: the original keeps being edited and autosaved.
   */
  saveProjectCopy: () => Promise<{ canceled: boolean; path?: string; error?: string }>
  /** Renames the `.dthat` on disk and repoints the session at it. */
  renameCurrentProject: (newName: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  /** Re-reads whether a crash-recovery copy exists (and how old it is). */
  refreshRecoveryCopy: () => Promise<void>
  /**
   * Opens the rolling recovery copy as an UNSAVED project, so the first save
   * asks for a location and never lands back on the recovery file.
   */
  openRecoveryCopy: () => Promise<boolean>
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
  /**
   * Find the dead stretches in the recording and add a speed region over each.
   * Resolves with how many were added, and how many were considered.
   */
  tidyUp: () => Promise<{ added: number; suggested: number }>
  addVideoClip: (clip: Omit<VideoClip, 'id' | 'order' | 'sourceStart'>) => void
  updateVideoClip: (id: string, updates: Partial<VideoClip>) => void
  deleteVideoClip: (id: string) => void
  /** Assigns stacking order from a bottom-to-top list of clip ids. */
  setVideoClipOrder: (orderedIds: string[]) => void
  updateRegion: (id: string, updates: Partial<TimelineRegion>) => void
  deleteRegion: (id: string) => void
  /** Deletes whatever is selected (region / effect / layout / motion / clip). */
  deleteSelected: () => void
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

/** A short, dismissible message in the corner of the editor. */
export interface Toast {
  id: string
  message: string
  /** Optional button label, e.g. "Open". */
  actionLabel?: string
  /** Path revealed by the action button (the copy that was just written). */
  revealPath?: string
}

export interface UIState {
  mode: 'light' | 'dark'
  isPreviewFullScreen: boolean
  cursorThemeName: string
  cursorStyles: CursorStyles
  activeSidePanelTab: SidePanelTab
  autoSaveEnabled: boolean
  autoSaveIntervalSec: number
  /** Recently opened/saved projects, most recent first. */
  recentProjects: RecentProject[]
  /** Corner messages, oldest first. */
  toasts: Toast[]
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
  /** Loads the remembered project list from the settings store. */
  initializeRecentProjects: () => Promise<void>
  /** Records a project as recently used (called after an open or a save). */
  rememberRecentProject: (path: string) => void
  /** Drops a project from the list (missing file, or the user clearing it). */
  forgetRecentProject: (path: string) => void
  clearRecentProjects: () => void
  /** Shows a corner message; the newest few are kept. */
  pushToast: (toast: { message: string; actionLabel?: string; revealPath?: string }) => void
  dismissToast: (id: string) => void
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

export interface LicenseState {
  /** Plan name, or null when this device is not activated. */
  plan: string | null
  /** Credit balance as last reported by the API (or the token while offline). */
  balance: number
  /** Derived from the balance and the low threshold; drives the capsule. */
  creditStatus: CreditStatus
  /** Devices on this license, as returned by the API. */
  licenseDevices: DeviceView[]
  /** True while a license call is in flight. */
  licenseBusy: boolean
  /** Message from the last failed activation; cleared when the dialog reopens. */
  licenseError: string | null
}

export interface LicenseActions {
  /** Re-reads the plan and balance from the main process. */
  refreshBalance: () => Promise<void>
  /** Activates this device; returns true when it succeeded. */
  activateLicense: (licenseKey: string) => Promise<boolean>
  /** Refreshes just the device list. */
  refreshDevices: () => Promise<void>
  /** Deactivates a device; returns true when it succeeded. */
  deactivateDevice: (deviceId: string) => Promise<boolean>
  /** Clears the stored activation error (called when the dialog opens). */
  clearLicenseError: () => void
}

export interface PurchaseState {
  /** Buy credits dialog. */
  buyCreditsOpen: boolean
  /** Credits still needed when the dialog was opened from an export shortfall. */
  buyCreditsShortfall: number | null
  /** Waiting-for-payment dialog. */
  waitingForPayment: boolean
  /**
   * True only while a checkout the USER just started is being watched. Gates the
   * pending event so a purchase carried over from a previous session settles
   * silently instead of popping the waiting dialog on every editor window.
   */
  checkoutUserInitiated: boolean
  /** The allow-listed checkout URL, offered as "Copy link". */
  checkoutUrl: string | null
  /** Failure text shown inside the waiting dialog. */
  purchaseError: string | null
  /** Credits added by the last purchase; drives the count-up chip. */
  creditsAddedChip: number | null
}

export interface PurchaseActions {
  /** Opens Buy credits; pass a shortfall to preselect the covering pack. */
  openBuyCredits: (shortfall?: number | null) => void
  closeBuyCredits: () => void
  /** Starts checkout and shows the waiting dialog; returns true when it opened. */
  startPurchase: (productId: string) => Promise<boolean>
  /** Stops waiting (the payment itself is untouched). */
  cancelWaiting: () => void
  /** Shows the "…credits added" chip on the capsule. */
  showCreditsAdded: (credits: number) => void
  dismissCreditsAdded: () => void
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
  | 'cursorIconsToRender'
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
  AudioState &
  LicenseState &
  PurchaseState

// Combined actions type for the editor store
export type EditorActions = ProjectActions &
  PlaybackActions &
  FrameActions &
  TimelineActions &
  PresetActions &
  WebcamActions &
  UIActions &
  AudioActions &
  LicenseActions &
  PurchaseActions & {
    // Global reset action
    reset: () => void
  }

// A utility type to create actions for a slice
export type Slice<T extends object, A extends object> = (
  set: (fn: (draft: EditorState) => void) => void,
  get: () => EditorState & EditorActions,
) => T & A
