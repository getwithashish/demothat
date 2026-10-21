// The helper's client: what the app does with the JSON lines it streams.
//
// The spawning itself cannot be unit-tested here — that needs a Wayland desktop —
// but the two things that would silently lose cursor samples can be: the framing of
// the event stream, and the mapping of each event onto what the editor expects.

import { describe, expect, it } from 'vitest'
import {
  createEventParser,
  helperBinaryPath,
  helperConfig,
  type CursorSample,
  type HelperStartInfo,
} from './cursor-helper'

function collect() {
  const starts: HelperStartInfo[] = []
  const samples: CursorSample[] = []
  const warnings: string[] = []
  const errors: string[] = []
  const ends: Array<[number, number]> = []

  const parser = createEventParser({
    onStart: (info) => starts.push(info),
    onSample: (sample) => samples.push(sample),
    onWarning: (message) => warnings.push(message),
    onError: (message) => errors.push(message),
    onEnd: (frames, dropped) => ends.push([frames, dropped]),
  })

  return { parser, starts, samples, warnings, errors, ends }
}

describe('helperConfig', () => {
  it('tells the helper which descriptor carries the video', () => {
    const config = JSON.parse(helperConfig(3, 30)) as Record<string, number>
    expect(config.videoFd).toBe(3)
    expect(config.fps).toBe(30)
    expect(config.clickIdleTimeoutMs).toBeGreaterThan(0)
  })
})

describe('the event stream', () => {
  it('reads a whole line at a time', () => {
    const { parser, starts, samples } = collect()
    parser.push(
      '{"type":"started","width":2560,"height":1440,"format":"bgra","cursor_mode":"metadata","clicks":true}\n' +
        '{"type":"move","timestamp":1700000000000,"x":812.5,"y":430}\n',
    )

    expect(starts).toEqual([
      { width: 2560, height: 1440, format: 'bgra', fps: 30, cursorMode: 'metadata', clicks: true },
    ])
    expect(samples).toHaveLength(1)
    expect(samples[0]).toMatchObject({ type: 'move', x: 812.5, y: 430, timestamp: 1700000000000 })
  })

  it('holds a line split across chunks until the rest arrives', () => {
    const { parser, samples } = collect()
    // A read boundary landed in the middle of the JSON, and in the middle of a
    // number: this is the case that silently drops samples if framing is wrong.
    parser.push('{"type":"move","timestamp":17000')
    parser.push('00000000,"x":1')
    parser.push('0.5,"y":20.25}\n')
    parser.push('{"type":"move","timestamp":1,"x":1,"y":2}\n')

    expect(samples).toHaveLength(2)
    expect(samples[0]).toMatchObject({ timestamp: 1700000000000, x: 10.5, y: 20.25 })
    expect(samples[1]).toMatchObject({ x: 1, y: 2 })
  })

  it('ignores a line it cannot parse instead of ending the recording', () => {
    const { parser, samples } = collect()
    parser.push('not json at all\n')
    parser.push('{"type":"move","timestamp":1,"x":3,"y":4}\n')
    expect(samples).toHaveLength(1)
  })

  it('ignores an event type it does not know', () => {
    const { parser, samples } = collect()
    parser.push('{"type":"teleport","x":1,"y":2}\n{"type":"move","timestamp":1,"x":3,"y":4}\n')
    expect(samples).toHaveLength(1)
  })

  it('drops a sample with no usable coordinates', () => {
    const { parser, samples } = collect()
    parser.push('{"type":"move","timestamp":1}\n{"type":"move","timestamp":2,"x":null,"y":5}\n')
    expect(samples).toHaveLength(0)
  })

  it('carries clicks through with their button state', () => {
    const { parser, samples } = collect()
    parser.push('{"type":"click","timestamp":9,"x":5,"y":6,"button":"left","pressed":true}\n')
    expect(samples[0]).toMatchObject({ type: 'click', button: 'left', pressed: true })
  })

  it('reports warnings, errors and the closing tally separately', () => {
    const { parser, warnings, errors, ends } = collect()
    parser.push('{"type":"warning","message":"no pointer devices found"}\n')
    parser.push('{"type":"error","message":"the desktop would not share a screen"}\n')
    parser.push('{"type":"ended","frames":900,"dropped":3}\n')

    expect(warnings).toEqual(['no pointer devices found'])
    expect(errors).toEqual(['the desktop would not share a screen'])
    expect(ends).toEqual([[900, 3]])
  })

  it("carries the compositor's frame rate, because FFmpeg stamps frames with it", () => {
    const { parser, starts } = collect()
    parser.push('{"type":"started","width":100,"height":50,"fps":60}\n')
    expect(starts[0].fps).toBe(60)
  })

  it('falls back to the rate we asked for when the helper does not say', () => {
    const { parser, starts } = collect()
    parser.push('{"type":"started","width":100,"height":50}\n{"type":"started","width":100,"height":50,"fps":0}\n')
    parser.push('{"type":"started","width":100,"height":50,"fps":0.5}\n')
    expect(starts.map((info) => info.fps)).toEqual([30, 30, 30])
  })

  it('assumes nothing about the cursor mode it is not told about', () => {
    // An older helper, or a compositor that says nothing: the app must not assume
    // metadata mode and draw a second cursor on top of a recorded one.
    const { parser, starts } = collect()
    parser.push('{"type":"started","width":100,"height":50}\n')
    expect(starts[0].cursorMode).toBe('embedded')
    expect(starts[0].format).toBe('bgra')
    expect(starts[0].clicks).toBe(false)
  })
})

describe('locating the helper', () => {
  it('returns a real file or nothing, and never throws', () => {
    // The binary is present in a dev checkout that has been built and absent
    // otherwise; both are normal, and neither may break a recording.
    const binary = helperBinaryPath()
    if (binary !== null) {
      expect(typeof binary).toBe('string')
      expect(binary).toMatch(/demothat-cursor-helper$/)
    } else {
      expect(binary).toBeNull()
    }
  })
})

describe('starting the helper', () => {
  it('gives up quietly when there is no helper beside the app', async () => {
    // The packaged case, with nothing bundled: starting a recording must not throw,
    // it must simply hand the work back to the browser capture path.
    const { app } = await import('electron')
    const { startCursorHelper } = await import('./cursor-helper')
    const packaged = (app as unknown as { isPackaged: boolean }).isPackaged
    ;(app as unknown as { isPackaged: boolean }).isPackaged = true
    try {
      const session = await startCursorHelper({ fps: 30, onSample: () => {} })
      expect(session).toBeNull()
    } finally {
      ;(app as unknown as { isPackaged: boolean }).isPackaged = packaged
    }
  })
})
