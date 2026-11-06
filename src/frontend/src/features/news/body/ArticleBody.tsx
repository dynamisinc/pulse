/**
 * features/news/body/ArticleBody.tsx
 * ---------------------------------------------------------------------------
 * Slot 7 of the article page: the rich body (news-network 06; NWS-010, NWS-015, NFR-001,
 * NFR-004, D3-P1 slot 7, D3-P2).
 *
 * SAFE BY CONSTRUCTION. `item.bodyHtml` (server-sanitized by story 01's `article-rich`
 * profile) reaches the DOM through F14's `SanitizedBody` ONLY, which runs one more
 * DOMPurify pass with the mirrored allowlist. Nothing in `features/news/**` writes HTML
 * any other way (`ArticleBody.static.test.ts`).
 *
 * WHAT THE BODY MAY HOLD, AND WHERE EACH PART RENDERS
 *  - Paragraphs, `h2`/`h3`, lists and links: F14's body typography, from skin variables
 *    (links underlined, never colour alone; the skin clamps link-on-bg to 4.5:1).
 *  - `blockquote.pull-quote` (with an optional `cite`): a real `<blockquote>`, styled by
 *    `PullQuote.module.css` from skin variables. It is not repeated or hidden, so a
 *    screen reader reads it once, in place.
 *  - `figure[data-media-id]`: `InlineFigure` (F14 `ContentMedia`) resolved against
 *    `item.media`; an unknown id renders nothing.
 *  - `<pulse-post data-id>`: `EmbeddedPost`, Social's own read-only card inside the brand
 *    reset (the outlet skin never reaches it).
 *
 * SKIN. Must render inside the outlet's `OutletSkinScope` (`useSkin()` fails closed).
 * Reads `media.captionStyle` and the optional `ext.news.dropCap` (boolean; absent or
 * unregistered = no drop cap). The measure is ~66ch on desktop; the body size is F13's
 * fixed `max(1rem, 16px)` floor.
 *
 * Presentational: the page (story 04) owns data, DOM order and telemetry wiring.
 *
 * World: participant. No COBRA, no MUI visuals.
 */

import { useCallback } from 'react'
import { SanitizedBody, useSkin, type ChannelContentDto } from '@/features/channels'
import { skinWantsDropCap } from './bodyModel'
import { EmbeddedPost } from './EmbeddedPost'
import { InlineFigure } from './InlineFigure'
import styles from './ArticleBody.module.css'
import pullQuoteStyles from './PullQuote.module.css'

export interface ArticleBodyProps {
  /** The article (only its body and media are read). */
  readonly item: Pick<ChannelContentDto, 'bodyHtml' | 'media'>
  /** High-risk article: inline media carry the EXERCISE chip (NFR-008). Default false. */
  readonly watermarkMedia?: boolean
  /** An embedded post was opened (story 19's `content_embed_open`, wired by 04). */
  readonly onEmbedOpen?: (postId: string) => void
  readonly className?: string
}

export function ArticleBody({
  item,
  watermarkMedia = false,
  onEmbedOpen,
  className,
}: ArticleBodyProps) {
  const { tokens } = useSkin()
  const captionStyle = tokens.media.captionStyle
  const dropCap = skinWantsDropCap(tokens.ext)
  const { media } = item

  const renderEmbeddedPost = useCallback(
    (postId: string) => <EmbeddedPost postId={postId} onOpen={onEmbedOpen} />,
    [onEmbedOpen],
  )
  const renderInlineMedia = useCallback(
    (mediaId: string, caption: string | null) => (
      <InlineFigure
        mediaId={mediaId}
        caption={caption}
        media={media}
        captionStyle={captionStyle}
        watermark={watermarkMedia}
      />
    ),
    [media, captionStyle, watermarkMedia],
  )

  const classes = [
    styles.articleBody,
    pullQuoteStyles.scope,
    dropCap ? styles.dropCap : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <div className={classes} data-testid="news-article-body" data-drop-cap={dropCap ? '' : undefined}>
      <SanitizedBody
        bodyHtml={item.bodyHtml}
        renderEmbeddedPost={renderEmbeddedPost}
        renderInlineMedia={renderInlineMedia}
      />
    </div>
  )
}
