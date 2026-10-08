/**
 * features/social/components/Composer.tsx
 * ---------------------------------------------------------------------------
 * The inline (feed-top) Pulse "Social" post composer (feature: posts, story
 * 01 — "Post composition"; SOC-001, D1-R5 — and demo-polish F4, story 13
 * "Threads and composer"). Participant world (Pulse skin) — plain semantic
 * elements + the scoped `Composer.module.css` CSS Module, no COBRA, no themed
 * MUI, FontAwesome icons only.
 *
 * The X-familiarity target (D1): a text area, a photo/video attach affordance
 * with its tray, an X-style DEPLETING RING character counter, and a Post button.
 * All state + the publish machine live in `useComposePost()`
 * (`../hooks/useComposePost`). This file holds two components:
 *
 *   <ComposerForm/>   the VIEW of a compose session — shared with the thread's
 *                     `<ReplyComposer>` so the reply box and the post box are the
 *                     same control (same ring, same attach tray, same errors).
 *   <Composer/>       the inline top-level composer: `useComposePost()` +
 *                     `<ComposerForm/>`.
 *
 * D1-R5 counter: the ring depletes as characters are used; the numeric count
 * appears only at ≤20 remaining, goes amber in the low zone, and red when
 * over the limit — at which point Post is blocked. The count NUMBER carries
 * the state alongside the color, so the cue is never color-only (NFR-001).
 *
 * ATTACH (F4). The toolbar's button opens a multi-file picker for up to 4 photos
 * OR 1 video; the files upload as soon as they are picked and appear in the tray
 * (`ComposerMedia.tsx`) with a preview, a required description, a progress bar
 * and Cancel/Remove. Post stays disabled until every item is uploaded and
 * described, and a visible sentence says which of those is outstanding (a
 * disabled button is never left unexplained).
 *
 * A FAILED PUBLISH keeps the draft: an inline alert states what happened. A Retry
 * button is offered ONLY when the failure proves nothing was created ('failed':
 * network / 5xx / rate limit). After a server refusal ('refused', 4xx) a retry of the
 * same draft would be refused again, and after an unreadable 2xx ('unconfirmed') the
 * post may already exist and there is no idempotency key - so neither gets a Retry;
 * the draft and the message stay, and the author may press Post deliberately.
 *
 * KEYBOARD FOCUS (NFR-001). While a publish is in flight Post is `aria-disabled`
 * (not `disabled`), so the key the author just pressed keeps focus and a second
 * press is ignored; Retry hands focus to Post for the same reason; after a
 * successful publish focus moves to the text area (Post is disabled again with the
 * cleared draft, and focus must not fall to the page). Removing / cancelling a tray
 * row moves focus to a neighbouring row, or the attach button when none is left.
 *
 * BUSY IS ANNOUNCED, NOT JUST DRAWN (NFR-001). While a publish is in flight the fields
 * lock, the Post button's accessible name becomes "Posting..." ("Replying..." for the
 * reply box) next to its `aria-disabled`, and the polite status paragraph says the
 * same; when it lands the paragraph says "Post published.". The form deliberately does
 * NOT carry `aria-busy`: that tells assistive tech to suppress live-region updates
 * inside it, which would silence exactly these two announcements.
 *
 * OBSERVER MODE (COR-015 / D1-011): when the session is read-only the whole
 * composer is ABSENT — this component returns `null`, it does not render a
 * disabled form. A host should additionally only mount it when
 * `affordancesAvailable(variant)` is true (the shell contract); this internal
 * guard is belt-and-braces so the composer can never appear in a passive
 * session even if mis-mounted.
 *
 * CONTENT SECURITY (NFR-004): publishing sanitizes the body and every alt (in the
 * hook; the server sanitizes again). Nothing here uses `dangerouslySetInnerHTML`.
 *
 * SCOPE: inline composer only — the MODAL wrapper is F1's. Author-identity
 * rendering, the "Posting as" org chip, and quote-post stay out of scope.
 */

import { useEffect, useId, useRef, type FormEvent, type ReactNode, type Ref } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import {
  useComposePost,
  type UseComposePostOptions,
  type UseComposePostResult,
} from '../hooks/useComposePost'
import { AttachButton, ComposerMediaTray } from './ComposerMedia'
import styles from './Composer.module.css'

export interface ComposerProps {
  /** Per-exercise character limit; defaults to 280 (SOC-001). */
  charLimit?: number
  /** Called with the participant-safe view of the created post after a successful
   * publish (live mode too), so the host can react — close a modal, refresh a
   * list. The composer never touches the feed itself. */
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

  // COR-015 / D1-011: the composer is absent in a read-only session, never a
  // disabled form — a screen reader must not announce controls that can't be used.
  if (compose.isReadOnly) return null

  return (
    <ComposerForm
      compose={compose}
      testId="composer"
      textLabel="Post text"
      placeholder="What's happening?"
      submitLabel="Post"
      busyLabel="Posting…"
      postedNotice="Post published."
      showNoPersonaNote
    />
  )
}

