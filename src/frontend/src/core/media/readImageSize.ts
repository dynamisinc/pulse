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
 * World-neutral (`core/`): no React, no theme.
 */

/** Natural pixel dimensions of an image. */
export interface ImageSize {
  readonly width: number
  readonly height: number
}

/** Resolves the file's natural size, or rejects when it cannot be decoded. */
export function readImageSize(file: File): Promise<ImageSize> {
  return new Promise<ImageSize>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()

    const release = () => {
      image.onload = null
      image.onerror = null
      URL.revokeObjectURL(objectUrl)
    }

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
