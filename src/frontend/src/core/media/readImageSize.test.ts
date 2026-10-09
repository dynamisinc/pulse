/**
 * core/media/readImageSize.test.ts
 * ---------------------------------------------------------------------------
 * `readImageSize` against a stubbed `Image` + object-URL pair (jsdom decodes
 * nothing): resolves the natural size, revokes its TEMPORARY object URL on both
 * the success and failure paths, and rejects an undecodable or zero-size image.
 *
 * ABORT: a signal aborted mid-decode rejects with an `AbortError` and releases the
 * handlers + revokes the URL at once (the browser's later load/error is inert);
 * an already-aborted signal rejects up front without creating a URL; and on normal
 * completion the abort listener is removed (a late abort changes nothing).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isAbortError } from './mediaErrors'
import { readImageSize } from './readImageSize'

type Outcome =
  | { kind: 'load'; width: number; height: number }
  | { kind: 'error' }
  /** Fire NOTHING — a decode still in flight. */
  | { kind: 'hang' }

let outcome: Outcome = { kind: 'load', width: 0, height: 0 }
/** Every `new Image()` the code under test made, oldest first. */
const images: FakeImage[] = []

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 0
  naturalHeight = 0

  constructor() {
    images.push(this)
  }

  set src(_value: string) {
    if (outcome.kind === 'hang') return
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
  images.length = 0
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

describe('readImageSize — abort', () => {
  it('rejects with an AbortError and revokes the URL at once when aborted mid-decode', async () => {
    outcome = { kind: 'hang' }
    const controller = new AbortController()

    const result = readImageSize(file, { signal: controller.signal }).catch(
      (error: unknown) => error,
    )
    expect(revokeObjectURL).not.toHaveBeenCalled()
    controller.abort()

    expect(isAbortError(await result)).toBe(true)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:temp-image')
    // Handlers are released, so the browser's later load/error is inert.
    expect(images[0]?.onload).toBeNull()
    expect(images[0]?.onerror).toBeNull()
  })

  it('stays rejected (settles once, revokes once) if the decode finishes after the abort', async () => {
    outcome = { kind: 'hang' }
    const controller = new AbortController()

    const result = readImageSize(file, { signal: controller.signal }).catch(
      (error: unknown) => error,
    )
    controller.abort()
    await result
    // A late load: the handler was nulled, so nothing runs.
    const image = images[0]
    if (image === undefined) throw new Error('no image element')
    image.naturalWidth = 800
    image.naturalHeight = 600
    image.onload?.()

    expect(isAbortError(await result)).toBe(true)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('rejects immediately, creating no image or object URL, when already aborted', async () => {
    outcome = { kind: 'load', width: 1600, height: 900 }
    const controller = new AbortController()
    controller.abort()

    await expect(readImageSize(file, { signal: controller.signal })).rejects.toSatisfy(isAbortError)
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    expect(images).toHaveLength(0)
  })

  it('is unchanged on the normal path and removes its abort listener on completion', async () => {
    outcome = { kind: 'load', width: 1600, height: 900 }
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')

    await expect(readImageSize(file, { signal: controller.signal })).resolves.toEqual({
      width: 1600,
      height: 900,
    })
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))

    // A late abort is a no-op: still one revoke, no second settle.
    controller.abort()
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('also removes the abort listener on a decode failure', async () => {
    outcome = { kind: 'error' }
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')

    await expect(readImageSize(file, { signal: controller.signal })).rejects.toThrow(
      /could not be read/,
    )
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })
})
