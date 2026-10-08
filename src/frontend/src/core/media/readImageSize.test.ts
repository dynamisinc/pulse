/**
 * core/media/readImageSize.test.ts
 * ---------------------------------------------------------------------------
 * `readImageSize` against a stubbed `Image` + object-URL pair (jsdom decodes
 * nothing): resolves the natural size, revokes its TEMPORARY object URL on both
 * the success and failure paths, and rejects an undecodable or zero-size image.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readImageSize } from './readImageSize'

type Outcome = { kind: 'load'; width: number; height: number } | { kind: 'error' }

let outcome: Outcome = { kind: 'load', width: 0, height: 0 }

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 0
  naturalHeight = 0

  set src(_value: string) {
    queueMicrotask(() => {
      if (outcome.kind === 'load') {
        this.naturalWidth = outcome.width
        this.naturalHeight = outcome.height
        this.onload?.()
      } else {
        this.onerror?.()
      }
    })
  }
}

const createObjectURL = vi.fn(() => 'blob:temp-image')
const revokeObjectURL = vi.fn()

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage)
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const file = new File(['x'], 'photo.png', { type: 'image/png' })

describe('readImageSize', () => {
  it('resolves the natural width and height and revokes its temporary URL', async () => {
    outcome = { kind: 'load', width: 1600, height: 900 }

    await expect(readImageSize(file)).resolves.toEqual({ width: 1600, height: 900 })
    expect(createObjectURL).toHaveBeenCalledWith(file)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:temp-image')
  })

  it('rejects an image the browser cannot decode, still revoking the URL', async () => {
    outcome = { kind: 'error' }

    await expect(readImageSize(file)).rejects.toThrow(/could not be read/)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:temp-image')
  })

  it('rejects an image that decodes to a zero size', async () => {
    outcome = { kind: 'load', width: 0, height: 0 }

    await expect(readImageSize(file)).rejects.toThrow(/no readable size/)
  })
})
