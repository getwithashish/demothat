import type {
  ProjectState,
  ProjectActions,
  Slice,
  RecordingGeometry,
  VideoDimensions,
  CursorTheme,
  CursorImageBitmap,
  SaveStatus,
} from '../../types'
import type { MetaDataItem, ZoomRegion, CursorFrame } from '../../types'
import { ZOOM } from '../../lib/constants'
import { initialFrameState, recalculateCanvasDimensions } from './frameSlice'
import { prepareCursorBitmaps } from '../../lib/utils'
import { collectSavePayload, withSaveGuard } from '../../lib/project-file'
import type { EditorState } from '../../types'

export const initialProjectState: ProjectState = {
  videoPath: null,
  metadataPath: null,
  videoUrl: null,
  videoDimensions: { width: 0, height: 0 },
  recordingGeometry: null,
  screenSize: null,
  canvasDimensions: { width: 0, height: 0 },
  metadata: [],
  duration: 0,
  cursorImages: {},
  cursorBitmapsToRender: new Map<string, CursorImageBitmap>(),
  syncOffset: 0,
  platform: null,
  cursorTheme: null,
  hasAudioTrack: false,
  currentProjectPath: null,
  isDirty: false,
  saveStatus: 'untitled',
  lastSavedAt: null,
  lastRecoveryAt: null,
  saveError: null,
}

/**
 * Fields that, when changed, make the project dirty. Mirrors the zundo
 * partialize list plus cursor styles.
 */
function projectSignature(state: EditorState): string {
  const {
    frameStyles,
    cameraMotions,
    visualEffects,
    compositionLayouts,
    audioClips,
    mouseClickSoundsEnabled,
    mouseClickSoundPath,
    mouseClickSoundName,
    mouseClickSoundVolume,
    aspectRatio,
    zoomRegions,
    cutRegions,
    speedRegions,
    videoClips,
    webcamPosition,
    webcamStyles,
    isWebcamVisible,
    cursorStyles,
  } = state
  return JSON.stringify({
    frameStyles,
    cameraMotions,
    visualEffects,
    compositionLayouts,
    audioClips,
    mouseClickSoundsEnabled,
    mouseClickSoundPath,
    mouseClickSoundName,
    mouseClickSoundVolume,
    aspectRatio,
    zoomRegions,
    cutRegions,
    speedRegions,
    videoClips,
    webcamPosition,
    webcamStyles,
    isWebcamVisible,
    cursorStyles,
  })
}

/** Signature captured at the last save/open; the dirty baseline. */
let cleanSignature = ''

/** Impossible baseline used when a project is adopted as untitled. */
const DIRTY_BASELINE = '\u0000untitled-project'

/** Records the current state as the clean baseline (call after save/open/load). */
export function markProjectClean(state: EditorState): void {
  cleanSignature = projectSignature(state)
}

/**
 * Records an already-captured signature as the clean baseline.
 *
 * A save must mark clean against the signature taken *before* it collected its
 * payload, so edits made while the write was in flight stay dirty.
 */
export function markSignatureClean(signature: string): void {
  cleanSignature = signature
}

/** Sentinel baseline: forces the session to read as dirty (see applyOpenedProject). */
export function markProjectDirtyBaseline(): void {
  cleanSignature = DIRTY_BASELINE
}

/**
 * Captures the project signature for a later `markSignatureClean` call.
 * Exported so the save path (and its tests) use exactly the same signature.
 */
export function captureProjectSignature(state: EditorState): string {
  return projectSignature(state)
}

/** True when the tracked fields differ from the last clean baseline. */
export function projectIsDirty(state: EditorState): boolean {
  if (!state.videoPath) return false
  return projectSignature(state) !== cleanSignature
}

/**
 * Generates automatic zoom regions based on click events from metadata.
 * @param metadata - The array of mouse events.
 * @param videoDimensions - The dimensions of the video.
 * @returns A record of new ZoomRegion objects.
 */
