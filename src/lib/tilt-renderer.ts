// Draws a flat layer onto a 2D canvas as if it were a plane tilted in 3D.
//
// The frame (video, shadow, border, cursor effects) is first rendered, flat, into an offscreen
// "layer" canvas that is larger than the output so the tilted plane doesn't run out of pixels at the
// edges. The layer is then projected onto the output with perspective-correct texture mapping:
//   1. WebGL2 (preferred): one textured quad, mipmapped, exact perspective.
//   2. Canvas 2D mesh (fallback when WebGL2 is unavailable): a grid of affine-mapped triangles.

import {
  TILT_LAYER_MARGIN,
  projectLayerQuad,
  projectPoint,
  resolveCameraDistance,
  solveAffine,
  type Rect,
  type TiltParams,
} from './perspective'

type LayerPainter = (ctx: CanvasRenderingContext2D) => void

interface GlResources {
  canvas: HTMLCanvasElement
  gl: WebGL2RenderingContext
  program: WebGLProgram
  buffer: WebGLBuffer
  texture: WebGLTexture
  vao: WebGLVertexArrayObject
  maxTextureSize: number
}

const VERTEX_SHADER = `#version 300 es
in vec2 aPos;
in vec3 aUvq;
out vec3 vUvq;
void main() {
  vUvq = aUvq;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

// (u*q, v*q, q) is interpolated linearly across the screen; dividing by q restores perspective-correct UVs.
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec3 vUvq;
out vec4 outColor;
void main() {
  outColor = texture(uTex, vUvq.xy / vUvq.z);
}`

const MESH_DIVISIONS = 20
const FALLBACK_MAX_TEXTURE_SIZE = 8192

let layerCanvas: HTMLCanvasElement | null = null
let glResources: GlResources | null = null
let glUnavailable = false
let warnedAboutFallback = false

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Could not create shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader compile failed: ${info}`)
  }
  return shader
}

function initGl(): GlResources | null {
  if (glUnavailable) return null
  if (glResources && !glResources.gl.isContextLost()) return glResources

  glResources = null
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      preserveDrawingBuffer: false,
    })
    if (!gl) throw new Error('WebGL2 is not available')

    const program = gl.createProgram()
    if (!program) throw new Error('Could not create program')
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`)
    }
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)

    const buffer = gl.createBuffer()
    const texture = gl.createTexture()
    const vao = gl.createVertexArray()
    if (!buffer || !texture || !vao) throw new Error('Could not allocate GL resources')

    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    const stride = 5 * Float32Array.BYTES_PER_ELEMENT
    const posLocation = gl.getAttribLocation(program, 'aPos')
    const uvqLocation = gl.getAttribLocation(program, 'aUvq')
    gl.enableVertexAttribArray(posLocation)
    gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, stride, 0)
    gl.enableVertexAttribArray(uvqLocation)
    gl.vertexAttribPointer(uvqLocation, 3, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT)
    gl.bindVertexArray(null)

    glResources = {
      canvas,
      gl,
      program,
      buffer,
      texture,
      vao,
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    }
    return glResources
  } catch (error) {
    glUnavailable = true
    console.warn('[tilt] WebGL2 unavailable, using the canvas 2D fallback for perspective tilt.', error)
    return null
  }
}

/** Renders the layer through WebGL and returns the GL canvas, or null if anything went wrong. */
function renderWithGl(
  res: GlResources,
  layer: HTMLCanvasElement,
  quad: ReturnType<typeof projectLayerQuad>,
  outputWidth: number,
  outputHeight: number,
): HTMLCanvasElement | null {
  const { gl, canvas, program, buffer, texture, vao } = res
  if (gl.isContextLost()) return null

  if (canvas.width !== outputWidth || canvas.height !== outputHeight) {
    canvas.width = outputWidth
    canvas.height = outputHeight
  }
  gl.viewport(0, 0, outputWidth, outputHeight)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.disable(gl.BLEND)
  gl.disable(gl.DEPTH_TEST)

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer)
  gl.generateMipmap(gl.TEXTURE_2D)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  // Corner order matches projectLayerQuad: top-left, top-right, bottom-right, bottom-left.
  const uvs: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]
  const vertex = (i: number) => {
    const p = quad[i]
    const [u, v] = uvs[i]
    return [(p.x / outputWidth) * 2 - 1, 1 - (p.y / outputHeight) * 2, u * p.q, v * p.q, p.q]
  }
  const data = new Float32Array([...vertex(0), ...vertex(1), ...vertex(2), ...vertex(0), ...vertex(2), ...vertex(3)])

  gl.useProgram(program)
  gl.uniform1i(gl.getUniformLocation(program, 'uTex'), 0)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
  gl.drawArrays(gl.TRIANGLES, 0, 6)
  gl.bindVertexArray(null)

  return gl.getError() === gl.NO_ERROR ? canvas : null
}

