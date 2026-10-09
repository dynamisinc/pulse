/**
 * features/social/components/post/PostHeader.tsx
 * ---------------------------------------------------------------------------
 * The card header: author identity (display name + verified mark + handle), the
 * "·" separator and the relative scenario-time stamp. One of the decomposed
 * `<PostCard>` parts (demo-polish F0). FROZEN after F0 (implementation.md §4.3).
 * Participant world — plain semantic elements + `PostHeader.module.css`.
 *
 * ANATOMY: avatar is the card's job; here: name + (VerifiedMark if verified) +
 * handle + "·" + relative time. NO platform-added editorial badges
 * ("OFFICIAL"/"BREAKING") are ever rendered (SOC-002) — the platform's only
 * credibility signal is the verified mark's presence or absence (SOC-052/D1-008);
 * a lookalike unverified persona renders a complete, plausible header with
 * simply no mark and no substitute label.
 *
 * SCENARIO TIME (COR-053): the relative "2h ago" string and the absolute tooltip
 * (`title`) both render via `useScenarioTime()` from `@/core/clock`, bound to
 * `useExerciseContext().timeZone`. Never wall-clock. The `<time dateTime>` is the
 * scenario instant itself.
 *
 * AUTHOR TAP-THROUGH (profiles-social-graph integration, SOC-050) —
 * `onOpenProfile`. The author identity sits in its own `.author` group, and when
 * — and ONLY when — a handler is supplied, a transparent overlay `<button>`
 * fills that group's box: the SAME "stretched-link" pattern `PostCard`'s
 * `.openTarget` uses for the card body, lifted above it (`z-index: 2`) so an
 * author tap reaches the author target and a tap anywhere else in the body still
 * reaches `.openTarget`. Consequences that made this the right shape rather than
 * "wrap the name in a `<button>`":
 *  - NO interactive element ever nests inside another (WR-001) — the overlays are
 *    SIBLINGS in different boxes, exactly like the hashtag anchors;
 *  - the identity text and the verified seal stay OUTSIDE any interactive
 *    ancestor, so the trust signal is never swallowed into a control's
 *    accessible name (SOC-052/D1-008) — the seal keeps its own
 *    `role="img"`/`<title>`, and the button carries an explicit
 *    `aria-label="View {displayName}'s profile"`;
 *  - the card's own thread-open target is NOT shadowed: the author overlay covers
 *    only the identity group, never the whole card.
 * Omitted ⇒ no button at all (WR-002: never a focusable no-op).
 *
 * DOM hooks (tests + e2e depend on them): `data-testid="post-author-target"` and
 * `data-persona-id` on the overlay.
 */

import type { MouseEvent } from 'react'
import type { Persona } from '@/features/personas'
import { useExerciseContext } from '@/core/exerciseContext'
import { useScenarioTime } from '@/core/clock'
import { VerifiedMark } from '../VerifiedMark'
import styles from './PostHeader.module.css'

export interface PostHeaderProps {
  readonly author: Persona
  /** Scenario-time ISO instant the post was published (COR-053). */
  readonly scenarioTime: string
  /** Fires with the AUTHOR's persona id; omit and the identity renders as inert text. */
  readonly onOpenProfile?: (personaId: string) => void
}

export function PostHeader({ author, scenarioTime, onOpenProfile }: PostHeaderProps) {
  const { timeZone } = useExerciseContext()
  const { format } = useScenarioTime(timeZone)

  const relativeTime = format(scenarioTime, { format: 'relative' })
  const absoluteTime = format(scenarioTime, { format: 'absolute' })

  /**
   * The author overlay's activation (SOC-050). It is a real `<button>` that is
   * NOT a descendant of the card's `.openTarget`, so the card's open handler could
   * never fire from it by bubbling anyway — `stopPropagation` matches the hashtag
   * anchors' belt-and-braces guarantee, so the invariant survives any future
   * restructuring that makes an ancestor clickable again.
   */
  const handleOpenProfile = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onOpenProfile?.(author.id)
  }

  return (
    <header className={styles.header}>
      {/*
        The author identity group. Its contents are NON-interactive; when
        `onOpenProfile` is supplied the transparent `.authorTarget` overlay below
        becomes the tap target for this box only (see the module header — sibling
        overlays, never nested interactives).
      */}
      <span className={styles.author}>
        {onOpenProfile && (
          <button
            type="button"
            className={styles.authorTarget}
            data-testid="post-author-target"
            data-persona-id={author.id}
            aria-label={`View ${author.displayName}'s profile`}
            onClick={handleOpenProfile}
          />
        )}
        <span className={styles.name}>{author.displayName}</span>
        {author.verified && (
          <span className={styles.verifiedMark}>
            <VerifiedMark />
          </span>
        )}
        <span className={styles.handle}>{`@${author.handle}`}</span>
      </span>
      <span className={styles.dot} aria-hidden="true">·</span>
      <time className={styles.time} dateTime={scenarioTime} title={absoluteTime}>
        {relativeTime}
      </time>
    </header>
  )
}
