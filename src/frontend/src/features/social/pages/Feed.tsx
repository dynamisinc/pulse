/**
 * features/social/pages/Feed.tsx
 * ---------------------------------------------------------------------------
 * The All Posts feed — the PILOT participant landing surface (feature:
 * feeds-discovery, story 01; SOC-080, COR-001/015, COR-053, XC-004,
 * NFR-001/002, SOC-071). Participant world (Pulse Social skin): plain semantic
 * elements + a scoped CSS Module — NO COBRA, NO themed MUI, FontAwesome-only if
 * icons are ever needed here.
 *
 * WHAT IT DOES
 *  - Renders the exercise's public posts, newest-first, each via the keystone
 *    `<PostCard>` (`@/features/social`). The chronological convergence
 *    (post → participant-safe view → resolved author → `PostView`, sorted) is
 *    owned by `useFeed()`/`feedService` — this page is the presentation layer.
 *  - It is the DEFAULT landing feed: All Posts is the only feed in S2 (no
 *    Following/For-You/PIO tabs — out of scope), so mounting it IS the default;
 *    a read-only session lands here too.
 *
 * VARIANT (COR-015 / D1-011): the shell mount variant is read via
 * `useShellContext()`; each card gets `variant = affordancesAvailable(variant)
 * ? 'full' : 'readOnly'`, so an observer session's cards render the counts as
 * inert text with the interactive controls ABSENT (not disabled). Thread
 * navigation is threaded in by the shell channel (`SocialChannel`) via the
 * optional `onOpenThread` prop — passed to each card's body-open AND reply
 * affordance (SOC-011); an observer can still open a thread (a read action),
 * only the write affordances are absent.
 *
 * SCENARIO TIME (COR-053): this page renders no timestamp itself — each
 * `<PostCard>` self-renders its own relative "2h ago" via `useScenarioTime()`,
 * so the feed keeps ONE scenario "now" per pass without this page threading it.
 *
 * BURST STRATEGY (NFR-002 / SOC-071 — the feed IS the burst surface): the list
 * uses stable `post.id` keys and a `React.memo`'d row (`FeedRow`), so at
 * 120 posts/min an unchanged row does not re-render when the page re-renders
 * (e.g. a future new-post arrival, or the mount-once telemetry effect). Row
 * props stay referentially stable because `useFeed` memoizes the mapped views.
 * The list is a flat `<ul>`; a virtualization/windowing layer can wrap
 * `views.map(...)` later WITHOUT reshaping the data flow (no dependency added
 * for the ~6 seeded posts).
 *
 * A11Y (NFR-001): the post list lives in an `aria-live="polite"` region — the
 * seam story 04's "new posts" pill announces into (polite, never auto-scroll /
 * live-insert). A single landmark + heading gives sane structure and focus
 * order; no state is conveyed by color alone.
 *
 * TELEMETRY (XC-004): emits exactly ONE `'view'` event on first mount via the
 * caller-safe `buildAndEmit` (guarded by a ref so a re-render / StrictMode
 * double-invoke can't re-emit). `actor.participantId` is the session
 * `accountId` (present for read-only sessions too — satisfies the view
 * superRefine, COR-015). `scenarioTime` is scenario `now`; `wallClockTime` is
 * the telemetry-only wall clock (never rendered).
 */

import { memo, useEffect, useRef } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'
import { useSession } from '@/core/auth'
import { scenarioNow } from '@/core/clock'
import { wallClockNowIso } from '@/core/time/wallClock'
import { buildAndEmit } from '@/core/telemetry'
import { PostCard, type PostView } from '@/features/social'
import {
  useShellContext,
  affordancesAvailable,
} from '@/features/participant-shell/mountContract'
import { useFeed } from '../hooks/useFeed'
import styles from './Feed.module.css'

type CardVariant = 'full' | 'readOnly'

interface FeedRowProps {
  post: PostView
  variant: CardVariant
  /** Opens this post's flattened thread; supplied by the shell channel. Stable
   * identity (a `useCallback`), so the memoized row still skips re-render under
   * burst (NFR-002/SOC-071) even though a function prop is threaded through. */
  onOpenThread?: (id: string) => void
}

/**
 * A single feed row, memoized so an unchanged post does not re-render when the
 * feed page re-renders (the burst-legibility guarantee — NFR-002/SOC-071).
 * Props are primitives + a referentially-stable `PostView` (see `useFeed`), so
 * the default shallow comparison is correct here.
 */
const FeedRow = memo(function FeedRow({ post, variant, onOpenThread }: FeedRowProps) {
  return (
    <li className={styles.row}>
      {/* Tapping the post body OR its reply affordance opens the flattened
          thread (SOC-011); the shell channel supplies onOpenThread. */}
      <PostCard post={post} variant={variant} onOpen={onOpenThread} onReply={onOpenThread} />
    </li>
  )
})

export interface FeedProps {
  /** Opens a post's flattened thread; the shell channel (`SocialChannel`)
   * supplies it. Omitted in isolation — the feed still renders, just without
   * thread navigation. */
  readonly onOpenThread?: (id: string) => void
}

export function Feed({ onOpenThread }: FeedProps = {}) {
  const { exerciseId, timeZone } = useExerciseContext()
  const session = useSession()
  const { variant } = useShellContext()
  const { posts, loading, error } = useFeed()

  const cardVariant: CardVariant = affordancesAvailable(variant) ? 'full' : 'readOnly'

  // XC-004: one 'view' event on first mount. The ref guard makes it emit-once
  // across re-renders and a StrictMode double-effect-invoke (the ref survives
  // both — the component instance is not remounted).
  const viewEmittedRef = useRef(false)
  useEffect(() => {
    if (viewEmittedRef.current) return
    viewEmittedRef.current = true
    buildAndEmit({
      exerciseId,
      eventType: 'view',
      channel: 'social',
      actor: { kind: 'participant', participantId: session.accountId },
      wallClockTime: wallClockNowIso(),
      scenarioTime: scenarioNow().toISOString(),
      timeZone,
      target: { entityType: 'feed', entityId: 'all-posts' },
    })
  }, [exerciseId, timeZone, session.accountId])

  return (
    <section className={styles.feed} aria-labelledby="feed-heading">
      <h1 id="feed-heading" className={styles.srOnly}>Home</h1>

      {/* aria-live region: story 04's "new posts" pill announces politely into
          this list; the initial render is not announced (live regions only
          announce subsequent changes). */}
      <ul className={styles.list} aria-live="polite">
        {posts.map(post => (
          <FeedRow
            key={post.id}
            post={post}
            variant={cardVariant}
            onOpenThread={onOpenThread}
          />
        ))}
      </ul>

      {loading && posts.length === 0 && (
        <p className={styles.state} role="status">Loading posts…</p>
      )}
      {!loading && error !== undefined && posts.length === 0 && (
        <p className={styles.state} role="status">Posts aren’t available right now.</p>
      )}
      {!loading && error === undefined && posts.length === 0 && (
        <p className={styles.state}>No posts yet.</p>
      )}
    </section>
  )
}