function generateAutoZoomRegions(
  metadata: MetaDataItem[],
  recordingGeometry: RecordingGeometry,
  videoDimensions: VideoDimensions,
): Record<string, ZoomRegion> {
  const clicks = metadata.filter((item) => item.type === 'click' && item.pressed)
  if (clicks.length === 0) return {}

  const mergedClickGroups: MetaDataItem[][] = []
  if (clicks.length > 0) {
    let currentGroup = [clicks[0]]
    for (let i = 1; i < clicks.length; i++) {
      if (clicks[i].timestamp - currentGroup[currentGroup.length - 1].timestamp < ZOOM.AUTO_ZOOM_MIN_DURATION) {
        currentGroup.push(clicks[i])
      } else {
        mergedClickGroups.push(currentGroup)
        currentGroup = [clicks[i]]
      }
    }
    mergedClickGroups.push(currentGroup)
  }

  const geometry = recordingGeometry || videoDimensions

  return mergedClickGroups.reduce(
    (acc, group, index) => {
      const firstClick = group[0]
      const lastClick = group[group.length - 1]

      const startTime = Math.max(0, firstClick.timestamp - ZOOM.AUTO_ZOOM_PRE_CLICK_OFFSET)
      const endTime = lastClick.timestamp + ZOOM.AUTO_ZOOM_POST_CLICK_PADDING
      let duration = endTime - startTime
      if (duration < ZOOM.AUTO_ZOOM_MIN_DURATION) {
        duration = ZOOM.AUTO_ZOOM_MIN_DURATION
      }

      const id = `auto-zoom-${Date.now()}-${index}`
      acc[id] = {
        id,
        type: 'zoom',
        startTime,
        duration,
        zoomLevel: ZOOM.DEFAULT_LEVEL,
        easing: ZOOM.DEFAULT_EASING,
        transitionDuration: ZOOM.SPEED_OPTIONS[ZOOM.DEFAULT_SPEED as keyof typeof ZOOM.SPEED_OPTIONS],
        targetX: firstClick.x / geometry.width - 0.5,
        targetY: firstClick.y / geometry.height - 0.5,
        mode: 'auto',
        zIndex: 0,
      }
      return acc
    },
    {} as Record<string, ZoomRegion>,
  )
}

async function prepareWindowsCursorBitmaps(theme: CursorTheme, scale: number): Promise<Map<string, CursorImageBitmap>> {
  const bitmapMap = new Map<string, CursorImageBitmap>()
  const cursorSet = theme[scale]
  if (!cursorSet) {
    console.warn(`[prepareWindowsCursorBitmaps] No cursor set found for scale ${scale}x`)
    return bitmapMap
  }

  const processingPromises: Promise<void>[] = []

  for (const cursorThemeName in cursorSet) {
    const frames = cursorSet[cursorThemeName]

    processingPromises.push(
      (async () => {
        const idcName = await window.electronAPI.mapCursorNameToIDC(cursorThemeName)
        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i] as CursorFrame // Cast to fix Buffer type issue
          if (frame.rgba && frame.width > 0 && frame.height > 0) {
            try {
              // The data from main process is an object, not a Buffer. Convert it.
              const buffer = new Uint8ClampedArray(Object.values(frame.rgba))
              const imageData = new ImageData(buffer, frame.width, frame.height)
              const bitmap = await createImageBitmap(imageData)
              const key = `${idcName}-${i}`
              bitmapMap.set(key, { ...frame, imageBitmap: bitmap })
            } catch (e) {
              console.error(`Failed to create bitmap for ${idcName}-${i}`, e)
            }
          }
        }
      })(),
    )
  }

  await Promise.all(processingPromises)
  return bitmapMap
}

async function prepareMacOSCursorBitmaps(theme: CursorTheme, scale: number): Promise<Map<string, CursorImageBitmap>> {
  const bitmapMap = new Map<string, CursorImageBitmap>()
  const cursorSet = theme[scale]
  if (!cursorSet) {
    console.warn(`[prepareMacOSCursorBitmaps] No cursor set found for scale ${scale}x`)
    return bitmapMap
  }

  const processingPromises: Promise<void>[] = []

  for (const cursorThemeName in cursorSet) {
    const frames = cursorSet[cursorThemeName]

    processingPromises.push(
      (async () => {
        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i] as CursorFrame
          if (frame.rgba && frame.width > 0 && frame.height > 0) {
            try {
              const buffer = new Uint8ClampedArray(Object.values(frame.rgba))
              const imageData = new ImageData(buffer, frame.width, frame.height)
              const bitmap = await createImageBitmap(imageData)
              // On macOS, the key format is simpler, matching the tracker's output.
              const key = `${cursorThemeName}-${i}`
              bitmapMap.set(key, { ...frame, imageBitmap: bitmap })
            } catch (e) {
              console.error(`Failed to create bitmap for ${cursorThemeName}-${i}`, e)
            }
          }
        }
      })(),
    )
  }

  await Promise.all(processingPromises)
  return bitmapMap
}