export interface ComposerFormProps {
  /** The compose session this form is the view of. */
  readonly compose: UseComposePostResult
  /** `data-testid` of the `<form>` root. */
  readonly testId: string
  /** Accessible name of the text area. */
  readonly textLabel: string
  readonly placeholder: string
  /** Label of the submit button. */
  readonly submitLabel: string
  /**
   * The submit button's accessible name - and the polite status text - while a publish
   * is in flight ("Posting…" / "Replying…"), so the busy state is announced, not just
   * drawn.
   */
  readonly busyLabel: string
  /** Text of the polite status announced after a successful publish. */
  readonly postedNotice: string
  /** Optional line above the text area (the reply composer's "Replying to @handle"). */
  readonly header?: ReactNode
  /** A ref to the text area (the thread focuses it from a card's reply button). */
  readonly inputRef?: Ref<HTMLTextAreaElement>
  /** `id` of an element that describes the text area (the reply box's "Replying to" line). */
  readonly inputDescribedBy?: string
  /** Rows of the text area. */
  readonly rows?: number
  /** Show "Posting isn't available on this account." when the session has no persona. */
  readonly showNoPersonaNote?: boolean
}

/**
 * The compose form: text area, attach tray, ring counter, Post/Retry. Pure view
 * over a {@link UseComposePostResult}; renders even when `canPost` is false (the
 * host decides whether a persona-less session sees it at all).
 */
export function ComposerForm({
  compose,
  testId,
  textLabel,
  placeholder,
  submitLabel,
  busyLabel,
  postedNotice,
  header,
  inputRef,
  inputDescribedBy,
  rows = 3,
  showNoPersonaNote = false,
}: ComposerFormProps) {
  const hintId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const postButtonRef = useRef<HTMLButtonElement>(null)
  const attachButtonRef = useRef<HTMLButtonElement>(null)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // Post is aria-disabled (still focusable) while in flight: ignore the press.
    if (compose.isPublishing) return
    compose.publish()
  }

  // Retry unmounts its own alert as soon as the new attempt starts; hand focus to
  // Post (aria-disabled while in flight) first so it does not fall to the page.
  const handleRetry = () => {
    postButtonRef.current?.focus()
    compose.publish()
  }

  // After a successful publish Post is disabled again (the draft is cleared), which
  // would drop focus to the page: move it to the text area - but only if focus was
  // still in this form (or nowhere), never stealing it from where the author went.
  useEffect(() => {
    if (!compose.posted) return
    const form = formRef.current
    if (form === null) return
    const active = document.activeElement
    if (active === null || active === document.body || form.contains(active)) {
      form.querySelector<HTMLTextAreaElement>('textarea')?.focus()
    }
  }, [compose.posted])

  const hasHint = compose.mediaBlockReason !== undefined && compose.attachments.length > 0

  return (
    <form
      ref={formRef}
      className={styles.composer}
      data-testid={testId}
      onSubmit={handleSubmit}
    >
      {header}

      <textarea
        ref={inputRef}
        className={styles.input}
        value={compose.text}
        onChange={e => compose.setText(e.target.value)}
        placeholder={placeholder}
        aria-label={textLabel}
        aria-describedby={inputDescribedBy}
        readOnly={compose.isPublishing}
        rows={rows}
      />

      <ComposerMediaTray
        attachments={compose.attachments}
        disabled={compose.isPublishing}
        fallbackFocusRef={attachButtonRef}
        onAltChange={compose.setAttachmentAlt}
        onCancel={compose.cancelAttachment}
        onRemove={compose.removeAttachment}
      />

      {compose.mediaError !== undefined && (
        <p className={styles.error} role="alert">{compose.mediaError}</p>
      )}

      {compose.publishError !== undefined && (
        <div className={styles.publishError} role="alert" data-testid="composer-publish-error">
          <p className={styles.publishErrorText}>
            <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
            <span>{compose.publishError}</span>
          </p>
          {/* Retry only when nothing was created. After a refusal or an unreadable
              2xx a Retry would be refused again / could double-post (see header). */}
          {compose.publishErrorKind === 'failed' && (
            <button
              type="button"
              className={styles.retryButton}
              disabled={compose.isPublishing}
              onClick={handleRetry}
            >
              Retry
            </button>
          )}
        </div>
      )}

      <div className={styles.toolbar}>
        <div className={styles.tools}>
          <AttachButton
            buttonRef={attachButtonRef}
            onPick={compose.attachFiles}
            disabled={compose.isPublishing}
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
            ref={postButtonRef}
            type="submit"
            className={styles.postButton}
            disabled={!compose.canPublish && !compose.isPublishing}
            aria-disabled={compose.isPublishing ? true : undefined}
            aria-label={compose.isPublishing ? busyLabel : submitLabel}
            aria-describedby={hasHint ? hintId : undefined}
          >
            {compose.isPublishing ? busyLabel : submitLabel}
          </button>
        </div>
      </div>

      {/* Why Post is disabled, in words, when the cause is something the author
          can fix in the tray (uploading / failed / no description). */}
      {hasHint && <p id={hintId} className={styles.notice}>{compose.mediaBlockReason}</p>}

      {showNoPersonaNote && !compose.canPost && (
        <p className={styles.notice} role="note">Posting isn't available on this account.</p>
      )}

      {/* A polite, visually hidden status: "Posting…" while in flight, then the
          confirmation - the new post appearing is the sighted cue; this is the one
          for assistive tech. Always mounted, and NOT inside an aria-busy region, so
          each change is announced. */}
      <p className={styles.srOnly} role="status">
        {compose.isPublishing ? busyLabel : compose.posted ? postedNotice : ''}
      </p>
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
