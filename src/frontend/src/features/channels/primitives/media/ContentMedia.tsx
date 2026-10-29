/**
 * features/channels/primitives/media/ContentMedia.tsx
 * ---------------------------------------------------------------------------
 * One `ContentMediaDto`, rendered (channels-foundation 14; NWS-014, NWS-032, NFR-001,
 * NFR-004, NFR-008, D2-008, Q-03).
 *
 *  - `image`: an `<img>` in a box sized from the contract's width/height (no layout shift),
 *    with the shared `ExerciseBands` when the exercise requires them, and the caption.
 *  - `video`: the shared inline player from `@/core/media/player` (extracted from Social,
 *    news FU-9), which carries its own bands and fullscreens its WRAPPER, never the bare
 *    `<video>`.
 *  - `document`: a download link with its file name, nothing else (Q-03, Tom 10/29: PDFs
 *    are download-only in December; no inline viewer, no page count, press FU-7).
 *  - `watermark` (high-risk containers: a hero, a radar / cone image, a warning product)
 *    adds the bottom-right `WatermarkSlot` chip, lifted clear of a video's control row.
 *  - `alt` is required: a missing one becomes a non-empty placeholder and warns in dev.
 *  - Every URL passes `resolveSafeMediaUrl`; a rejected one shows the alt-text tile.
 *
 * Presentational only: no fetching, no skin ownership. Styled by skin CSS variables.
 */

import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFileArrowDown } from '@fortawesome/free-solid-svg-icons'
import { useCoarsePointer } from '@/core/hooks/useCoarsePointer'
import { usePrefersReducedMotion } from '@/core/hooks/usePrefersReducedMotion'
import {
  ExerciseBands,
  MediaFallbackTile,
  VideoPlayer,
  resolveSafeMediaUrl,
  singleMediaAspectRatio,
} from '@/core/media/player'
import type { ContentMediaDto } from '../../contract'
import { WatermarkSlot } from '../watermark/WatermarkSlot'
import {
  contentMediaAlt,
  documentFileName,
  documentTypeLabel,
  toPlayerMedia,
} from './contentMediaModel'
import styles from './ContentMedia.module.css'

export interface ContentMediaProps {
  readonly media: ContentMediaDto
  /** High-risk container: reserve and show the EXERCISE chip (NFR-008). */
  readonly watermark?: boolean
  /** Show the caption under an image / video. Default true. */
  readonly showCaption?: boolean
  /**
   * The video player's in-app fullscreen fallback (no native fullscreen, or the browser
   * took the bare `<video>`). Without it the player simply stays inline.
   */
  readonly onRequestVideoModal?: (trigger: HTMLElement, startAt?: number) => void
  readonly className?: string
}

export function ContentMedia({
  media,
  watermark = false,
  showCaption = true,
  onRequestVideoModal,
  className,
}: ContentMediaProps) {
  const coarse = useCoarsePointer()
  const alt = contentMediaAlt(media)
  const rootClass = [styles.root, className].filter(Boolean).join(' ')

  if (media.kind === 'document') {
    return (
      <div className={rootClass} data-testid="content-media" data-media-kind="document">
        <DocumentLink media={media} alt={alt} coarse={coarse} />
      </div>
    )
  }

  const caption = showCaption && media.caption ? media.caption : null

  return (
    <figure className={rootClass} data-testid="content-media" data-media-kind={media.kind}>
      {media.kind === 'video' ? (
        <div className={styles.frame}>
          <VideoPlayer media={toPlayerMedia(media, alt)} onRequestModal={onRequestVideoModal} />
          {watermark && <WatermarkSlot clearVideoControls />}
        </div>
      ) : (
        <ContentImage media={media} alt={alt} watermark={watermark} />
      )}
      {caption && <figcaption className={styles.caption}>{caption}</figcaption>}
    </figure>
  )
}

function ContentImage({
  media,
  alt,
  watermark,
}: {
  readonly media: ContentMediaDto
  readonly alt: string
  readonly watermark: boolean
}) {
  const reducedMotion = usePrefersReducedMotion()
  const [loaded, setLoaded] = useState(false)
  // The URL that failed (not a boolean), so a re-minted SAS URL retries.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const src = resolveSafeMediaUrl(media.url)
  const ratio = singleMediaAspectRatio(media.width ?? undefined, media.height ?? undefined)
  const failed = src === undefined || failedSrc === src

  return (
    <div className={styles.frame} style={{ aspectRatio: ratio }}>
      {failed ? (
        <MediaFallbackTile alt={alt} kind="image" />
      ) : (
        <>
          <img
            className={[
              styles.image,
              reducedMotion ? '' : styles.fade,
              loaded || reducedMotion ? styles.loaded : '',
            ].filter(Boolean).join(' ')}
            src={src}
            alt={alt}
            width={media.width ?? undefined}
            height={media.height ?? undefined}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailedSrc(src)}
          />
          <ExerciseBands />
        </>
      )}
      {watermark && <WatermarkSlot />}
    </div>
  )
}

function DocumentLink({
  media,
  alt,
  coarse,
}: {
  readonly media: ContentMediaDto
  readonly alt: string
  readonly coarse: boolean
}) {
  const href = resolveSafeMediaUrl(media.url)
  const fileName = documentFileName(media)
  const typeLabel = documentTypeLabel(media.contentType)
  const label = (
    <>
      <FontAwesomeIcon icon={faFileArrowDown} className={styles.docIcon} aria-hidden="true" />
      <span className={styles.docName}>{fileName}</span>
      {typeLabel !== '' && <span className={styles.docType}>{typeLabel}</span>}
    </>
  )

  if (href === undefined) {
    // An unsafe URL never becomes a link (NFR-004): show the name as plain text.
    return (
      <span className={styles.docUnavailable} data-testid="content-media-document-unavailable">
        {label}
        <span className={styles.srOnly}> (unavailable)</span>
      </span>
    )
  }

  return (
    <a
      className={coarse ? `${styles.docLink} ${styles.coarse}` : styles.docLink}
      href={href}
      download={fileName}
      aria-label={`Download ${alt === fileName ? fileName : `${alt} (${fileName})`}`}
      data-testid="content-media-document"
    >
      {label}
    </a>
  )
}
