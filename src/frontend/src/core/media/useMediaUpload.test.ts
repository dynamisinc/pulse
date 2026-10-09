/**
 * core/media/useMediaUpload.test.ts
 * ---------------------------------------------------------------------------
 * The upload state machine a composer binds to (demo-polish F0): idle ->
 * uploading (monotonic progress) -> done | error; `cancel()` aborts and returns
 * to idle (an abort is a choice, not an error); a second `start()` supersedes the
 * first; unmounting aborts. The upload itself is mocked — the adapters have their
 * own tests — so every transition is driven deterministically.
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAbortError } from './mediaErrors'
import type { MediaAssetView } from './types'

interface Pending {
  readonly file: File
  readonly signal: AbortSignal | undefined
  readonly onProgress: ((fraction: number) => void) | undefined
  resolve(asset: MediaAssetView): void
  reject(error: unknown): void
}

const pending: Pending[] = []

vi.mock('./uploadMedia', () => ({
  uploadPickedMedia: (
    file: File,
    handlers: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
  ) =>
    new Promise<MediaAssetView>((resolve, reject) => {
      pending.push({
        file,
        signal: handlers.signal,
        onProgress: handlers.onProgress,
        resolve,
        reject,
      })
    }),
}))

import { useMediaUpload } from './useMediaUpload'

const ASSET: MediaAssetView = { id: 'mock-media-1', kind: 'image', url: 'blob:1' }

function file(name = 'a.png'): File {
  return new File([new Uint8Array([1])], name, { type: 'image/png' })
}

function current(): Pending {
  const last = pending.at(-1)
  if (last === undefined) throw new Error('no upload in flight')
  return last
}

beforeEach(() => {
  pending.length = 0
})

describe('useMediaUpload', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useMediaUpload())

    expect(result.current.state).toBe('idle')
    expect(result.current.progress).toBe(0)
    expect(result.current.error).toBeUndefined()
  })

  it('moves idle -> uploading -> done, tracking progress, and resolves the asset', async () => {
    const { result } = renderHook(() => useMediaUpload())

    let promise!: Promise<MediaAssetView>
    act(() => {
      promise = result.current.start(file())
    })
    expect(result.current.state).toBe('uploading')

    act(() => current().onProgress?.(0.4))
    expect(result.current.progress).toBe(0.4)

    await act(async () => {
      current().resolve(ASSET)
      await promise
    })

    expect(await promise).toBe(ASSET)
    expect(result.current.state).toBe('done')
    expect(result.current.progress).toBe(1)
    expect(result.current.error).toBeUndefined()
  })

  it('records the message and rejects when the upload fails', async () => {
    const { result } = renderHook(() => useMediaUpload())

    let promise!: Promise<MediaAssetView>
    act(() => {
      promise = result.current.start(file())
    })
    const settled = promise.catch((error: unknown) => error)

    await act(async () => {
      current().reject(new Error('That image is too large (5 MB max).'))
      await settled
    })

    expect(result.current.state).toBe('error')
    expect(result.current.error).toBe('That image is too large (5 MB max).')
    expect(await settled).toBeInstanceOf(Error)
  })

  it('cancel() aborts the signal and returns to idle without an error', async () => {
    const { result } = renderHook(() => useMediaUpload())

    let promise!: Promise<MediaAssetView>
    act(() => {
      promise = result.current.start(file())
    })
    const settled = promise.catch((error: unknown) => error)
    const signal = current().signal
    expect(signal?.aborted).toBe(false)

    await act(async () => {
      result.current.cancel()
      // A real adapter rejects with an AbortError once its signal fires.
      current().reject(createAbortError())
      await settled
    })

    expect(signal?.aborted).toBe(true)
    expect(result.current.state).toBe('idle')
    expect(result.current.progress).toBe(0)
    expect(result.current.error).toBeUndefined()
  })

  it('a second start() aborts the first and ignores its late settle', async () => {
    const { result } = renderHook(() => useMediaUpload())

    let first!: Promise<MediaAssetView>
    let second!: Promise<MediaAssetView>
    act(() => {
      first = result.current.start(file('first.png'))
    })
    const firstSettled = first.catch((error: unknown) => error)
    const firstPending = current()
    act(() => {
      second = result.current.start(file('second.png'))
    })

    expect(firstPending.signal?.aborted).toBe(true)
    expect(result.current.state).toBe('uploading')

    await act(async () => {
      firstPending.reject(createAbortError())
      await firstSettled
    })
    // The superseded upload's abort must NOT reset the new upload's state.
    expect(result.current.state).toBe('uploading')

    await act(async () => {
      current().resolve(ASSET)
      await second
    })
    expect(result.current.state).toBe('done')
  })

  it('aborts the in-flight upload when the component unmounts', () => {
    const { result, unmount } = renderHook(() => useMediaUpload())

    act(() => {
      result.current.start(file()).catch(() => {})
    })
    const { signal } = current()

    unmount()

    expect(signal?.aborted).toBe(true)
  })
})
