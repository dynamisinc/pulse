/**
 * features/controller/report/components/ReportPostCard.tsx
 * ---------------------------------------------------------------------------
 * One post in the printed record (story 29): time (+ inject ref), avatar (image or initials),
 * name, handle, VERIFIED / UNVERIFIED chip, "Replying to", the text, media, shown counts and the
 * provenance tags (source, edited, taken down). Staff-world provenance: none of it reaches a
 * participant.
 *
 * SAFETY. The post text and every name render as React text children: plain text, never HTML
 * (NFR-004). Labels are words, never color-only (NFR-001). `break-inside: avoid` (in the CSS)
 * keeps a post on one page. Images are plain `<img loading="eager">` so printing waits for
 * nothing extra.
 *
 * THREADS (DF-47). A `nested` post prints indented with a left rule under its thread root (one
 * level at any depth). The words "Replying to @x" stay, so the structure is in text too (NFR-001).
 *
 * MEDIA. Image: the picture plus its alt text printed under an ALT TEXT label. Video: the poster
 * with a VIDEO label, a play glyph and the m:ss duration; a poster-less video is a plain tile
 * with the same label and duration. Every item prints its alt text.
 */

import {
  avatarColor,
  formatDuration,
  initialsOf,
  formatStamp,
  refLabel,
  sourceLabel,
} from '../services/reportFormat'
import type { ReportMedia, ReportPost } from '../types/report'
import styles from './report.module.css'

const SOURCE_SWATCH: Record<ReportPost['source'], string> = {
  participant: styles.pt ?? '',
  'controller-as-persona': styles.pt ?? '',
  scripted: styles.scr ?? '',
  engine: styles.eng ?? '',
  noise: styles.noise ?? '',
}

interface MediaItemProps {
  readonly item: ReportMedia
  readonly captionId: string
}

function MediaItem({ item, captionId }: MediaItemProps) {
  const isVideo = item.kind === 'video'
  const hasAlt = item.alt.trim().length > 0
  return (
    <figure className={styles.photo} data-testid="report-media">
      {item.url !== null ? (
        <div className={styles.frame}>
          {/* The visible ALT TEXT caption carries the text; the image points at it. */}
          <img
            src={item.url}
            alt={hasAlt ? '' : 'Image without alt text'}
            aria-describedby={hasAlt ? captionId : undefined}
            loading="eager"
          />
          {isVideo && <span className={`${styles.badge} ${styles.kind}`}>VIDEO</span>}
          {isVideo && <span className={styles.play} aria-hidden="true" />}
          {isVideo && item.durationSec !== null && (
            <span className={`${styles.badge} ${styles.dur}`}>{formatDuration(item.durationSec)}</span>
          )}
        </div>
      ) : (
        <div className={`${styles.frame} ${styles.plain}`} data-testid="report-media-tile">
          <span>{isVideo ? 'No poster image' : 'Image not available'}</span>
          {isVideo && <span className={`${styles.badge} ${styles.kind}`}>VIDEO</span>}
          {isVideo && item.durationSec !== null && (
            <span className={`${styles.badge} ${styles.dur}`}>{formatDuration(item.durationSec)}</span>
          )}
        </div>
      )}
      <figcaption id={captionId}>
        <b>ALT TEXT</b>
        {hasAlt ? item.alt : 'No alt text was provided.'}
      </figcaption>
    </figure>
  )
}

export interface ReportPostCardProps {
  readonly post: ReportPost
  /** DF-47: a reply printed under its listed thread root: one indent level with a left rule. */
  readonly nested?: boolean
  /** Story 31: "Edited · last at" / "Taken down at" carry their date when the report spans days. */
  readonly spansMultipleDays?: boolean
}

export function ReportPostCard({
  post,
  nested = false,
  spansMultipleDays = false,
}: ReportPostCardProps) {
  const { author } = post
  const mediaItems = post.media.map((item, index) => (
    <MediaItem key={`${post.id}-${index}`} item={item} captionId={`alt-${post.id}-${index}`} />
  ))
  const takenDown = post.takenDownAt !== null
  const participantish = post.source === 'participant' || post.source === 'controller-as-persona'
  return (
    <article
      className={`${styles.post} ${takenDown ? styles.taken : ''} ${nested ? styles.nested : ''}`}
      data-testid="report-post"
      data-nested={nested ? 'true' : undefined}
    >
      <div className={styles.time}>
        {post.scenarioTime}
        {post.injectRef !== null && <small>{`Inject ${refLabel(post.injectRef)}`}</small>}
      </div>
      {author.avatarUrl !== null ? (
        <div className={styles.av}>
          <img className={styles.avImg} src={author.avatarUrl} alt="" loading="eager" />
        </div>
      ) : (
        <div className={styles.av} style={{ background: avatarColor(author.handle) }} aria-hidden="true">
          {initialsOf(author.displayName)}
        </div>
      )}
      <div className={styles.body}>
        <div className={styles.who}>
          <strong>{author.displayName}</strong>
          <span className={styles.handle}>{author.handle}</span>
          {author.verified
            ? <span className={styles.ver}>VERIFIED</span>
            : <span className={styles.unver}>UNVERIFIED</span>}
        </div>
        {post.replyToHandle !== null && (
          <div className={styles.replyto}>{`Replying to ${post.replyToHandle}`}</div>
        )}
        <p className={styles.text}>{post.text}</p>
        {post.media.length > 1 ? (
          // 2 items side by side, 3 or 4 in a 2x2 grid: keeps a post on one Letter page.
          <div className={styles.mediaGrid} data-testid="report-media-grid">
            {mediaItems}
          </div>
        ) : mediaItems}
        <div className={styles.engagement}>
          <span>{`${post.likes.toLocaleString('en-US')} ${post.likes === 1 ? 'like' : 'likes'}`}</span>
          <span>{`${post.reposts.toLocaleString('en-US')} ${post.reposts === 1 ? 'repost' : 'reposts'}`}</span>
          <span>{`${post.replies.toLocaleString('en-US')} ${post.replies === 1 ? 'reply' : 'replies'}`}</span>
        </div>
        <div className={styles.tags}>
          <span className={`${styles.tag} ${participantish ? styles.tagPt : ''}`}>
            <i className={`${styles.sw} ${SOURCE_SWATCH[post.source]}`} aria-hidden="true" />
            {sourceLabel(post.source, post.postedBy)}
          </span>
          {post.editCount !== null && post.editCount > 0 && (
            <span className={`${styles.tag} ${styles.tagEdited}`}>
              {post.lastEditedAt !== null
                ? `Edited ${post.editCount}× · last at ${formatStamp(post.lastEditedAt, spansMultipleDays)}`
                : `Edited ${post.editCount}×`}
            </span>
          )}
          {post.takenDownAt !== null && (
            <span className={`${styles.tag} ${styles.tagDown}`}>
              {`Taken down at ${formatStamp(post.takenDownAt, spansMultipleDays)}`}
            </span>
          )}
        </div>
      </div>
    </article>
  )
}
