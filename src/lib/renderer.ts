import { EditorState, RenderableState, VideoClip, WebcamPosition } from '../types'
import { calculateZoomTransform, findLastMetadataIndex } from './transform'
import { EASING_MAP } from './easing'
import { DEFAULTS } from './constants'
import { isTiltActive } from './perspective'
import { drawTiltedLayer } from './tilt-renderer'
import { getCameraPoseAtTime } from './camera-motion'

type Rect = { x: number; y: number; width: number; height: number }

const ADJACENT_POSITIONS: Record<WebcamPosition['pos'], [WebcamPosition['pos'], WebcamPosition['pos']]> = {
  'top-left': ['top-center', 'left-center'],
  'top-center': ['top-left', 'top-right'],
  'top-right': ['top-center', 'right-center'],
  'right-center': ['top-right', 'bottom-right'],
  'bottom-right': ['right-center', 'bottom-center'],
  'bottom-center': ['bottom-right', 'bottom-left'],
  'bottom-left': ['bottom-center', 'left-center'],
  'left-center': ['bottom-left', 'top-left'],
}

function getWebcamRectForPosition(
  pos: WebcamPosition['pos'],
  width: number,
  height: number,
  outputWidth: number,
  outputHeight: number,
): Rect {
  const baseSize = Math.min(outputWidth, outputHeight)
  const edgePadding = baseSize * 0.02

  switch (pos) {
    case 'top-left':
      return { x: edgePadding, y: edgePadding, width, height }
    case 'top-center':
      return { x: (outputWidth - width) / 2, y: edgePadding, width, height }
    case 'top-right':
      return { x: outputWidth - width - edgePadding, y: edgePadding, width, height }
    case 'left-center':
      return { x: edgePadding, y: (outputHeight - height) / 2, width, height }
    case 'right-center':
      return { x: outputWidth - width - edgePadding, y: (outputHeight - height) / 2, width, height }
    case 'bottom-left':
      return { x: edgePadding, y: outputHeight - height - edgePadding, width, height }
    case 'bottom-center':
      return { x: (outputWidth - width) / 2, y: outputHeight - height - edgePadding, width, height }
    default:
      return { x: outputWidth - width - edgePadding, y: outputHeight - height - edgePadding, width, height }
  }
}

function isPointInRect(point: { x: number; y: number }, rect: Rect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
}

function lerp(start: number, end: number, t: number): number {
  return start * (1 - t) + end * t
}

/**
 * Draws the background with optimized rendering
 */
const drawBackground = async (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  backgroundState: EditorState['frameStyles']['background'],
  preloadedImage: HTMLImageElement | null,
): Promise<void> => {
  ctx.clearRect(0, 0, width, height)

  switch (backgroundState.type) {
    case 'color':
      ctx.fillStyle = backgroundState.color || '#000000'
      ctx.fillRect(0, 0, width, height)
      break
    case 'gradient': {
      const start = backgroundState.gradientStart || '#000000'
      const end = backgroundState.gradientEnd || '#ffffff'
      const direction = backgroundState.gradientDirection || 'to right'
      let gradient

      if (direction.startsWith('circle')) {
        gradient = ctx.createRadialGradient(
          width / 2,
          height / 2,
          0,
          width / 2,
          height / 2,
          Math.max(width, height) / 2,
        )
        if (direction === 'circle-in') {
          gradient.addColorStop(0, end)
          gradient.addColorStop(1, start)
        } else {
          gradient.addColorStop(0, start)
          gradient.addColorStop(1, end)
        }
      } else {
        const getCoords = (dir: string) => {
          switch (dir) {
            case 'to bottom':
              return [0, 0, 0, height]
            case 'to top':
              return [0, height, 0, 0]
            case 'to right':
              return [0, 0, width, 0]
            case 'to left':
              return [width, 0, 0, 0]
            case 'to bottom right':
              return [0, 0, width, height]
            case 'to bottom left':
              return [width, 0, 0, height]
            case 'to top right':
              return [0, height, width, 0]
            case 'to top left':
              return [width, height, 0, 0]
            default:
              return [0, 0, width, 0]
          }
        }
        const coords = getCoords(direction)
        gradient = ctx.createLinearGradient(coords[0], coords[1], coords[2], coords[3])
        gradient.addColorStop(0, start)
        gradient.addColorStop(1, end)
      }

      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)
      break
    }
    case 'image':
    case 'wallpaper': {
      if (preloadedImage && preloadedImage.complete) {
        const img = preloadedImage
        const imgRatio = img.width / img.height
        const canvasRatio = width / height
        let sx, sy, sWidth, sHeight

        if (imgRatio > canvasRatio) {
          sHeight = img.height
          sWidth = sHeight * canvasRatio
          sx = (img.width - sWidth) / 2
          sy = 0
        } else {
          sWidth = img.width
          sHeight = sWidth / canvasRatio
          sx = 0
          sy = (img.height - sHeight) / 2
        }
        ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, width, height)
      } else {
        ctx.fillStyle = 'oklch(0.2077 0.0398 265.7549)'
        ctx.fillRect(0, 0, width, height)
      }
      break
    }
    default:
      ctx.fillStyle = 'oklch(0.2077 0.0398 265.7549)'
      ctx.fillRect(0, 0, width, height)
  }
}

