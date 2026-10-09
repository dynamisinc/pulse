/**
 * features/controller/components/PersonaComposerPreview.tsx
 * ---------------------------------------------------------------------------
 * The "PREVIEW" frame of the post-as-persona composer (demo-polish C1, story 17
 * "Preview before Fire"; CTL-001, R-001/R-004, NFR-001, NFR-004). STAFF world
 * (COBRA), pure presentational - it takes the draft as props and reads no hook,
 * session or clock.
 *
 * WHAT IT IS: a labelled, bordered, MONOSPACED-meta mock-up of what the controller is
 * about to put into the fiction - author, text, media thumbnail / video poster and a
 * "Replying to" line, plus the staff-only starting engagement. It is deliberately NOT
 * a `PostCard` and shares nothing with the participant skin: a dashed square frame, a
 * "PREVIEW" label and a "STAFF VIEW - NOT SENT" tag, no avatar, no like / repost row.
 * Participant CONTENT shown inside staff CHROME must never be mistakable for a
 * participant card, and a controller must never think a preview has gone out.
 *
 * The text shown is the SANITIZED text (the same markup-stripping the ingest path
 * applies), so the preview does not promise HTML the server will strip. It is rendered
 * as a React text node - never as HTML. Thumbnails pass the shared media-URL
 * allow-list; a rejected or absent URL falls back to an icon. The R-003 origin line
 * (`SIMCELL - MANUAL`) and the POSTING AS chip are NOT part of the preview - they stay
 * where they were (the composer's origin line / the context panel).
 */

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faEye, faFilm, faImage } from '@fortawesome/free-solid-svg-icons'
import type { Persona } from '@/features/personas'
import type { EngagementBaseline, ReplyTarget } from '@/features/social'
import { formatMagnitude } from '@/features/social'
import { sanitizeText } from '@/features/social/services/sanitize'
import { safeImageUrl } from '@/features/social/utils/safeImageUrl'
import { effectiveAlt } from '../media/attachmentRules'
import type { TrayItem } from '../media/useAttachmentTray'
import styles from './PersonaComposer.module.css'

export interface PersonaComposerPreviewProps {
  /** The persona the post will come from. */
  persona: Persona
  /** The draft text, as typed. */
  text: string
  /** The attach tray's items (uploading / ready / failed all show; the Fire gate is elsewhere). */
  items: readonly TrayItem[]
  /** The reply target, when this is a reply. */
  replyTo?: ReplyTarget
  /** The parsed starting engagement, when one is set. */
  baseline?: EngagementBaseline
}

/** Strips a leading '@' so the handle can be rendered with exactly one. */
function bareHandle(handle: string): string {
  return handle.startsWith('@') ? handle.slice(1) : handle
}

/** The staff PREVIEW frame. See the module header. */
export function PersonaComposerPreview({
  persona,
  text,
  items,
  replyTo,
  baseline,
}: PersonaComposerPreviewProps) {
  const body = sanitizeText(text).trim()
  const isEmpty = body === '' && items.length === 0

  const engagement = [
    baseline?.like !== undefined ? `LIKE ${formatMagnitude(baseline.like)}` : undefined,
    baseline?.repost !== undefined ? `REPOST ${formatMagnitude(baseline.repost)}` : undefined,
    baseline?.reply !== undefined ? `REPLY ${formatMagnitude(baseline.reply)}` : undefined,
  ].filter((part): part is string => part !== undefined)

  return (
    <section
      className={styles.preview}
      aria-label="Post preview"
      data-testid="persona-preview"
    >
      <div className={styles.previewHeader}>
        <span className={styles.previewLabel}>
          <FontAwesomeIcon icon={faEye} aria-hidden="true" />
          PREVIEW
        </span>
        <span>STAFF VIEW - NOT SENT</span>
      </div>

      <dl className={styles.previewMeta}>
        <dt>AUTHOR</dt>
        <dd data-testid="preview-author">
          @{bareHandle(persona.handle)} ({persona.displayName})
        </dd>
        {replyTo !== undefined && (
          <>
            <dt>REPLYING TO</dt>
            <dd data-testid="preview-replying-to">@{bareHandle(replyTo.authorHandle)}</dd>
          </>
        )}
        {engagement.length > 0 && (
          <>
            <dt>START</dt>
            <dd data-testid="preview-engagement">{engagement.join(' | ')}</dd>
          </>
        )}
      </dl>

      {isEmpty && <p className={styles.previewEmpty}>Nothing to preview yet.</p>}
      {body !== '' && <p className={styles.previewText} data-testid="preview-text">{body}</p>}

      {items.length > 0 && (
        <ul className={styles.previewMedia} aria-label="Preview media">
          {items.map(item => {
            const isVideo = item.kind === 'video'
            const thumb = safeImageUrl(isVideo ? item.asset?.posterUrl : item.asset?.url)
            const alt = effectiveAlt(item.alt)
            return (
              <li key={item.key} className={styles.previewMediaItem} data-testid="preview-media">
                <span className={styles.previewThumb} aria-hidden="true">
                  {thumb !== undefined
                    ? <img src={thumb} alt="" draggable={false} />
                    : <FontAwesomeIcon icon={isVideo ? faFilm : faImage} />}
                </span>
                <span className={styles.previewAlt}>
                  <strong>{isVideo ? 'VIDEO' : 'IMAGE'}</strong>{' '}
                  {alt !== ''
                    ? alt
                    : <span className={styles.previewAltMissing}>ALT TEXT MISSING</span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