/** Canvas 2D fallback: approximates the projection with a grid of affine-mapped triangles. */
function renderWithMesh(
  ctx: CanvasRenderingContext2D,
  layer: HTMLCanvasElement,
  params: TiltParams,
  layerRect: Rect,
  outputWidth: number,
  outputHeight: number,
) {
  const distance = resolveCameraDistance(params, layerRect, outputWidth, outputHeight)
  const n = MESH_DIVISIONS
  const grid: Array<Array<{ x: number; y: number }>> = []
  for (let j = 0; j <= n; j++) {
    const row = []
    for (let i = 0; i <= n; i++) {
      const x = layerRect.x + (i / n) * layerRect.width
      const y = layerRect.y + (j / n) * layerRect.height
      row.push(projectPoint(params, distance, outputWidth, outputHeight, x, y))
    }
    grid.push(row)
  }

  const stepX = layer.width / n
  const stepY = layer.height / n

  const drawTriangle = (
    src: [[number, number], [number, number], [number, number]],
    dst: [[number, number], [number, number], [number, number]],
  ) => {
    const matrix = solveAffine(src, dst)
    if (!matrix) return

    // Grow the clip a little so neighbouring triangles overlap instead of leaving hairline gaps.
    const cx = (dst[0][0] + dst[1][0] + dst[2][0]) / 3
    const cy = (dst[0][1] + dst[1][1] + dst[2][1]) / 3
    const grown = dst.map(([x, y]) => {
      const dx = x - cx
      const dy = y - cy
      const len = Math.hypot(dx, dy) || 1
      return [x + (dx / len) * 0.5, y + (dy / len) * 0.5]
    })

    const minX = Math.max(0, Math.floor(Math.min(src[0][0], src[1][0], src[2][0])) - 2)
    const minY = Math.max(0, Math.floor(Math.min(src[0][1], src[1][1], src[2][1])) - 2)
    const maxX = Math.min(layer.width, Math.ceil(Math.max(src[0][0], src[1][0], src[2][0])) + 2)
    const maxY = Math.min(layer.height, Math.ceil(Math.max(src[0][1], src[1][1], src[2][1])) + 2)

    ctx.save()
    ctx.beginPath()
    ctx.moveTo(grown[0][0], grown[0][1])
    ctx.lineTo(grown[1][0], grown[1][1])
    ctx.lineTo(grown[2][0], grown[2][1])
    ctx.closePath()
    ctx.clip()
    ctx.transform(...matrix)
    ctx.drawImage(layer, minX, minY, maxX - minX, maxY - minY, minX, minY, maxX - minX, maxY - minY)
    ctx.restore()
  }

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const s00: [number, number] = [i * stepX, j * stepY]
      const s10: [number, number] = [(i + 1) * stepX, j * stepY]
      const s11: [number, number] = [(i + 1) * stepX, (j + 1) * stepY]
      const s01: [number, number] = [i * stepX, (j + 1) * stepY]
      const d00: [number, number] = [grid[j][i].x, grid[j][i].y]
      const d10: [number, number] = [grid[j][i + 1].x, grid[j][i + 1].y]
      const d11: [number, number] = [grid[j + 1][i + 1].x, grid[j + 1][i + 1].y]
      const d01: [number, number] = [grid[j + 1][i].x, grid[j + 1][i].y]
      drawTriangle([s00, s10, s11], [d00, d10, d11])
      drawTriangle([s00, s11, s01], [d00, d11, d01])
    }
  }
}

/**
 * Paints the frame with `paintLayer` and draws it onto `ctx` tilted according to `params`.
 * `paintLayer` receives a context whose coordinate system matches the output canvas, so the same
 * drawing code works for both the flat and the tilted path.
 */
export function drawTiltedLayer(
  ctx: CanvasRenderingContext2D,
  paintLayer: LayerPainter,
  params: TiltParams,
  outputWidth: number,
  outputHeight: number,
): void {
  const marginX = outputWidth * TILT_LAYER_MARGIN
  const marginY = outputHeight * TILT_LAYER_MARGIN
  const layerRect: Rect = {
    x: -marginX,
    y: -marginY,
    width: outputWidth + marginX * 2,
    height: outputHeight + marginY * 2,
  }

  const gl = initGl()
  const maxTextureSize = gl?.maxTextureSize ?? FALLBACK_MAX_TEXTURE_SIZE
  const layerScale = Math.min(1, maxTextureSize / layerRect.width, maxTextureSize / layerRect.height)
  const layerPixelWidth = Math.max(1, Math.ceil(layerRect.width * layerScale))
  const layerPixelHeight = Math.max(1, Math.ceil(layerRect.height * layerScale))

  if (!layerCanvas) layerCanvas = document.createElement('canvas')
  if (layerCanvas.width !== layerPixelWidth || layerCanvas.height !== layerPixelHeight) {
    layerCanvas.width = layerPixelWidth
    layerCanvas.height = layerPixelHeight
  }

  const layerCtx = layerCanvas.getContext('2d')
  if (!layerCtx) {
    // Without a layer there is nothing to tilt; draw the frame flat rather than dropping it.
    paintLayer(ctx)
    return
  }

  layerCtx.setTransform(1, 0, 0, 1, 0, 0)
  layerCtx.clearRect(0, 0, layerCanvas.width, layerCanvas.height)
  layerCtx.setTransform(layerScale, 0, 0, layerScale, marginX * layerScale, marginY * layerScale)
  layerCtx.imageSmoothingEnabled = true
  layerCtx.imageSmoothingQuality = 'high'
  paintLayer(layerCtx)
  layerCtx.setTransform(1, 0, 0, 1, 0, 0)

  if (gl) {
    const quad = projectLayerQuad(params, layerRect, outputWidth, outputHeight)
    const rendered = renderWithGl(gl, layerCanvas, quad, outputWidth, outputHeight)
    if (rendered) {
      ctx.drawImage(rendered, 0, 0, outputWidth, outputHeight)
      return
    }
  }

  if (!warnedAboutFallback) {
    warnedAboutFallback = true
    console.warn('[tilt] Falling back to the canvas 2D mesh for perspective tilt.')
  }
  renderWithMesh(ctx, layerCanvas, params, layerRect, outputWidth, outputHeight)
}