/**
 * Draws the video frame (shadow, border, zoom/pan transform), click ripples and the cursor.
 * Everything here is drawn flat in output-canvas coordinates; perspective tilt is applied by the caller.
 */
const drawFrameLayer = (
  ctx: CanvasRenderingContext2D,
  state: RenderableState,
  videoElement: HTMLVideoElement,
  currentTime: number,
  frameX: number,
  frameY: number,
  frameContentWidth: number,
  frameContentHeight: number,
): void => {
  const { frameStyles } = state

  ctx.save()

  const { scale, translateX, translateY, transformOrigin } = calculateZoomTransform(
    currentTime,
    state.zoomRegions,
    state.metadata,
    state.recordingGeometry || state.videoDimensions,
    { width: frameContentWidth, height: frameContentHeight },
  )

  const [originXStr, originYStr] = transformOrigin.split(' ')
  const originXMul = parseFloat(originXStr) / 100
  const originYMul = parseFloat(originYStr) / 100
  const originPxX = originXMul * frameContentWidth
  const originPxY = originYMul * frameContentHeight

  ctx.translate(frameX, frameY)
  ctx.translate(originPxX, originPxY)
  ctx.scale(scale, scale)
  ctx.translate(translateX, translateY)
  ctx.translate(-originPxX, -originPxY)

  const { shadowBlur, shadowOffsetX, shadowOffsetY, borderRadius, shadowColor, borderWidth, borderColor } = frameStyles

  // Draw shadow if needed
  if (shadowBlur > 0) {
    ctx.save()
    ctx.shadowColor = shadowColor
    ctx.shadowBlur = shadowBlur
    ctx.shadowOffsetX = shadowOffsetX
    ctx.shadowOffsetY = shadowOffsetY
    const shadowPath = new Path2D()
    shadowPath.roundRect(0, 0, frameContentWidth, frameContentHeight, borderRadius)
    ctx.fillStyle = 'rgba(0,0,0,1)'
    ctx.fill(shadowPath)
    ctx.restore()
  }

  // Draw the video and border
  ctx.save()
  const path = new Path2D()
  path.roundRect(0, 0, frameContentWidth, frameContentHeight, borderRadius)
  ctx.clip(path)
  ctx.drawImage(videoElement, 0, 0, frameContentWidth, frameContentHeight)

  // Draw border on top of the video content
  if (borderWidth > 0) {
    ctx.strokeStyle = borderColor
    ctx.lineWidth = borderWidth * 2
    ctx.stroke(path)
  }
  ctx.restore()

  // --- 4. Draw Click Animations ---
  if (state.cursorStyles.clickRippleEffect && state.recordingGeometry) {
    const { clickRippleDuration, clickRippleSize, clickRippleColor } = state.cursorStyles
    const rippleEasing = EASING_MAP.Balanced // Ripple uses a standard ease-out

    const recentRippleClicks = state.metadata.filter(
      (event) =>
        event.type === 'click' &&
        event.pressed &&
        currentTime >= event.timestamp &&
        currentTime < event.timestamp + clickRippleDuration,
    )

    for (const click of recentRippleClicks) {
      const progress = (currentTime - click.timestamp) / clickRippleDuration
      const easedProgress = rippleEasing(progress)
      const currentRadius = easedProgress * clickRippleSize
      const currentOpacity = 1 - easedProgress

      // Scale cursor position from original recording geometry to the current frame's content size
      const cursorX = (click.x / state.recordingGeometry.width) * frameContentWidth
      const cursorY = (click.y / state.recordingGeometry.height) * frameContentHeight

      const colorResult = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(clickRippleColor)
      if (colorResult) {
        const [r, g, b, baseAlpha] = colorResult.slice(1).map(Number)
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${baseAlpha * currentOpacity})`
      }

      ctx.beginPath()
      ctx.arc(cursorX, cursorY, currentRadius, 0, 2 * Math.PI)
      ctx.fill()
    }
  }

  // --- 5. Draw Cursor ---
  const lastEventIndex = findLastMetadataIndex(state.metadata, currentTime)

  if (state.cursorStyles.showCursor && lastEventIndex > -1 && state.recordingGeometry) {
    const event = state.metadata[lastEventIndex]
    if (event && currentTime - event.timestamp < 0.1) {
      const cursorData = state.cursorBitmapsToRender.get(event.cursorImageKey!)

      if (cursorData && cursorData.imageBitmap && cursorData.width > 0) {
        const cursorX = (event.x / state.recordingGeometry.width) * frameContentWidth
        const cursorY = (event.y / state.recordingGeometry.height) * frameContentHeight
        const drawX = Math.round(cursorX - cursorData.xhot)
        const drawY = Math.round(cursorY - cursorData.yhot)

        ctx.save()

        // Handle click scale animation
        let cursorScale = 1
        if (state.cursorStyles.clickScaleEffect) {
          const { clickScaleDuration, clickScaleAmount, clickScaleEasing } = state.cursorStyles
          const mostRecentClick = state.metadata
            .filter(
              (e) =>
                e.type === 'click' &&
                e.pressed &&
                e.timestamp <= currentTime &&
                e.timestamp > currentTime - clickScaleDuration,
            )
            .pop()

          if (mostRecentClick) {
            const progress = (currentTime - mostRecentClick.timestamp) / clickScaleDuration
            const easingFn = EASING_MAP[clickScaleEasing as keyof typeof EASING_MAP] || EASING_MAP.Balanced
            const easedProgress = easingFn(progress)
            const scaleValue = 1 - (1 - clickScaleAmount) * Math.sin(easedProgress * Math.PI)
            cursorScale = scaleValue
          }
        }

        // Apply drop shadow
        const { shadowBlur, shadowOffsetX, shadowOffsetY, shadowColor } = state.cursorStyles
        if (shadowBlur > 0 || shadowOffsetX !== 0 || shadowOffsetY !== 0) {
          ctx.filter = `drop-shadow(${shadowOffsetX}px ${shadowOffsetY}px ${shadowBlur}px ${shadowColor})`
        }

        // Apply scale transform if needed
        if (cursorScale !== 1) {
          const scaleCenterX = drawX + cursorData.xhot
          const scaleCenterY = drawY + cursorData.yhot
          ctx.translate(scaleCenterX, scaleCenterY)
          ctx.scale(cursorScale, cursorScale)
          ctx.translate(-scaleCenterX, -scaleCenterY)
        }

        ctx.drawImage(cursorData.imageBitmap, drawX, drawY)
        ctx.restore()
      }
    }
  }

  ctx.restore() // Restore from video's transform
}

/** An imported video clip paired with the hidden <video> element that feeds it. */
export interface VideoClipLayer {
  clip: VideoClip
  element: HTMLVideoElement
}

/**
 * Maps a timeline time to a clip's source time, honouring its left-trim offset.
 * Past the end of the source the last frame is held, so a clip can be dragged
 * longer than the media it plays.
 */
export const getClipSourceTime = (
  clip: VideoClip,
  timelineTime: number,
  sourceDuration: number = clip.sourceDuration,
): number => {
  const raw = clip.sourceStart + (timelineTime - clip.startTime)
  const lastFrame = Math.max(0, sourceDuration - 0.05)
  return Math.max(0, Math.min(lastFrame, raw))
}

/**
 * Draws one imported video clip as a full-frame layer, reusing the frame
 * treatment (padding, rounded corners, border, shadow) of the screen
 * recording. Layers are drawn flat: zoom regions and the 3D camera are
 * applied to the screen recording only.
 */
const drawClipLayer = (
  ctx: CanvasRenderingContext2D,
  layer: VideoClipLayer,
  currentTime: number,
  frameX: number,
  frameY: number,
  frameContentWidth: number,
  frameContentHeight: number,
  frameStyles: EditorState['frameStyles'],
): void => {
  const { clip, element } = layer
  if (currentTime < clip.startTime || currentTime >= clip.startTime + clip.duration) return
  if (!element.videoWidth || !element.videoHeight) return

  const { shadowBlur, shadowOffsetX, shadowOffsetY, borderRadius, shadowColor, borderWidth, borderColor } = frameStyles

  ctx.save()
  ctx.translate(frameX, frameY)

  if (shadowBlur > 0) {
    ctx.save()
    ctx.shadowColor = shadowColor
    ctx.shadowBlur = shadowBlur
    ctx.shadowOffsetX = shadowOffsetX
    ctx.shadowOffsetY = shadowOffsetY
    const shadowPath = new Path2D()
    shadowPath.roundRect(0, 0, frameContentWidth, frameContentHeight, borderRadius)
    ctx.fillStyle = 'rgba(0,0,0,1)'
    ctx.fill(shadowPath)
    ctx.restore()
  }

  ctx.save()
  const path = new Path2D()
  path.roundRect(0, 0, frameContentWidth, frameContentHeight, borderRadius)
  ctx.clip(path)

  // Cover-crop so a clip with a different aspect ratio fills the frame
  // instead of being stretched.
  const sourceAspect = element.videoWidth / element.videoHeight
  const targetAspect = frameContentWidth / frameContentHeight
  let cropX = 0
  let cropY = 0
  let cropWidth = element.videoWidth
  let cropHeight = element.videoHeight
  if (sourceAspect > targetAspect) {
    cropWidth = element.videoHeight * targetAspect
    cropX = (element.videoWidth - cropWidth) / 2
  } else {
    cropHeight = element.videoWidth / targetAspect
    cropY = (element.videoHeight - cropHeight) / 2
  }
  ctx.drawImage(element, cropX, cropY, cropWidth, cropHeight, 0, 0, frameContentWidth, frameContentHeight)

  if (borderWidth > 0) {
    ctx.strokeStyle = borderColor
    ctx.lineWidth = borderWidth * 2
    ctx.stroke(path)
  }
  ctx.restore()

  ctx.restore()
}

/**
 * Main rendering function with enhanced visuals
 */
export const drawScene = async (
  ctx: CanvasRenderingContext2D,
  state: RenderableState,
  videoElement: HTMLVideoElement,
  webcamVideoElement: HTMLVideoElement | null,
  currentTime: number,
  outputWidth: number,
  outputHeight: number,
  preloadedBgImage: HTMLImageElement | null,
  videoClipLayers: VideoClipLayer[] = [],
): Promise<void> => {
  if (!state.videoDimensions.width || !state.videoDimensions.height) return

  // Enable high-quality rendering
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // --- 1. Draw Background ---
  await drawBackground(ctx, outputWidth, outputHeight, state.frameStyles.background, preloadedBgImage)

  // --- 2. Calculate Frame and Content Dimensions ---
  const camera = getCameraPoseAtTime(state.cameraMotions, currentTime) ?? { x: 0, y: 0, scale: 1, rotationX: 0, rotationY: 0, rotationZ: 0, perspective: 50 }
  const frameStyles = { ...state.frameStyles, tiltX: camera.rotationX, tiltY: camera.rotationY, perspective: camera.perspective }
  const { videoDimensions } = state
  const paddingPercent = frameStyles.padding / 100
  const availableWidth = outputWidth * (1 - 2 * paddingPercent)
  const availableHeight = outputHeight * (1 - 2 * paddingPercent)
  const videoAspectRatio = videoDimensions.width / videoDimensions.height

  let frameContentWidth, frameContentHeight
  if (availableWidth / availableHeight > videoAspectRatio) {
    frameContentHeight = availableHeight
    frameContentWidth = frameContentHeight * videoAspectRatio
  } else {
    frameContentWidth = availableWidth
    frameContentHeight = frameContentWidth / videoAspectRatio
  }

  frameContentWidth *= camera.scale
  frameContentHeight *= camera.scale
  const frameX = (outputWidth - frameContentWidth) / 2 + (camera.x / 100) * outputWidth
  const frameY = (outputHeight - frameContentHeight) / 2 + (camera.y / 100) * outputHeight

  // --- 3-5. Draw the video frame, click effects and cursor ---
  const drawFrame = (target: CanvasRenderingContext2D) => {
    if (Math.abs(camera.rotationZ) > 0.001) {
      target.save()
      target.translate(outputWidth / 2, outputHeight / 2)
      target.rotate((camera.rotationZ * Math.PI) / 180)
      target.translate(-outputWidth / 2, -outputHeight / 2)
    }
    drawFrameLayer(target, state, videoElement, currentTime, frameX, frameY, frameContentWidth, frameContentHeight)
    if (Math.abs(camera.rotationZ) > 0.001) target.restore()
  }

  if (isTiltActive(frameStyles) || Math.abs(camera.rotationZ) > 0.001 || Math.abs(camera.x) > 0.001 || Math.abs(camera.y) > 0.001 || Math.abs(camera.scale - 1) > 0.001) {
    // Render the frame flat into an offscreen layer, then project it with perspective.
    drawTiltedLayer(ctx, drawFrame, frameStyles, outputWidth, outputHeight)
  } else {
    drawFrame(ctx)
  }

  // --- 5b. Draw imported video layers, bottom-most first ---
  const orderedClipLayers = [...videoClipLayers].sort((a, b) => (a.clip.order ?? 0) - (b.clip.order ?? 0))
  for (const layer of orderedClipLayers) {
    drawClipLayer(ctx, layer, currentTime, frameX, frameY, frameContentWidth, frameContentHeight, state.frameStyles)
  }

  // --- 6. Draw Webcam ---
  const { webcamPosition, webcamStyles, isWebcamVisible } = state
  const activeLayoutRange = (state.compositionLayouts || []).filter((range) => currentTime >= range.startTime && currentTime < range.startTime + range.duration).sort((a, b) => b.startTime - a.startTime)[0]
  if (isWebcamVisible && webcamVideoElement && webcamVideoElement.videoWidth > 0 && state.recordingGeometry) {
    let finalWebcamScale = 1
    if (webcamStyles.scaleOnZoom) {
      const activeZoomRegion = Object.values(state.zoomRegions).find(
        (r) => currentTime >= r.startTime && currentTime < r.startTime + r.duration,
      )
      if (activeZoomRegion) {
        const { startTime, duration, transitionDuration } = activeZoomRegion
        const zoomInEndTime = startTime + transitionDuration
        const zoomOutStartTime = startTime + duration - transitionDuration
        const easingFn = EASING_MAP[activeZoomRegion.easing as keyof typeof EASING_MAP] || EASING_MAP.Balanced

        if (currentTime < zoomInEndTime) {
          const progress = (currentTime - startTime) / transitionDuration
          finalWebcamScale = lerp(1, DEFAULTS.CAMERA.SCALE_ON_ZOOM_AMOUNT, easingFn(progress))
        } else if (currentTime >= zoomOutStartTime) {
          const progress = (currentTime - zoomOutStartTime) / transitionDuration
          finalWebcamScale = lerp(DEFAULTS.CAMERA.SCALE_ON_ZOOM_AMOUNT, 1, easingFn(progress))
        } else {
          finalWebcamScale = DEFAULTS.CAMERA.SCALE_ON_ZOOM_AMOUNT
        }
      }
    }

    const baseSize = Math.min(outputWidth, outputHeight)
    let initialWebcamWidth, initialWebcamHeight
    if (webcamStyles.shape === 'rectangle') {
      initialWebcamWidth = baseSize * (webcamStyles.size / 100)
      initialWebcamHeight = initialWebcamWidth * (9 / 16)
    } else {
      initialWebcamWidth = baseSize * (webcamStyles.size / 100)
      initialWebcamHeight = initialWebcamWidth
    }

    const originalPos = webcamPosition.pos
    let currentPos = originalPos
    let previousPos = originalPos
    let timeOfChange = 0

    if (webcamStyles.smartPosition) {
      const getTargetPosAtTime = (time: number): WebcamPosition['pos'] => {
        const originalRect = getWebcamRectForPosition(
          originalPos,
          initialWebcamWidth,
          initialWebcamHeight,
          outputWidth,
          outputHeight,
        )
        const futureCursorIndex = findLastMetadataIndex(
          state.metadata,
          time + DEFAULTS.CAMERA.SMART_POSITION.LOOKAHEAD_TIME,
        )
        if (futureCursorIndex > -1) {
          const futureCursorEvent = state.metadata[futureCursorIndex]
          const cursorCanvasX = (futureCursorEvent.x / state.recordingGeometry!.width) * frameContentWidth + frameX
          const cursorCanvasY = (futureCursorEvent.y / state.recordingGeometry!.height) * frameContentHeight + frameY
          if (isPointInRect({ x: cursorCanvasX, y: cursorCanvasY }, originalRect)) {
            const [adj1, adj2] = ADJACENT_POSITIONS[originalPos]
            const adj1Rect = getWebcamRectForPosition(
              adj1,
              initialWebcamWidth,
              initialWebcamHeight,
              outputWidth,
              outputHeight,
            )
            return !isPointInRect({ x: cursorCanvasX, y: cursorCanvasY }, adj1Rect) ? adj1 : adj2
          }
        }
        return originalPos
      }

      currentPos = getTargetPosAtTime(currentTime)
      const checkInterval = 0.05

      for (let t = currentTime; t >= 0; t -= checkInterval) {
        const posAtT = getTargetPosAtTime(t)
        if (posAtT !== currentPos) {
          previousPos = posAtT
          timeOfChange = t + checkInterval
          break
        }
        if (t === 0) {
          previousPos = currentPos
          timeOfChange = 0
        }
      }
    }

    const transitionDuration = DEFAULTS.CAMERA.SMART_POSITION.TRANSITION_DURATION
    let progress = 1
    if (previousPos !== currentPos && currentTime - timeOfChange < transitionDuration) {
      progress = (currentTime - timeOfChange) / transitionDuration
    }

    const easingFn = EASING_MAP[DEFAULTS.CAMERA.SMART_POSITION.EASING as keyof typeof EASING_MAP] || EASING_MAP.Balanced
    const easedProgress = easingFn(Math.min(1, progress))

    const startRect = getWebcamRectForPosition(
      previousPos,
      initialWebcamWidth,
      initialWebcamHeight,
      outputWidth,
      outputHeight,
    )
    const targetRect = getWebcamRectForPosition(
      currentPos,
      initialWebcamWidth,
      initialWebcamHeight,
      outputWidth,
      outputHeight,
    )

    const baseWebcamX = lerp(startRect.x, targetRect.x, easedProgress)
    const baseWebcamY = lerp(startRect.y, targetRect.y, easedProgress)

    const webcamWidth = initialWebcamWidth * finalWebcamScale
    const webcamHeight = initialWebcamHeight * finalWebcamScale

    let webcamX = baseWebcamX
    let webcamY = baseWebcamY

    if (originalPos.includes('right')) {
      webcamX += initialWebcamWidth - webcamWidth
    } else if (originalPos === 'top-center' || originalPos === 'bottom-center') {
      webcamX += (initialWebcamWidth - webcamWidth) / 2
    }

    if (originalPos.includes('bottom')) {
      webcamY += initialWebcamHeight - webcamHeight
    } else if (originalPos === 'left-center' || originalPos === 'right-center') {
      webcamY += (initialWebcamHeight - webcamHeight) / 2
    }

    const maxRadius = Math.min(webcamWidth, webcamHeight) / 2
    let webcamRadius = 0

    if (webcamStyles.shape === 'circle') {
      webcamRadius = maxRadius
    } else {
      webcamRadius = maxRadius * (webcamStyles.borderRadius / 50)
    }

    const webcamVideo = webcamVideoElement
    const screenSnapshot = document.createElement('canvas')
    screenSnapshot.width = outputWidth
    screenSnapshot.height = outputHeight
    screenSnapshot.getContext('2d')?.drawImage(ctx.canvas, 0, 0)

    const baseRect: Rect = { x: webcamX, y: webcamY, width: webcamWidth, height: webcamHeight }
    const fullRect: Rect = { x: 0, y: 0, width: outputWidth, height: outputHeight }
    const rectLerp = (from: Rect, to: Rect, progress: number): Rect => ({
      x: lerp(from.x, to.x, progress),
      y: lerp(from.y, to.y, progress),
      width: lerp(from.width, to.width, progress),
      height: lerp(from.height, to.height, progress),
    })
    const drawPresenter = (rect: Rect, radius: number, alpha = 1) => {
      if (rect.width <= 0 || rect.height <= 0 || alpha <= 0) return
      ctx.save()
      ctx.globalAlpha = alpha
      if (webcamStyles.shadowBlur > 0 || webcamStyles.shadowOffsetX !== 0 || webcamStyles.shadowOffsetY !== 0) {
        ctx.save()
        ctx.shadowColor = webcamStyles.shadowColor
        ctx.shadowBlur = webcamStyles.shadowBlur
        ctx.shadowOffsetX = webcamStyles.shadowOffsetX
        ctx.shadowOffsetY = webcamStyles.shadowOffsetY
        const shadowPath = new Path2D()
        shadowPath.roundRect(rect.x, rect.y, rect.width, rect.height, Math.max(0, radius))
        ctx.fillStyle = 'rgba(0,0,0,1)'
        ctx.fill(shadowPath)
        ctx.restore()
      }
      if (webcamStyles.isFlipped) { ctx.translate(outputWidth, 0); ctx.scale(-1, 1) }
      const drawX = webcamStyles.isFlipped ? outputWidth - rect.x - rect.width : rect.x
      ctx.beginPath()
      if (radius > 0) ctx.roundRect(drawX, rect.y, rect.width, rect.height, Math.min(radius, rect.width / 2, rect.height / 2))
      else ctx.rect(drawX, rect.y, rect.width, rect.height)
      ctx.clip()
      const sourceAspect = webcamVideo.videoWidth / webcamVideo.videoHeight
      const targetAspect = rect.width / rect.height
      let cropX = 0, cropY = 0, cropWidth = webcamVideo.videoWidth, cropHeight = webcamVideo.videoHeight
      if (sourceAspect > targetAspect) { cropWidth = webcamVideo.videoHeight * targetAspect; cropX = (webcamVideo.videoWidth - cropWidth) / 2 }
      else { cropHeight = webcamVideo.videoWidth / targetAspect; cropY = (webcamVideo.videoHeight - cropHeight) / 2 }
      ctx.drawImage(webcamVideo, cropX, cropY, cropWidth, cropHeight, drawX, rect.y, rect.width, rect.height)
      ctx.restore()
    }
    const drawScreenInRect = (rect: Rect, alpha: number) => {
      if (rect.width <= 0 || rect.height <= 0 || alpha <= 0) return
      // Cover the pane while preserving aspect ratio, like the supplied reference video.
      const scale = Math.max(rect.width / outputWidth, rect.height / outputHeight)
      const drawWidth = outputWidth * scale
      const drawHeight = outputHeight * scale
      const drawX = rect.x + (rect.width - drawWidth) / 2
      const drawY = rect.y + (rect.height - drawHeight) / 2
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.beginPath()
      ctx.rect(rect.x, rect.y, rect.width, rect.height)
      ctx.clip()
      ctx.drawImage(screenSnapshot, drawX, drawY, drawWidth, drawHeight)
      ctx.restore()
    }
    const drawBaseBackground = async () => {
      await drawBackground(ctx, outputWidth, outputHeight, state.frameStyles.background, preloadedBgImage)
    }

    const largeWidth = Math.min(outputWidth * 0.48, initialWebcamWidth * Math.max(1, finalWebcamScale) * 1.55)
    const largeHeight = largeWidth * (webcamStyles.shape === 'rectangle' ? 9 / 16 : 1)
    let largeX = baseRect.x
    let largeY = baseRect.y
    if (originalPos.includes('right')) largeX += baseRect.width - largeWidth
    else if (originalPos === 'top-center' || originalPos === 'bottom-center') largeX += (baseRect.width - largeWidth) / 2
    if (originalPos.includes('bottom')) largeY += baseRect.height - largeHeight
    else if (originalPos === 'left-center' || originalPos === 'right-center') largeY += (baseRect.height - largeHeight) / 2
    const largeRect: Rect = { x: largeX, y: largeY, width: largeWidth, height: largeHeight }
    const largeRadius = webcamStyles.shape === 'circle'
      ? Math.min(largeWidth, largeHeight) / 2
      : Math.min(largeWidth, largeHeight) * (webcamStyles.borderRadius / 50)

    type CompositionState = { screenRect: Rect; screenAlpha: number; presenterRect: Rect; presenterAlpha: number; presenterRadius: number }
    const getCompositionState = (layout: string): CompositionState => {
      const composition: CompositionState = { screenRect: fullRect, screenAlpha: 1, presenterRect: baseRect, presenterAlpha: 1, presenterRadius: webcamRadius }
      switch (layout) {
        case 'large-picture-in-picture':
          composition.presenterRect = largeRect
          composition.presenterRadius = largeRadius
          break
        case 'side-by-side':
          composition.screenRect = { x: 0, y: 0, width: outputWidth / 2, height: outputHeight }
          composition.presenterRect = { x: outputWidth / 2, y: 0, width: outputWidth / 2, height: outputHeight }
          composition.presenterRadius = 0
          break
        case 'split-vertical':
          composition.screenRect = { x: outputWidth / 2, y: 0, width: outputWidth / 2, height: outputHeight }
          composition.presenterRect = { x: 0, y: 0, width: outputWidth / 2, height: outputHeight }
          composition.presenterRadius = 0
          break
        case 'presenter-top':
          composition.screenRect = { x: 0, y: outputHeight / 2, width: outputWidth, height: outputHeight / 2 }
          composition.presenterRect = { x: 0, y: 0, width: outputWidth, height: outputHeight / 2 }
          composition.presenterRadius = 0
          break
        case 'presenter-bottom':
          composition.screenRect = { x: 0, y: 0, width: outputWidth, height: outputHeight / 2 }
          composition.presenterRect = { x: 0, y: outputHeight / 2, width: outputWidth, height: outputHeight / 2 }
          composition.presenterRadius = 0
          break
        case 'presenter-focus':
          composition.screenAlpha = 0
          composition.presenterRect = fullRect
          composition.presenterRadius = 0
          break
        case 'screen-only':
          composition.presenterAlpha = 0
          break
      }
      return composition
    }

    const ranges = [...(state.compositionLayouts || [])].sort((a, b) => a.startTime - b.startTime)
    const activeRange = activeLayoutRange
    let fromLayout = 'picture-in-picture'
    let toLayout = activeRange?.layout || 'picture-in-picture'
    let layoutProgress = activeRange ? 1 : 0
    if (activeRange) {
      const activeIndex = ranges.findIndex((range) => range.id === activeRange.id)
      const previousRange = activeIndex > 0 ? ranges[activeIndex - 1] : undefined
      const nextRange = activeIndex >= 0 ? ranges[activeIndex + 1] : undefined
      const startsAfterPrevious = !!previousRange && Math.abs(previousRange.startTime + previousRange.duration - activeRange.startTime) < 0.03
      const endsBeforeNext = !!nextRange && Math.abs(activeRange.startTime + activeRange.duration - nextRange.startTime) < 0.03
      const fadeDuration = Math.min(Math.max(0, activeRange.transitionDuration || 0), activeRange.duration / 2)
      if (fadeDuration > 0 && currentTime < activeRange.startTime + fadeDuration) {
        fromLayout = startsAfterPrevious ? previousRange!.layout : 'picture-in-picture'
        layoutProgress = Math.max(0, Math.min(1, (currentTime - activeRange.startTime) / fadeDuration))
      } else if (fadeDuration > 0 && !endsBeforeNext && currentTime >= activeRange.startTime + activeRange.duration - fadeDuration) {
        fromLayout = 'picture-in-picture'
        toLayout = activeRange.layout
        layoutProgress = Math.max(0, Math.min(1, (activeRange.startTime + activeRange.duration - currentTime) / fadeDuration))
      }
    }
    const eased = layoutProgress * layoutProgress * (3 - 2 * layoutProgress)
    const fromComposition = getCompositionState(fromLayout)
    const toComposition = getCompositionState(toLayout)
    const screenRect = rectLerp(fromComposition.screenRect, toComposition.screenRect, eased)
    const presenterRect = rectLerp(fromComposition.presenterRect, toComposition.presenterRect, eased)
    const screenAlpha = lerp(fromComposition.screenAlpha, toComposition.screenAlpha, eased)
    const presenterAlpha = lerp(fromComposition.presenterAlpha, toComposition.presenterAlpha, eased)
    const presenterRadius = lerp(fromComposition.presenterRadius, toComposition.presenterRadius, eased)

    await drawBaseBackground()
    drawScreenInRect(screenRect, screenAlpha)
    drawPresenter(presenterRect, presenterRadius, presenterAlpha)
  }

  // Timeline-scoped visual effects are rendered into the same canvas as the video,
  // so they are present in both preview and the exported frames.
  for (const effect of state.visualEffects || []) {
    if (currentTime < effect.startTime || currentTime >= effect.startTime + effect.duration) continue
    const x = Math.max(0, effect.x * outputWidth), y = Math.max(0, effect.y * outputHeight)
    const w = Math.min(outputWidth - x, effect.width * outputWidth), h = Math.min(outputHeight - y, effect.height * outputHeight)
    if (w <= 0 || h <= 0) continue
    const activeProgress = Math.min(1, (currentTime - effect.startTime) / Math.max(0.01, effect.enterDuration))
    const remaining = Math.min(1, (effect.startTime + effect.duration - currentTime) / Math.max(0.01, effect.exitDuration))
    const alpha = Math.max(0, Math.min(activeProgress, remaining))
    ctx.save()
    ctx.globalAlpha = effect.animated ? alpha : 1
    const makeEffectPath = () => {
      const shapePath = new Path2D()
      if (effect.shape === 'circle') shapePath.ellipse(x + w/2, y + h/2, w/2, h/2, 0, 0, Math.PI*2)
      else if (effect.shape === 'freeform') { effect.points.forEach((point, index) => index === 0 ? shapePath.moveTo(x + point.x*w, y + point.y*h) : shapePath.lineTo(x + point.x*w, y + point.y*h)); shapePath.closePath() }
      else shapePath.rect(x, y, effect.shape === 'square' ? Math.min(w,h) : w, effect.shape === 'square' ? Math.min(w,h) : h)
      return shapePath
    }
    const path = makeEffectPath()
    if (effect.kind === 'mask') {
      ctx.fillStyle = effect.color
      ctx.fill(path)
    } else if (effect.kind === 'blur') {
      const patch = document.createElement('canvas'); patch.width = Math.max(1, Math.ceil(w)); patch.height = Math.max(1, Math.ceil(h))
      const patchCtx = patch.getContext('2d')
      if (patchCtx) { patchCtx.filter = `blur(${Math.max(0, effect.blur)}px)`; patchCtx.drawImage(ctx.canvas, x, y, w, h, 0, 0, patch.width, patch.height); ctx.save(); ctx.beginPath(); ctx.clip(path); ctx.drawImage(patch, x, y, w, h); ctx.restore() }
    } else if (effect.kind === 'focus') {
      // Fill only the area outside the focus shape (evenodd preserves the video in the hole).
      const dimPath = new Path2D(); dimPath.rect(0, 0, outputWidth, outputHeight)
      dimPath.addPath(path)
      ctx.fillStyle = `rgba(0,0,0,${Math.max(0, Math.min(.9, effect.dimOutside))})`
      ctx.fill(dimPath, 'evenodd')
      if (effect.scale > 1) {
        const snapshot = document.createElement('canvas'); snapshot.width = outputWidth; snapshot.height = outputHeight
        const snapshotCtx = snapshot.getContext('2d'); if (snapshotCtx) { snapshotCtx.drawImage(ctx.canvas, 0, 0); const cropW = w / effect.scale, cropH = h / effect.scale; ctx.save(); ctx.beginPath(); ctx.clip(path); ctx.drawImage(snapshot, x + w/2-cropW/2, y+h/2-cropH/2, cropW, cropH, x, y, w, h); ctx.restore() }
      }
      ctx.strokeStyle = effect.color; ctx.lineWidth = Math.max(1, effect.borderWidth); ctx.stroke(path)
    } else if (effect.kind === 'border') {
      ctx.strokeStyle = effect.color; ctx.lineWidth = Math.max(1, effect.borderWidth)
      if (effect.animated) ctx.setLineDash([Math.max(4, effect.borderWidth*2), Math.max(3, effect.borderWidth*1.5)])
      ctx.lineDashOffset = effect.animated ? (effect.loop ? currentTime * 35 : ((currentTime-effect.startTime) / Math.max(.01,effect.duration)) * 80 * (effect.direction === 'out' ? 1 : -1)) : 0
      ctx.stroke(path)
    }
    ctx.restore()
  }
}
