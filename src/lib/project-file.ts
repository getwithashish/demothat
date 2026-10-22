import type { EditorState } from '../types'

/** What the main process expects for a project save. */
export interface ProjectSavePayload {
  projectState: Record<string, unknown>
  source: { width: number; height: number; fps: number; durationSec: number }
  backgroundImage?: { data: Uint8Array; ext: string }
}

/**
 * The serializable slice of the editor that is stored in project.json.
 * Everything `loadProject` re-derives (metadata, geometry, cursor bitmaps,
 * platform, the auto zoom regions) is deliberately left out.
 */
export function serializeEditorState(state: EditorState): Record<string, unknown> {
  return {
    videoPath: state.videoPath,
    metadataPath: state.metadataPath,
    webcamVideoPath: state.webcamVideoPath,
    frameStyles: state.frameStyles,
    aspectRatio: state.aspectRatio,
    cameraMotions: state.cameraMotions,
    visualEffects: state.visualEffects,
    compositionLayouts: state.compositionLayouts,
    audioClips: state.audioClips,
    mouseClickSoundsEnabled: state.mouseClickSoundsEnabled,
    mouseClickSoundPath: state.mouseClickSoundPath,
    mouseClickSoundName: state.mouseClickSoundName,
    mouseClickSoundVolume: state.mouseClickSoundVolume,
    hasAudioTrack: state.hasAudioTrack,
    audioTracks: state.audioTracks,
    transcript: state.transcript,
    volume: state.volume,
    isMuted: state.isMuted,
    zoomRegions: state.zoomRegions,
    cutRegions: state.cutRegions,
    speedRegions: state.speedRegions,
    videoClips: state.videoClips,
    webcamPosition: state.webcamPosition,
    webcamStyles: state.webcamStyles,
    isWebcamVisible: state.isWebcamVisible,
    cursorStyles: state.cursorStyles,
    activePresetId: state.activePresetId,
  }
}

function extensionForMime(mime: string): string | undefined {
  if (mime === 'image/jpeg') return '.jpg'
  if (mime === 'image/png') return '.png'
  if (mime === 'image/webp') return '.webp'
  if (mime === 'image/gif') return '.gif'
  return undefined
}

/**
 * Builds the save payload. A custom background image is held only as a blob:
 * URL in the renderer, so its bytes are read here and shipped to the main
 * process (which stores them inside the archive).
 */
export async function collectSavePayload(state: EditorState): Promise<ProjectSavePayload> {
  const projectState = serializeEditorState(state)

  let backgroundImage: ProjectSavePayload['backgroundImage']
  const background = state.frameStyles?.background
  if (background?.type === 'image' && background.imageUrl?.startsWith('blob:')) {
    try {
      const blob = await (await fetch(background.imageUrl)).blob()
      backgroundImage = {
        data: new Uint8Array(await blob.arrayBuffer()),
        ext: extensionForMime(blob.type) ?? '.png',
      }
    } catch (error) {
      console.warn('[ProjectFile] Could not read the custom background image; it will not be saved.', error)
    }
  }

  return {
    projectState,
    source: {
      width: state.videoDimensions?.width ?? 0,
      height: state.videoDimensions?.height ?? 0,
      // The recorder does not persist the capture frame rate, so fall back to a
      // typical screen-recording rate. Informational only.
      fps: 30,
      durationSec: state.duration ?? 0,
    },
    backgroundImage,
  }
}

let saveInFlight = false
let saveIdle: Promise<void> = Promise.resolve()
let resolveSaveIdle: (() => void) | null = null

/** Serialises saves so a menu accelerator and a keydown cannot double-save. */
export async function withSaveGuard<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  if (saveInFlight) return fallback
  saveInFlight = true
  saveIdle = new Promise<void>((resolve) => {
    resolveSaveIdle = resolve
  })
  try {
    return await run()
  } finally {
    saveInFlight = false
    resolveSaveIdle?.()
    resolveSaveIdle = null
  }
}

/**
 * Resolves once the save that is currently running (if any) has finished.
 * Used before moving the project file, so a write cannot land on the old path
 * after the rename.
 */
export function whenSaveIdle(): Promise<void> {
  return saveIdle
}
