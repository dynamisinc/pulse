/**
 * features/news/body/InlineFigure.tsx
 * ---------------------------------------------------------------------------
 * An inline image / video in an article body (news-network 06; NWS-010, NFR-008).
 *
 * A `<figure data-media-id>` placeholder resolves against `item.media` and renders the
 * shared F14 `ContentMedia`: an image with the shared `ExerciseBands`, or a video in the
 * shared inline player (`@/core/media/player`, the one news 05's hero uses; it carries its
 * own bands). With `watermark`, the EXERCISE chip too. The caption is the author's
 * `figcaption` when they wrote one, else the media's own, styled per
 * `skin.media.captionStyle`.
 *
 * An id that is not in `item.media` (or a document, which never sits inline) renders
 * NOTHING: never a broken image, never an orphan caption.
 *
 * World: participant. Styled by the outlet skin's variables only.
 */

import { ContentMedia, type CaptionStyle, type ContentMediaDto } from '@/features/channels'
import { findInlineMedia } from './bodyModel'
import styles from './InlineFigure.module.css'

export interface InlineFigureProps {
  readonly mediaId: string
  /** The author's `figcaption` text, or `null`. */
  readonly caption: string | null
  /** `item.media`. */
  readonly media: readonly ContentMediaDto[]
  readonly captionStyle: CaptionStyle
  /** High-risk article: show the EXERCISE chip on the media (NFR-008). */
  readonly watermark?: boolean
}

export function InlineFigure({
  mediaId,
  caption,
  media,
  captionStyle,
  watermark = false,
}: InlineFigureProps) {
  const item = findInlineMedia(media, mediaId)
  if (item === undefined) return null
  const shown = caption !== null ? { ...item, caption } : item
  return (
    <div className={styles.inline} data-caption-style={captionStyle} data-testid="news-inline-figure">
      <ContentMedia media={shown} watermark={watermark} />
    </div>
  )
}
