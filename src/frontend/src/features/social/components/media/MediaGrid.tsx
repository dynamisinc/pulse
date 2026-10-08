/**
 * features/social/components/media/MediaGrid.tsx
 * ---------------------------------------------------------------------------
 * The post's IMAGE grid (demo-polish F2; SOC-001, NFR-001, NFR-004). X-style
 * layouts for 1 / 2 / 3 / 4 images, 16 px outer radius:
 *
 *   1 image   the natural aspect clamped to 4:5 ... 16:9 (16:9 when the contract
 *             has no width/height) — so a portrait photo is tall, a panorama wide
 *   2 images  two equal columns
 *   3 images  one large tile on the left, two stacked on the right
 *   4 images  2 x 2
 *
 * The 2/3/4 layouts live in a fixed 16:9 frame (tiles are cropped with
 * `object-fit: cover`). In every layout the frame's aspect ratio is set from the
 * contract BEFORE any byte loads, so nothing shifts when the pictures arrive.
 *
 * EVERY `<img>` carries the contract's `alt` (never empty — `mediaAlt`), is
 * `loading="lazy"`, and sits inside a real `<button>` (when `onOpen` is wired)
 * whose accessible name is that alt; activating it asks the owner to open the
 * viewer. A tile with no usable URL (legacy `{kind, alt}` item, or a URL the
 * allow-list in `safeMediaUrl.ts` rejects) or whose `<img>` errors renders the
 * `MediaFallbackTile` (the alt text) instead — never a broken-image icon.
 *
 * STACKING (see `PostMediaSlot`): the slot's wrapper is `z-index: 2` above the
 * card's open-the-thread overlay, so the tile buttons are independently
 * clickable; `onClick` stops propagation so a tap never also opens the thread.
 * Non-interactive tiles are `pointer-events: none` and fall through to it.
 *
 * Pure presentation: it renders what it is given; the owner (`PostMediaSlot`)
 * holds the viewer state. Only the first four images are shown (contract: <=4).
 *
 * Participant world — CSS Module, no COBRA, no MUI.
 */

import { useState } from 'react'
import type { PostMedia } from '../../types/post'
import { MediaFallbackTile } from './MediaFallbackTile'
import { MAX_GRID_IMAGES, mediaAlt, singleMediaAspectRatio } from './mediaLayout'
import { resolveSafeMediaUrl } from './safeMediaUrl'
import styles from './MediaGrid.module.css'

export interface MediaGridProps {
  /** The post's images, in order (the slot passes images only). */
  readonly media: readonly PostMedia[]
  /**
   * Fires when an image tile is activated, with the item and the tile's DOM node
   * (the viewer returns focus to it on close). Omit and the tiles are inert images.
   */
  readonly onOpen?: (item: PostMedia, trigger: HTMLElement) => void
}

export function MediaGrid({ media, onOpen }: MediaGridProps) {
  // Which tiles' <img> errored (keyed so a re-render with the same items keeps the state).
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())

  const items = media.slice(0, MAX_GRID_IMAGES)
  const first = items[0]
  if (first === undefined) return null

  const count = items.length
  const frameStyle = count === 1
    ? { aspectRatio: singleMediaAspectRatio(first.width, first.height) }
    : undefined

  return (
    <div
      className={`${styles.grid} ${styles[`grid${count}`] ?? ''}`}
      data-testid="media-grid"
      data-count={count}
      style={frameStyle}
    >
      {items.map((item, index) => {
        const tileKey = `${item.id}:${index}`
        const alt = mediaAlt(item)
        const src = resolveSafeMediaUrl(item.url)

        if (src === undefined || failed.has(tileKey)) {
          return (
            <div key={tileKey} className={styles.cell}>
              <MediaFallbackTile alt={alt} />
            </div>
          )
        }

        const image = (
          <img
            className={styles.image}
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailed(previous => new Set(previous).add(tileKey))}
          />
        )

        if (onOpen === undefined) {
          return (
            <div key={tileKey} className={styles.cell}>
              {image}
            </div>
          )
        }

        return (
          <button
            key={tileKey}
            type="button"
            className={`${styles.cell} ${styles.tile}`}
            aria-haspopup="dialog"
            data-testid="media-tile"
            onClick={event => {
              event.stopPropagation()
              onOpen(item, event.currentTarget)
            }}
          >
            {image}
          </button>
        )
      })}
    </div>
  )
}
