/**
 * core/media/readImageSize.ts
 * ---------------------------------------------------------------------------
 * Reads an image file's natural pixel size in the browser (demo-polish F0).
 * The upload sends it as a hint (`width`/`height`, validated 1..16384
 * server-side) so a post's media grid can reserve the right aspect ratio before
 * the bytes arrive — no layout jump (F2's `MediaGrid`).
 *
 * Decodes via an `<img>` fed by a TEMPORARY object URL, which is revoked as soon
 * as the size is known. (This is unrelated to the long-lived object URLs the
 * mock upload adapter hands out — those are never revoked.) Rejects when the
 * browser cannot decode the file; callers treat the size as a best-effort hint.
 *
 * ABORTABLE: it honours an `AbortSignal` (the upload's), mirroring
 * `captureVideoPoster`. A cancelled or superseded upload must not leave the
 * promise pending and the object URL alive until the browser eventually fires
 * load/error, so an abort rejects with the module's `AbortError` and releases the
 * handlers + revokes the URL immediately; an already-aborted signal rejects up
 * front without creating a URL; the abort listener is removed on normal
 * completion.
 *
 * World-neutral (`core/`): no React, no theme.
 */

import { createAbortError } from './mediaErrors'

/** Natural pixel dimensions of an image. */
export interface ImageSize {
  readonly width: number
  readonly height: number
}

/** Options for {@link readImageSize}. */
export interface ReadImageSizeOptions {
  /** Aborting rejects with an `AbortError` and releases the handlers + object URL at once. */
  readonly signal?: AbortSignal
}

/**
 * Resolves the file's natural size, or rejects when it cannot be decoded or the
 * signal aborts (an `AbortError`, see the module header). Settles at most once;
 * the abort listener, the handlers and the temporary object URL are released on
 * every path.
 */
export function readImageSize(file: File, options: ReadImageSizeOptions = {}): Promise<ImageSize> {
  const { signal } = options

  return new Promise<ImageSize>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError())
      return
    }

    const objectUrl = URL.createObjectURL(file)
    const image = new Image()

    const release = () => {
      signal?.removeEventListener('abort', onAbort)
      image.onload = null
      image.onerror = null
      URL.revokeObjectURL(objectUrl)
    }
    // After this the load/error handlers are null, so nothing can settle twice.
    function onAbort() {
      release()
      reject(createAbortError())
    }

    signal?.addEventListener('abort', onAbort, { once: true })

    image.onload = () => {
      const width = image.naturalWidth
      const height = image.naturalHeight
      release()
      if (width > 0 && height > 0) {
        resolve({ width, height })
      } else {
        reject(new Error('That image has no readable size.'))
      }
    }
    image.onerror = () => {
      release()
      reject(new Error('That image could not be read.'))
    }

    image.src = objectUrl
  })
}
