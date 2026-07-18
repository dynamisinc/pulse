/**
 * features/social/components/Composer.tsx
 * ---------------------------------------------------------------------------
 * The inline (feed-top) Pulse "Social" post composer (feature: posts, story
 * 01 — "Post composition"; SOC-001, D1-R5). Participant world (Pulse skin) —
 * plain semantic elements + the scoped `Composer.module.css` CSS Module, no
 * COBRA, no themed MUI, FontAwesome icons only.
 *
 * The X-familiarity target (D1): a text area, a photo-attach affordance, an
 * optional location tag, an X-style DEPLETING RING character counter, and a
 * Post button. All state + the publish machine live in `useComposePost()`
 * (`../hooks/useComposePost`) — this component is the view.
 *
 * D1-R5 counter: the ring depletes as characters are used; the numeric count
 * appears only at ≤20 remaining, goes amber in the low zone, and red when
 * over the limit — at which point Post is blocked. The count NUMBER carries
 * the state alongside the color, so the cue is never color-only (NFR-001).
 *
 * OBSERVER MODE (COR-015 / D1-011): when the session is read-only the whole
 * composer is ABSENT — this component returns `null`, it does not render a
 * disabled form. A host should additionally only mount it when
 * `affordancesAvailable(variant)` is true (the shell contract); this internal
 * guard is belt-and-braces so the composer can never appear in a passive
 * session even if mis-mounted.
 *
 * CONTENT SECURITY (NFR-004): publishing routes through `createPost` (via the
 * hook), which sanitizes the text. Nothing here uses `dangerouslySetInnerHTML`.
 *
 * SCOPE (S2): inline composer only. A MODAL composer variant is a documented
 * follow-up (D1) and is NOT built here. Author-identity rendering, the
 * "Posting as" org chip, quote-post, and rich-media states are out of scope.
 */

import { useId, useRef, type ChangeEvent, type FormEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faImage, faLocationDot, faXmark } from '@fortawesome/free-solid-svg-icons'
import { useComposePost, type UseComposePostOptions } from '../hooks/useComposePost'
import styles from './Composer.module.css'

export interface ComposerProps {
  /** Per-exercise character limit; defaults to 280 (SOC-001). */
  charLimit?: number
  /** Called with the created post after a successful publish, so the host can
   * refresh the feed. The composer never touches the feed itself. */
  onPosted?: UseComposePostOptions['onPosted']
}

/** Ring geometry (a 30px SVG box; the arc depletes from the top, clockwise). */
const RING_SIZE = 30
const RING_STROKE = 2.5
const RING_RADIUS = RING_SIZE / 2 - RING_STROKE
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

export function Composer({ charLimit, onPosted }: ComposerProps) {
  const compose = useComposePost({
    ...(charLimit !== undefined ? { charLimit } : {}),
    ...(onPosted !== undefined ? { onPosted } : {}),
  })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const locationId = useId()

  // COR-015 / D1-011: the composer is absent in a read-only session, never a
  // disabled form — a screen reader must not announce controls that can't be used.
  if (compose.isReadOnly) return null

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    compose.publish()
  }

  const handleFilesPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (files && files.length > 0) {
      compose.attachImages(Array.from(files))
    }
    // Reset so re-picking the same file still fires a change event.
    event.target.value = ''
  }

  return (
    <form className={styles.composer} data-testid="composer" onSubmit={handleSubmit}>
      <textarea
        className={styles.input}
        value={compose.text}
        onChange={e => compose.setText(e.target.value)}
        placeholder="What's happening?"
        aria-label="Post text"
        rows={3}
      />

      {compose.media.length > 0 && (
        <ul className={styles.mediaList} data-testid="composer-media">
          {compose.media.map((item, index) => (
            <li key={`${item.alt}-${index}`} className={styles.mediaChip}>
              <span className={styles.mediaLabel}>{item.alt}</span>
              <button
                type="button"
                className={styles.mediaRemove}
                onClick={() => compose.removeMedia(index)}
                aria-label={`Remove ${item.alt}`}
              >
                <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {compose.mediaError !== undefined && (
        <p className={styles.error} role="alert">{compose.mediaError}</p>
      )}

      <div className={styles.locationRow}>
        <FontAwesomeIcon icon={faLocationDot} aria-hidden="true" className={styles.locationIcon} />
        <input
          id={locationId}
          className={styles.locationInput}
          type="text"
          value={compose.location}
          onChange={e => compose.setLocation(e.target.value)}
          placeholder="Add location"
          aria-label="Location"
        />
      </div>

      <div className={styles.toolbar}>
        <div className={styles.tools}>
          <button
            type="button"
            className={styles.toolButton}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Add photos"
          >
            <FontAwesomeIcon icon={faImage} aria-hidden="true" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            data-testid="composer-file-input"
            onChange={handleFilesPicked}
          />
        </div>

        <div className={styles.meta}>
          <CharRing
            length={compose.length}
            charLimit={compose.charLimit}
            remaining={compose.remaining}
            showCount={compose.showCount}
            isLow={compose.isLow}
            isOverLimit={compose.isOverLimit}
          />
          <button
            type="submit"
            className={styles.postButton}
            disabled={!compose.canPublish}
            aria-label="Post"
          >
            Post
          </button>
        </div>
      </div>

      {!compose.canPost && (
        <p className={styles.notice} role="note">Posting isn't available on this account.</p>
      )}
    </form>
  )
}

interface CharRingProps {
  length: number
  charLimit: number
  remaining: number
  showCount: boolean
  isLow: boolean
  isOverLimit: boolean
}

/**
 * The X-style depleting ring counter (D1-R5). The arc shrinks as characters
 * are used; the numeric remaining-count appears at ≤20 remaining and turns
 * amber (low) / red (over). The count number is the non-color cue (NFR-001),
 * and the whole widget exposes an accessible remaining-character status.
 */
function CharRing({ length, charLimit, remaining, showCount, isLow, isOverLimit }: CharRingProps) {
  // Fraction of the limit consumed, clamped to [0, 1]; the drawn arc = the
  // remainder, so the ring visibly DEPLETES as the text grows.
  const progress = Math.min(length / charLimit, 1)
  const dashOffset = RING_CIRCUMFERENCE * progress

  const progressClass = isOverLimit
    ? styles.ringProgressOver
    : isLow
      ? styles.ringProgressLow
      : styles.ringProgress
  const countClass = isOverLimit
    ? `${styles.count} ${styles.countOver}`
    : isLow
      ? `${styles.count} ${styles.countLow}`
      : styles.count

  const status = isOverLimit
    ? `${Math.abs(remaining)} characters over the limit`
    : `${remaining} characters remaining`
  // A non-color, DOM-observable state cue (NFR-001) — the count number and this
  // attribute carry the state, so the ring color is never the only signal.
  const state = isOverLimit ? 'over' : isLow ? 'low' : 'normal'

  return (
    <span
      className={styles.ring}
      data-testid="char-ring"
      data-state={state}
      role="status"
      aria-live="polite"
      aria-label={status}
    >
      <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true">
        <circle
          className={styles.ringTrack}
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE}
        />
        <circle
          className={progressClass}
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      </svg>
      {showCount && (
        <span className={countClass} data-testid="char-count" aria-hidden="true">
          {remaining}
        </span>
      )}
    </span>
  )
}
