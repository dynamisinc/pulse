/**
 * features/social/components/media/MediaViewer.tsx
 * ---------------------------------------------------------------------------
 * The lightbox (demo-polish F2; SOC-001, NFR-001). Activating a photo in a post
 * opens it large; a video whose browser has no native fullscreen opens here too.
 *
 *   role="dialog" aria-modal="true"  (portalled to <body>)
 *     stage     the current image (or the expanded VideoPlayer)
 *     toolbar   [x Close]                         [<] 2 / 4 [>]
 *     status    polite live region: "Image 2 of 4: <alt>"
 *
 * KEYBOARD / FOCUS (NFR-001)
 *  - Focus is TRAPPED (`useFocusTrap`): Tab/Shift+Tab cycle inside, focus moves
 *    into the dialog on open and RETURNS to the thumbnail (`returnFocusTo`) on close.
 *  - Esc closes. ←/→ move across the post's images (no wrap; the buttons also
 *    work, and use `aria-disabled` rather than `disabled` at the ends so focus is
 *    never dropped out of the trap). A player inside handles its own ←/→ (seek)
 *    and stops them, so they never also page.
 *  - Clicking the dimmed area outside the media closes it.
 *  - Alt text reaches assistive tech three ways: it is the image's `alt`; the live
 *    region announces it as the user pages; and the dialog is `aria-describedby` that
 *    same status line, so it is read when the viewer OPENS (a live region present at
 *    mount is not announced on its own).
 *
 * STACKING — deliberately NOT above the shell. The viewer is portalled to
 * `<body>` (a `position: fixed` element inside a feed card would be broken by the
 * focused-thread card's `transform`), but its z-index is `SHELL_Z.alertBar - 1`:
 * ABOVE the channel content and nav, BELOW the persistent alert bar (PRT-010), the
 * pause/EndEx overlay and the compliance-chrome banners, which must never be
 * covered. It is inset by the published `--pulse-chrome-top/bottom` so it never
 * sits under the banners; the controls live in a BOTTOM toolbar so a visible
 * alert bar (fixed under the top banner) can never cover Close.
 *
 * Body scroll is locked while open and restored on close. Participant world:
 * CSS Module, FontAwesome icons, no COBRA, no MUI. Reads only contract URLs
 * (through `safeMediaUrl`); an unsafe one shows the alt-text placeholder.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronLeft, faChevronRight, faXmark } from '@fortawesome/free-solid-svg-icons'
import { SHELL_Z } from '@/features/participant-shell/mountContract'
import type { PostMedia } from '../../types/post'
import { MediaFallbackTile } from './MediaFallbackTile'
import { mediaAlt } from './mediaLayout'
import { resolveSafeMediaUrl } from './safeMediaUrl'
import { useFocusTrap } from './useFocusTrap'
import { VideoPlayer } from './VideoPlayer'
import styles from './MediaViewer.module.css'

/** Above content + channel nav; below the alert bar, the overlay layer and the chrome banners. */
const VIEWER_Z_INDEX = SHELL_Z.alertBar - 1

export interface MediaViewerProps {
  /** What to page through (the post's openable images, or one video). */
  readonly items: readonly PostMedia[]
  /** The item to open on. Clamped into range. */
  readonly startIndex?: number
  /** Close request (Esc, Close, backdrop). The owner unmounts the viewer. */
  readonly onClose: () => void
  /** Where focus returns on close (the thumbnail the user activated). */
  readonly returnFocusTo?: HTMLElement | null
  /** For a video opened from the inline player's fallback: resume at this position (seconds). */
  readonly startAt?: number
}

/** One image in the stage; a load error swaps in the alt-text placeholder. */
function ViewerImage({ item }: { readonly item: PostMedia }) {
  // Keyed by the URL that failed: a re-minted URL for the same item retries.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const alt = mediaAlt(item)
  const src = resolveSafeMediaUrl(item.url)

  if (src === undefined || failedSrc === src) {
    return (
      <div className={styles.fallbackBox}>
        <MediaFallbackTile alt={alt} />
      </div>
    )
  }
  return (
    <img
      className={styles.image}
      src={src}
      alt={alt}
      decoding="async"
      draggable={false}
      onError={() => setFailedSrc(src)}
    />
  )
}

export function MediaViewer({
  items,
  startIndex = 0,
  onClose,
  returnFocusTo,
  startAt,
}: MediaViewerProps) {
  const lastIndex = Math.max(0, items.length - 1)
  const [index, setIndex] = useState(() => Math.min(Math.max(0, startIndex), lastIndex))
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const labelId = useId()
  const statusId = useId()

  useFocusTrap(dialogRef, { returnFocusTo })

  const current = items[Math.min(index, lastIndex)]
  const total = items.length
  const hasPrevious = index > 0
  const hasNext = index < lastIndex

  const go = useCallback((delta: number) => {
    setIndex(previous => Math.min(lastIndex, Math.max(0, previous + delta)))
  }, [lastIndex])

  // Lock page scroll while open; restore the previous value on close.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  // Esc closes; ←/→ page. Document-level so it works wherever focus sits inside the trap.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        // The native <video> uses the arrows to seek while it has focus.
        if (event.target instanceof HTMLVideoElement) return
        event.preventDefault()
        go(event.key === 'ArrowLeft' ? -1 : 1)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [go, onClose])

  if (current === undefined) return null

  const alt = mediaAlt(current)
  const kindLabel = current.kind === 'video' ? 'Video' : 'Image'

  // A click on the dimmed area (the dialog shell or the stage itself) — not on the media — closes.
  const handleBackdropClick = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation()
    if (event.target === event.currentTarget || event.target === stageRef.current) onClose()
  }

  const style: CSSProperties = { zIndex: VIEWER_Z_INDEX }

  return createPortal(
    <div
      ref={dialogRef}
      className={styles.viewer}
      style={style}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      aria-describedby={statusId}
      tabIndex={-1}
      data-testid="media-viewer"
      onClick={handleBackdropClick}
    >
      <h2 id={labelId} className={styles.srOnly}>Media viewer</h2>

      <div ref={stageRef} className={styles.stage}>
        {current.kind === 'video' ? (
          <VideoPlayer
            key={`${current.id}-${index}`}
            media={current}
            variant="expanded"
            startAt={startAt}
          />
        ) : (
          <ViewerImage key={`${current.id}-${index}`} item={current} />
        )}
      </div>

      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.closeButton}
          data-testid="media-viewer-close"
          onClick={onClose}
        >
          <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
          <span>Close</span>
        </button>

        {total > 1 && (
          <div className={styles.pager}>
            <button
              type="button"
              className={styles.navButton}
              aria-label="Previous image"
              aria-disabled={!hasPrevious}
              data-testid="media-viewer-prev"
              onClick={() => {
                if (hasPrevious) go(-1)
              }}
            >
              <FontAwesomeIcon icon={faChevronLeft} aria-hidden="true" />
            </button>
            <span className={styles.counter} aria-hidden="true">{index + 1} / {total}</span>
            <button
              type="button"
              className={styles.navButton}
              aria-label="Next image"
              aria-disabled={!hasNext}
              data-testid="media-viewer-next"
              onClick={() => {
                if (hasNext) go(1)
              }}
            >
              <FontAwesomeIcon icon={faChevronRight} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* Announces the item as the user pages (polite: it never interrupts). */}
      <p id={statusId} className={styles.srOnly} role="status" data-testid="media-viewer-status">
        {`${kindLabel} ${index + 1} of ${total}: ${alt}`}
      </p>
    </div>,
    document.body,
  )
}
