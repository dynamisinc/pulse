/**
 * features/social/components/QuoteComposer.tsx
 * ---------------------------------------------------------------------------
 * The minimal inline quote-post commentary capture (Wave-S3.1 orchestrator
 * integration — feature: amplification, story 01 "Repost & quote-post";
 * SOC-020, NFR-004, NFR-001). `services/amplify.ts`'s `quotePost()` already
 * owns the sanitize + telemetry + record-shaping contract (a caller invokes
 * it via this component's `onSubmit`, never directly here) — this is ONLY
 * the free-text capture UI that story 01's AC ("quote-post it... with added
 * commentary") needed to become reachable end-to-end, since the shipped
 * `<Composer>` (posts/01) explicitly scopes quote-post OUT of its own build
 * ("quote-post... out of scope" — see that component's header). Deliberately
 * narrow: no character-limit ring, no media attach, no draft persistence —
 * those stay `<Composer>`'s territory should a full quote-composer story
 * land later.
 *
 * Participant world (Pulse Social skin): plain semantic elements + a scoped
 * CSS Module reading the SAME `--pc-*` tokens `PostCard`/`social.module.css`
 * declare — via the shared `.tokens` class (composed onto this form's root),
 * never a re-hardcoded hex palette — no COBRA, no themed MUI, no icons needed
 * here.
 *
 * CONTENT SECURITY (NFR-004): this component renders NOTHING back from the
 * typed text — it only forwards the raw string to `onSubmit`, which callers
 * wire to `amplify.quotePost()` (the actual sanitize boundary, applied once
 * on ingest). No `dangerouslySetInnerHTML` anywhere here.
 *
 * A11Y (NFR-001): a labelled `<textarea>` (`aria-label`, not a color/icon-only
 * cue), and Submit is disabled until the commentary has non-whitespace
 * content — the button's own `disabled` state (assistive-tech-visible) is
 * the signal, not a color change alone.
 */

import { useState, type FormEvent } from 'react'
import tokens from '../theme/social.module.css'
import styles from './QuoteComposer.module.css'

export interface QuoteComposerProps {
  /** The original post's author display name, for the accessible form label. */
  readonly authorName: string
  /** Fires with the raw (unsanitized) commentary on submit; the caller owns
   * the actual `amplify.quotePost()` call. */
  readonly onSubmit: (commentary: string) => void
  /** Fires when the composer is dismissed without posting. */
  readonly onCancel: () => void
}

export function QuoteComposer({ authorName, onSubmit, onCancel }: QuoteComposerProps) {
  const [commentary, setCommentary] = useState('')
  const canSubmit = commentary.trim().length > 0

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return
    onSubmit(commentary)
  }

  return (
    <form
      className={`${tokens.tokens} ${styles.quoteComposer}`}
      data-testid="quote-composer"
      aria-label={`Quote ${authorName}'s post`}
      onSubmit={handleSubmit}
    >
      <textarea
        className={styles.input}
        value={commentary}
        onChange={e => setCommentary(e.target.value)}
        placeholder="Add a comment"
        aria-label="Quote commentary"
        rows={2}
      />
      <div className={styles.actions}>
        <button type="button" className={styles.cancelButton} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={styles.submitButton} disabled={!canSubmit}>
          Quote
        </button>
      </div>
    </form>
  )
}
