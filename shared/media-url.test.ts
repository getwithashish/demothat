import { describe, expect, it } from 'vitest'
import { mediaUrl } from './media-url'

describe('mediaUrl', () => {
  it('encodes a plain absolute path', () => {
    expect(mediaUrl('/tmp/screen.mp4')).toBe('media:///tmp/screen.mp4')
  })

  it('encodes a path with a space (macOS Application Support)', () => {
    expect(mediaUrl('/Users/me/Library/Application Support/DemoThat/x/screen.mp4')).toBe(
      'media:///Users/me/Library/Application%20Support/DemoThat/x/screen.mp4',
    )
  })

  it('escapes # and ? which would otherwise terminate the URL', () => {
    expect(mediaUrl('/tmp/w#eird/name?.mp4')).toBe('media:///tmp/w%23eird/name%3F.mp4')
  })

  it('is the inverse of the main-process decode', () => {
    const path = '/tmp/some file (1)#final.mp4'
    const next = `media://${decodeURIComponent(mediaUrl(path).replace('media://', ''))}`
    expect(next).toBe(`media://${path}`)
  })
})
