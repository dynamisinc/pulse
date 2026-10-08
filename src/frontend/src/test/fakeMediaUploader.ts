/**
 * src/test/fakeMediaUploader.ts
 * ---------------------------------------------------------------------------
 * TEST-ONLY. A controllable stand-in for `@/core/media`'s `uploadPickedMedia`, so
 * the composer's attach tray (demo-polish F4) can be driven step by step:
 * progress ticks, completion, failure and cancel are all the TEST's to trigger,
 * with no timers and no network.
 *
 * Usage (the `vi.mock` call must live in the test file — Vitest hoists it):
 *
 *   vi.mock('@/core/media', async importOriginal => {
 *     const actual = await importOriginal<typeof import('@/core/media')>()
 *     return { ...actual, uploadPickedMedia: vi.fn() }
 *   })
 *   import { uploadPickedMedia } from '@/core/media'
 *   const uploader = installFakeUploader(vi.mocked(uploadPickedMedia))
 *
 * Each `uploadPickedMedia(file, handlers)` call becomes a {@link PendingUpload}.
 * `resolve()` REGISTERS the fake asset in the mock media registry (so the mock
 * `createPost` can resolve its `mediaId`, exactly as the real mock adapter does) and
 * resolves the upload; aborting the call's signal rejects it with an `AbortError`,
 * as the real client does.
 */

import type { Mock } from 'vitest'
import { registerMockMedia } from '@/core/media/mockMediaRegistry'
import type { MediaAssetView } from '@/core/media/types'
import type { UploadFlowHandlers } from '@/core/media/uploadMedia'

/** One `uploadPickedMedia` call awaiting the test's say-so. */
export interface PendingUpload {
  readonly file: File
  /** True once the call's `AbortSignal` has fired. */
  readonly aborted: boolean
  /** Reports a progress fraction through the call's `onProgress`. */
  progress(fraction: number): void
  /** Completes the upload; registers + returns the fake asset. */
  resolve(overrides?: Partial<MediaAssetView>): MediaAssetView
  /** Fails the upload with `error`. */
  fail(error: unknown): void
}

export interface FakeUploader {
  /** Every call so far, in order. */
  readonly pending: readonly PendingUpload[]
  /** The call for the file named `name` (throws if none — a test bug). */
  byName(name: string): PendingUpload
}

let assetSeq = 0

/** Wires `mock` as a controllable `uploadPickedMedia`. Call from `beforeEach`. */
export function installFakeUploader(
  mock: Mock<(file: File, handlers?: UploadFlowHandlers) => Promise<MediaAssetView>>,
): FakeUploader {
  const pending: PendingUpload[] = []

  mock.mockReset()
  mock.mockImplementation((file, handlers) => new Promise<MediaAssetView>((resolve, reject) => {
    let aborted = false
    const signal = handlers?.signal
    const onAbort = () => {
      aborted = true
      reject(new DOMException('The upload was cancelled.', 'AbortError'))
    }
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })

    pending.push({
      file,
      get aborted() {
        return aborted
      },
      progress: fraction => handlers?.onProgress?.(fraction),
      resolve: (overrides = {}) => {
        assetSeq += 1
        const kind = file.type.startsWith('video/') ? 'video' : 'image'
        const asset: MediaAssetView = {
          id: `mock-media-fake-${assetSeq}`,
          kind,
          url: `blob:fake-${assetSeq}`,
          ...(kind === 'image' ? { width: 1200, height: 800 } : { durationSec: 4 }),
          ...overrides,
        }
        registerMockMedia({
          ...asset,
          fileName: file.name,
          uploadedAtScenario: '2033-09-04T15:00:00.000Z',
        })
        resolve(asset)
        return asset
      },
      fail: error => reject(error),
    })
  }))

  return {
    pending,
    byName(name) {
      const found = pending.find(upload => upload.file.name === name)
      if (found === undefined) throw new Error(`no upload was started for ${name}`)
      return found
    },
  }
}

/** A tiny well-formed `File` of the given MIME type (a few bytes; size overridable). */
export function fakeFile(name: string, type: string, size?: number): File {
  const file = new File(['x'], name, { type })
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size })
  return file
}