export const createProjectSlice: Slice<ProjectState, ProjectActions> = (set, get) => ({
  ...initialProjectState,
  loadProject: async ({ videoPath, metadataPath, webcamVideoPath }) => {
    const videoUrl = `media://${videoPath}`
    const webcamVideoUrl = webcamVideoPath ? `media://${webcamVideoPath}` : null

    get().resetProjectState() // Clear previous project data first

    const activePresetId = get().activePresetId
    const presets = get().presets
    const presetToApply = (activePresetId && presets[activePresetId]) || Object.values(presets).find((p) => p.isDefault)

    set((state) => {
      if (presetToApply) {
        state.frameStyles = JSON.parse(JSON.stringify(presetToApply.styles))
        state.aspectRatio = presetToApply.aspectRatio
      } else {
        state.frameStyles = initialFrameState.frameStyles
      }
      state.videoPath = videoPath
      state.metadataPath = metadataPath
      state.videoUrl = videoUrl
      state.webcamVideoPath = webcamVideoPath || null
      state.webcamVideoUrl = webcamVideoUrl
      state.isWebcamVisible = !!webcamVideoUrl
    })

    try {
      const metadataContent = await window.electronAPI.readFile(metadataPath)
      const parsedData = JSON.parse(metadataContent)

      const processedMetadata = (parsedData.events || []).map((item: MetaDataItem) => ({
        ...item,
        timestamp: item.timestamp / 1000,
      }))

      const newZoomRegions = generateAutoZoomRegions(processedMetadata, parsedData.geometry, get().videoDimensions)

      const platform = parsedData.platform || (await window.electronAPI.getPlatform())
      set((state) => {
        state.platform = platform
        state.metadata = processedMetadata
        // Represent each mouse click as an independent, removable audio clip.
        state.audioClips = state.audioClips.filter((clip) => clip.kind !== 'click')
        processedMetadata
          .filter(
            (item: MetaDataItem) =>
              item.type === 'click' && item.pressed && Number.isFinite(item.timestamp) && item.timestamp >= 0,
          )
          .forEach((item: MetaDataItem, index: number) => {
            state.audioClips.push({
              id: `click-${index}-${Math.round(item.timestamp * 1000)}`,
              kind: 'click',
              name: `Click ${index + 1}`,
              filePath: '',
              startTime: item.timestamp,
              duration: 0.25,
              sourceStart: 0,
              sourceDuration: 0.25,
              volume: 1,
              fadeIn: 0,
              fadeOut: 0,
              loop: false,
              speed: 1,
            })
          })
        state.recordingGeometry = parsedData.geometry || null
        state.screenSize = parsedData.screenSize || null
        state.syncOffset = parsedData.syncOffset || 0
        state.zoomRegions = newZoomRegions
        recalculateCanvasDimensions(state)
      })

      const themeNameToLoad = get().cursorThemeName || 'default'

      if (platform === 'win32') {
        const cursorTheme = await window.electronAPI.loadCursorTheme(themeNameToLoad)
        if (cursorTheme) {
          const scale = (await window.electronAPI.getSetting<number>('recorder.cursorScale')) || 2
          const bitmaps = await prepareWindowsCursorBitmaps(cursorTheme, scale)
          set((state) => {
            state.cursorTheme = cursorTheme
            state.cursorBitmapsToRender = bitmaps
          })
        }
      } else if (platform === 'darwin') {
        const cursorTheme = await window.electronAPI.loadCursorTheme(themeNameToLoad)
        if (cursorTheme) {
          const scale = (await window.electronAPI.getSetting<number>('recorder.cursorScale')) || 2
          const bitmaps = await prepareMacOSCursorBitmaps(cursorTheme, scale)
          set((state) => {
            state.cursorTheme = cursorTheme
            state.cursorBitmapsToRender = bitmaps
          })
        }
      } else {
        // Linux
        const bitmaps = await prepareCursorBitmaps(parsedData.cursorImages)
        set((state) => {
          state.cursorImages = parsedData.cursorImages || {}
          state.cursorBitmapsToRender = bitmaps
        })
      }
    } catch (error) {
      console.error('Failed to process metadata file:', error)
    }

    set((state) => {
      state.isDirty = false
      state.saveStatus = state.currentProjectPath ? 'saved' : 'untitled'
      state.saveError = null
    })
    markProjectClean(get())
  },
  setVideoDimensions: (dims) =>
    set((state) => {
      state.videoDimensions = dims
      if (!state.recordingGeometry) {
        state.recordingGeometry = { x: 0, y: 0, width: dims.width, height: dims.height }
      }
      if (!state.screenSize) {
        state.screenSize = { width: dims.width, height: dims.height }
      }
      recalculateCanvasDimensions(state)
    }),
  setDuration: (duration) =>
    set((state) => {
      state.duration = duration
      Object.values({ ...state.zoomRegions, ...state.cutRegions }).forEach((region) => {
        if (region.startTime + region.duration > duration) {
          region.duration = Math.max(0.1, duration - region.startTime)
        }
      })
    }),
  resetProjectState: () => {
    set((state) => {
      Object.assign(state, initialProjectState)
      state.zoomRegions = {}
      state.cutRegions = {}
      state.selectedRegionId = null
      state.audioClips = []
      state.activeZoomRegionId = null
      state.isCurrentlyCut = false
      state.currentTime = 0
      state.isPlaying = false
    })
  },
  reloadCursorTheme: async (themeName: string) => {
    const { platform } = get()
    if (platform !== 'win32' && platform !== 'darwin') return

    set((state) => {
      state.cursorBitmapsToRender = new Map() // Clear old bitmaps
    })

    const cursorTheme = await window.electronAPI.loadCursorTheme(themeName)
    if (cursorTheme) {
      const scale = (await window.electronAPI.getSetting<number>('recorder.cursorScale')) || 2
      let bitmaps: Map<string, CursorImageBitmap>
      if (platform === 'win32') {
        bitmaps = await prepareWindowsCursorBitmaps(cursorTheme, scale)
      } else {
        bitmaps = await prepareMacOSCursorBitmaps(cursorTheme, scale)
      }
      set((state) => {
        state.cursorTheme = cursorTheme
        state.cursorBitmapsToRender = bitmaps
      })
    }
  },
  setPostProcessingCursorScale: async (scale) => {
    const { platform, cursorTheme } = get()
    if (!cursorTheme || (platform !== 'win32' && platform !== 'darwin')) return

    set((state) => {
      state.cursorBitmapsToRender = new Map()
    })
    window.electronAPI.setSetting('recorder.cursorScale', scale)

    let bitmaps: Map<string, CursorImageBitmap>
    if (platform === 'win32') {
      bitmaps = await prepareWindowsCursorBitmaps(cursorTheme, scale)
    } else {
      // darwin
      bitmaps = await prepareMacOSCursorBitmaps(cursorTheme, scale)
    }

    set((state) => {
      state.cursorBitmapsToRender = bitmaps
    })
  },
  setHasAudioTrack: (hasAudio) => {
    set((state) => {
      state.hasAudioTrack = hasAudio
    })
  },
  applyOpenedProject: async (project, projectPath, options) => {
    const opened = project as unknown as Partial<EditorState>
    const videoPath = typeof opened.videoPath === 'string' ? opened.videoPath : null
    const metadataPath = typeof opened.metadataPath === 'string' ? opened.metadataPath : null
    if (!videoPath || !metadataPath) {
      console.error('[ProjectSlice] Opened project is missing its media paths.')
      return
    }

    // Rebuild the derived state (geometry, cursors, platform, auto zoom) first…
    await get().loadProject({ videoPath, metadataPath, webcamVideoPath: opened.webcamVideoPath ?? undefined })

    // …then overlay the saved edits so they win over the auto-generated ones.
    set((state) => {
      if (opened.frameStyles) state.frameStyles = opened.frameStyles
      if (opened.aspectRatio) state.aspectRatio = opened.aspectRatio
      if (opened.cameraMotions) state.cameraMotions = opened.cameraMotions
      if (opened.visualEffects) state.visualEffects = opened.visualEffects
      if (opened.compositionLayouts) state.compositionLayouts = opened.compositionLayouts
      if (opened.audioClips) state.audioClips = opened.audioClips
      if (opened.mouseClickSoundsEnabled !== undefined) state.mouseClickSoundsEnabled = opened.mouseClickSoundsEnabled
      if (opened.mouseClickSoundPath !== undefined) state.mouseClickSoundPath = opened.mouseClickSoundPath
      if (opened.mouseClickSoundName !== undefined) state.mouseClickSoundName = opened.mouseClickSoundName
      if (opened.mouseClickSoundVolume !== undefined) state.mouseClickSoundVolume = opened.mouseClickSoundVolume
      if (opened.hasAudioTrack !== undefined) state.hasAudioTrack = opened.hasAudioTrack
      if (opened.volume !== undefined) state.volume = opened.volume
      if (opened.isMuted !== undefined) state.isMuted = opened.isMuted
      if (opened.zoomRegions) state.zoomRegions = opened.zoomRegions
      if (opened.cutRegions) state.cutRegions = opened.cutRegions
      if (opened.speedRegions) state.speedRegions = opened.speedRegions
      if (opened.videoClips) state.videoClips = opened.videoClips
      if (opened.webcamPosition) state.webcamPosition = opened.webcamPosition
      if (opened.webcamStyles) state.webcamStyles = opened.webcamStyles
      if (opened.isWebcamVisible !== undefined) state.isWebcamVisible = opened.isWebcamVisible
      if (opened.cursorStyles) state.cursorStyles = opened.cursorStyles
      if (opened.activePresetId !== undefined) state.activePresetId = opened.activePresetId

      state.currentProjectPath = options?.asUntitled ? null : projectPath || null
      state.isDirty = false
      state.saveStatus = options?.asUntitled || !projectPath ? 'untitled' : 'saved'
      state.saveError = null
    })

    if (options?.asUntitled) {
      // A recovered project has never been saved to a file. Keep it dirty so the
      // first save asks for a location, and never let the recovery copy become
      // currentProjectPath - autosave would overwrite it.
      markProjectDirtyBaseline()
    } else {
      markProjectClean(get())
    }
  },
  saveProject: async (options) => {
    const current = get()
    if (!current.videoPath) return { canceled: true }

    const previousStatus = current.saveStatus
    // Capture the dirty baseline BEFORE the payload is collected. A save takes
    // time, and anything the user changes meanwhile must stay dirty so the next
    // tick still sees work to do.
    const signatureAtStart = captureProjectSignature(current)

    const setStatus = (status: SaveStatus, error: string | null = null) =>
      set((state) => {
        state.saveStatus = status
        state.saveError = error
      })

    return withSaveGuard(
      async () => {
        setStatus('saving')

        try {
          const payload = await collectSavePayload(get())
          const result = options?.saveAs
            ? await window.electronAPI.saveProjectAs(payload)
            : await window.electronAPI.saveProject({
                project: payload,
                path: current.currentProjectPath,
                auto: options?.auto,
              })

          if (result.canceled) {
            // Nothing was written (the user dismissed the save dialog).
            setStatus(previousStatus)
            return result
          }

          if (result.recovery) {
            // Only the crash-recovery copy was written: the project is still
            // unsaved, so leave currentProjectPath and the dirty flag alone.
            console.info('[ProjectSlice] Auto-saved a recovery copy to', result.path)
            set((state) => {
              state.lastRecoveryAt = Date.now()
              state.saveStatus = 'untitled'
              state.saveError = null
            })
            return result
          }

          set((state) => {
            state.currentProjectPath = result.path ?? state.currentProjectPath
            state.lastSavedAt = Date.now()
            state.saveStatus = 'saved'
            state.saveError = null
          })

          // Mark clean against the signature captured before the write, then
          // recompute against the live state: edits made while the save was in
          // flight must remain dirty.
          markSignatureClean(signatureAtStart)
          const stillDirty = captureProjectSignature(get()) !== signatureAtStart
          set((state) => {
            state.isDirty = stillDirty
          })
          return result
        } catch (error) {
          console.error('[ProjectSlice] Failed to save the project:', error)
          setStatus('error', (error as Error)?.message ?? 'The save failed.')
          throw error
        }
      },
      { canceled: true },
    )
  },
})
