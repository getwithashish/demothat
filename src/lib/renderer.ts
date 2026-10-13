import { EditorState, RenderableState, WebcamPosition } from '../types'
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

  // --- 6. Draw Webcam ---
  const { webcamPosition, webcamStyles, isWebcamVisible } = state
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

    if (webcamStyles.shadowBlur > 0) {
      ctx.save()
      ctx.shadowColor = webcamStyles.shadowColor
      ctx.shadowBlur = webcamStyles.shadowBlur
      ctx.shadowOffsetX = webcamStyles.shadowOffsetX
      ctx.shadowOffsetY = webcamStyles.shadowOffsetY
      const webcamShadowPath = new Path2D()
      webcamShadowPath.roundRect(webcamX, webcamY, webcamWidth, webcamHeight, webcamRadius)
      ctx.fillStyle = 'rgba(0,0,0,1)'
      ctx.fill(webcamShadowPath)
      ctx.restore()
    }

    const webcamVideo = webcamVideoElement
    const webcamAR = webcamVideo.videoWidth / webcamVideo.videoHeight
    const targetAR = webcamWidth / webcamHeight

    let sx = 0,
      sy = 0,
      sWidth = webcamVideo.videoWidth,
      sHeight = webcamVideo.videoHeight

    if (webcamAR > targetAR) {
      sWidth = webcamVideo.videoHeight * targetAR
      sx = (webcamVideo.videoWidth - sWidth) / 2
    } else {
      sHeight = webcamVideo.videoWidth / targetAR
      sy = (webcamVideo.videoHeight - sHeight) / 2
    }

    ctx.save()

    if (webcamStyles.isFlipped) {
      ctx.translate(outputWidth, 0)
      ctx.scale(-1, 1)
    }

    const drawX = webcamStyles.isFlipped ? outputWidth - webcamX - webcamWidth : webcamX
    const webcamPath = new Path2D()
    webcamPath.roundRect(drawX, webcamY, webcamWidth, webcamHeight, webcamRadius)
    ctx.clip(webcamPath)
    ctx.drawImage(webcamVideo, sx, sy, sWidth, sHeight, drawX, webcamY, webcamWidth, webcamHeight)
    ctx.restore()
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
