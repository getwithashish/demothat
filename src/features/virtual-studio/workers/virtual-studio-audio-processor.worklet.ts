// AudioWorkletGlobalScope types (since DOM lib does not declare AudioWorkletProcessor in window scope)
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: unknown)
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean
}

declare function registerProcessor(name: string, processorCtor: new (...args: unknown[]) => unknown): void

export const VIRTUAL_STUDIO_AUDIO_PROCESSOR_NAME = 'virtual-studio-audio-processor'

export const WORKLET_PROCESSOR_CODE = `
class VirtualStudioAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Int16Array(1024 * 2)
    this.offset = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) {
      return true
    }

    const left = input[0]
    if (!left || left.length === 0) {
      return true
    }

    const right = input.length > 1 ? input[1] : left
    const length = left.length

    for (let i = 0; i < length; i++) {
      const sL = Math.max(-1, Math.min(1, left[i]))
      this.buffer[this.offset * 2] = sL < 0 ? sL * 0x8000 : sL * 0x7fff
      const sR = Math.max(-1, Math.min(1, right[i]))
      this.buffer[this.offset * 2 + 1] = sR < 0 ? sR * 0x8000 : sR * 0x7fff
      this.offset++

      if (this.offset >= 1024) {
        const chunk = this.buffer.slice()
        this.port.postMessage(chunk.buffer, [chunk.buffer])
        this.offset = 0
      }
    }

    return true
  }
}

if (typeof registerProcessor !== 'undefined') {
  registerProcessor('virtual-studio-audio-processor', VirtualStudioAudioProcessor)
}
`

export function createAudioWorkletBlobUrl(): string {
  if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const blob = new Blob([WORKLET_PROCESSOR_CODE], { type: 'application/javascript' })
    return URL.createObjectURL(blob)
  }
  return ''
}

const BaseAudioWorkletProcessor: typeof AudioWorkletProcessor =
  typeof AudioWorkletProcessor !== 'undefined'
    ? AudioWorkletProcessor
    : (class {
        readonly port = {
          postMessage: (_msg: unknown, _transfer?: Transferable[]) => {},
        } as unknown as MessagePort
        constructor(_options?: unknown) {}
        process(
          _inputs: Float32Array[][],
          _outputs: Float32Array[][],
          _parameters: Record<string, Float32Array>,
        ): boolean {
          return true
        }
      } as unknown as typeof AudioWorkletProcessor)

/**
 * VirtualStudioAudioProcessor converts stereo/mono Float32Array [-1, 1] audio quantums
 * into Int16Array [-32768, 32767] interleaved PCM chunks on a dedicated audio rendering thread.
 * It posts transferable ArrayBuffers via this.port.postMessage to decouple audio processing from the UI thread.
 */
export class VirtualStudioAudioProcessor extends BaseAudioWorkletProcessor {
  process(
    inputs: Float32Array[][],
    _outputs: Float32Array[][] = [],
    _parameters: Record<string, Float32Array> = {},
  ): boolean {
    const input = inputs[0]
    if (!input || input.length === 0) {
      return true
    }

    const left = input[0]
    if (!left || left.length === 0) {
      return true
    }

    const right = input.length > 1 ? input[1] : left
    const length = left.length
    const pcm16 = new Int16Array(length * 2)

    for (let i = 0; i < length; i++) {
      const sL = Math.max(-1, Math.min(1, left[i]))
      pcm16[i * 2] = sL < 0 ? sL * 0x8000 : sL * 0x7fff
      const sR = Math.max(-1, Math.min(1, right[i]))
      pcm16[i * 2 + 1] = sR < 0 ? sR * 0x8000 : sR * 0x7fff
    }

    const buffer = pcm16.buffer
    this.port.postMessage(buffer, [buffer])
    return true
  }
}

if (typeof registerProcessor !== 'undefined') {
  registerProcessor(VIRTUAL_STUDIO_AUDIO_PROCESSOR_NAME, VirtualStudioAudioProcessor)
}
