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
 * REAL-TIME "NEW POSTS" PILL (feeds-discovery/04, SOC-083, D1-005): the reading
 * stream `useFeed()` resolves is FROZEN — real-time arrivals do NOT insert into
 * it or scroll it (AC1). `useFeedStream()` buffers them behind a sticky
 * `<NewPostsPill>` showing the count; tapping the pill drains the buffer, this
 * page resolves the loaded posts' authors (via `usePersonas()` — the loaded
 * posts are ALREADY narrowed `ParticipantPostView`s, never re-widened; XC-002),
 * prepends them newest-first, and scrolls the feed to the top WITHOUT hijacking
 * focus (AC2). The stream is DISABLED (and the pill hidden) in an observer /
 * read-only session (`affordancesAvailable`, D1-011). A duplicate that could
 * arise from the tiny mount-window overlap between the frozen baseline and the
 * stream is de-duped against the already-rendered ids on load.
 *
 * BURST STRATEGY (NFR-002 / SOC-071 — the feed IS the burst surface): the list
 * uses stable `post.id` keys and a `React.memo`'d row (`FeedRow`), so at
 * 120 posts/min an unchanged row does not re-render when the page re-renders
 * (e.g. a pill count update, or the mount-once telemetry effect). Row props stay
 * referentially stable because `useFeed` memoizes the mapped views. Under burst
 * only the pill's number re-renders — `useFeedStream` buffers arrivals in a
 * bounded ring and materialises NO DOM node per buffered post. The list is a
 * flat `<ul>`; a virtualization/windowing layer can wrap `views.map(...)` later
 * WITHOUT reshaping the data flow.
 *
 * A11Y (NFR-001): the `<NewPostsPill>` is an `aria-live="polite"` region that
 * announces the count to assistive tech without hijacking focus. The post list
 * ALSO stays `aria-live="polite"` — but it now changes ONLY when the reader taps
 * the pill (a user-initiated load), never on its own. A single landmark +
 * heading gives sane structure and focus order; no state is conveyed by color
 * alone.
 *
 * TELEMETRY (XC-004): emits exactly ONE `'view'` event on first mount via the
 * caller-safe `buildAndEmit` (guarded by a ref so a re-render / StrictMode
 * double-invoke can't re-emit). `actor.participantId` is the session
 * `accountId` (present for read-only sessions too — satisfies the view
 * superRefine, COR-015). `scenarioTime` is scenario `now`; `wallClockTime` is
 * the telemetry-only wall clock (never rendered).
 *
 * WAVE-S3.1 INTEGRATION (orchestrator-owned — reactions/01 + amplification/01
 * + hashtags-trending/01 "integration seam"): `FeedRow` now ALSO calls
 * `useReaction()` and `useAmplify()` per post — the same per-row-hook shape
 * `useReaction`'s own module header anticipates — and threads their state/
 * handlers into `<PostCard>` exactly like the pre-existing `onOpenThread`
 * wiring: `likedByViewer`/`onLike` (SOC-030), `onRepost` (SOC-020), and a
 * per-row "Quote" panel (`<QuoteComposer>`, opened via `onQuote`) that calls
 * `useAmplify().doQuote`. The row's `post.counts.like` is OVERRIDDEN by the
 * hook's own optimistic `likeCount` before it reaches `<PostCard>`, so a
 * toggle renders immediately without waiting on a feed refetch. `onHashtagOpen`
 * threads straight through to `<PostCard>` (the shell channel supplies it).
 * None of this touches the row's memoization: `FeedRow`'s OWN internal hook
 * state doesn't affect whether `React.memo` bails out on unchanged
 * `post`/`variant`/`onOpenThread`/`onHashtagOpen` props (NFR-002/SOC-071).
 */

import { memo, useCallback, useMemo, useState, useEffect, useRef } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'
import { useSession } from '@/core/auth'
import { scenarioNow } from '@/core/clock'
import { wallClockNowIso } from '@/core/time/wallClock'
import { buildAndEmit } from '@/core/telemetry'
import { PostCard, type PostView, type ParticipantPostView } from '@/features/social'
import { usePersonas, type Persona } from '@/features/personas'
import {
  useShellContext,
  affordancesAvailable,
} from '@/features/participant-shell/mountContract'
import { useFeed } from '../hooks/useFeed'
import { useFeedStream } from '../hooks/useFeedStream'
import { useReaction } from '../hooks/useReaction'
import { useAmplify } from '../hooks/useAmplify'
import { NewPostsPill } from '../components/NewPostsPill'
import { QuoteComposer } from '../components/QuoteComposer'
import styles from './Feed.module.css'

type CardVariant = 'full' | 'readOnly'

/**
 * Newest-first comparator by scenario-time ISO instant — mirrors
 * `feedService.compareNewestFirst`. `Date.parse(string)` parses a GIVEN instant
 * (it does NOT read the wall clock, unlike the lint-banned `new Date()` /
 * `Date.now()`); an unparseable instant sorts last (treated as oldest).
 */
function compareNewestFirst(a: string, b: string): number {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  const safeA = Number.isNaN(ta) ? -Infinity : ta
  const safeB = Number.isNaN(tb) ? -Infinity : tb
  return safeB - safeA
}

/** Sorts a copy of `views` newest-first by `scenarioTime` (COR-053). */
function sortNewestFirst(views: readonly PostView[]): PostView[] {
  return views.slice().sort((a, b) => compareNewestFirst(a.scenarioTime, b.scenarioTime))
}

/**
 * Resolves buffered `ParticipantPostView`s (already narrowed — XC-002, never
 * re-widened here) to renderable `PostView`s: attaches each post's author from
 * the persona cast, skips a post whose author is absent (never crash the feed)
 * or whose id is already rendered (de-dupes the mount-window baseline/stream
 * overlap). Mirrors `feedService.assembleFeedView`'s per-row assembly.
 */
function resolveLiveViews(
  buffered: readonly ParticipantPostView[],
  personaById: ReadonlyMap<string, Persona>,
  alreadyRendered: ReadonlySet<string>,
): PostView[] {
  const out: PostView[] = []
  for (const view of buffered) {
    if (alreadyRendered.has(view.id)) continue
    const author = personaById.get(view.authorPersonaId)
    if (author === undefined) continue
    out.push({
      id: view.id,
      author,
      text: view.text,
      counts: view.counts,
      scenarioTime: view.scenarioTime,
      ...(view.media !== undefined ? { media: view.media } : {}),
      ...(view.linkPreview !== undefined ? { linkPreview: view.linkPreview } : {}),
    })
  }
  return out
}

interface FeedRowProps {
  post: PostView
  variant: CardVariant
  /** Opens this post's flattened thread; supplied by the shell channel. Stable
   * identity (a `useCallback`), so the memoized row still skips re-render under
   * burst (NFR-002/SOC-071) even though a function prop is threaded through. */
  onOpenThread?: (id: string) => void
  /** Opens the tapped hashtag's feed; supplied by the shell channel
   * (Wave-S3.1). Omitted in isolation — hashtags stay inert links. */
  onHashtagOpen?: (tag: string) => void
}

/**
 * A single feed row, memoized so an unchanged post does not re-render when the
 * feed page re-renders (the burst-legibility guarantee — NFR-002/SOC-071).
 * Props are primitives + a referentially-stable `PostView` (see `useFeed`), so
 * the default shallow comparison is correct here. Owns its OWN like/repost/
 * quote wiring (see module header) — that internal state doesn't affect the
 * memo comparison, which is prop-only.
 */
const FeedRow = memo(function FeedRow({
  post,
  variant,
  onOpenThread,
  onHashtagOpen,
}: FeedRowProps) {
  const reaction = useReaction({ postId: post.id, initialLikeCount: post.counts.like })
  const amplify = useAmplify({ postId: post.id })
  const [quoting, setQuoting] = useState(false)

  // Override the seeded like count with the hook's own optimistic total, so a
  // toggle renders immediately (SOC-030) without waiting on a feed refetch.
  const displayPost: PostView = useMemo(
    () => ({ ...post, counts: { ...post.counts, like: reaction.likeCount } }),
    [post, reaction.likeCount],
  )

  const handleQuoteSubmit = (commentary: string) => {
    amplify.doQuote(commentary)
    setQuoting(false)
  }

  return (
    <li className={styles.row}>
      {/* Tapping the post body OR its reply affordance opens the flattened
          thread (SOC-011); the shell channel supplies onOpenThread. */}
      <PostCard
        post={displayPost}
        variant={variant}
        onOpen={onOpenThread}
        onReply={onOpenThread}
        likedByViewer={reaction.likedByViewer}
        onLike={reaction.canReact ? reaction.toggleLike : undefined}
        onRepost={amplify.canAmplify ? amplify.doRepost : undefined}
        onQuote={amplify.canAmplify ? () => setQuoting(true) : undefined}
        onHashtagOpen={onHashtagOpen}
      />
      {quoting && (
        <QuoteComposer
          authorName={post.author.displayName}
          onSubmit={handleQuoteSubmit}
          onCancel={() => setQuoting(false)}
        />
      )}
    </li>
  )
})

export interface FeedProps {
  /** Opens a post's flattened thread; the shell channel (`SocialChannel`)
   * supplies it. Omitted in isolation — the feed still renders, just without
   * thread navigation. */
  readonly onOpenThread?: (id: string) => void
  /** Opens the tapped hashtag's feed (SOC-040); the shell channel supplies
   * it. Omitted in isolation — hashtags stay inert links. */
  readonly onHashtagOpen?: (tag: string) => void
}

export function Feed({ onOpenThread, onHashtagOpen }: FeedProps = {}) {
  const { exerciseId, timeZone } = useExerciseContext()
  const session = useSession()
  const { variant } = useShellContext()
  const { posts, loading, error } = useFeed()
  // Author cast for resolving buffered posts on load (the frozen baseline is
  // already resolved inside useFeed — this is only for the pill's arrivals).
  const { personas } = usePersonas()

  const affordances = affordancesAvailable(variant)
  const cardVariant: CardVariant = affordances ? 'full' : 'readOnly'

  // Real-time buffer behind the pill. Disabled (and the pill hidden) for an
  // observer/read-only session (D1-011) — nothing streams there.
  const { newCount, loadBuffered } = useFeedStream({ enabled: affordances })

  // Posts the reader has LOADED from the pill — prepended above the frozen
  // baseline, newest-first, accumulated across taps. Untouched until a tap.
  const [liveViews, setLiveViews] = useState<readonly PostView[]>([])

  const sectionRef = useRef<HTMLElement>(null)

  const personaById = useMemo(
    () => new Map(personas.map(p => [p.id, p] as const)),
    [personas],
  )

  // Ids already on screen (loaded-live + frozen baseline) — a loaded buffered
  // post matching one is skipped, so the mount-window overlap never dupes.
  const renderedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const view of liveViews) ids.add(view.id)
    for (const post of posts) ids.add(post.id)
    return ids
  }, [liveViews, posts])

  const handleLoadNew = useCallback(() => {
    const buffered = loadBuffered()
    if (buffered.length === 0) return

    const resolved = resolveLiveViews(buffered, personaById, renderedIds)
    if (resolved.length > 0) {
      setLiveViews(prev => sortNewestFirst([...resolved, ...prev]))
    }

    // Scroll the feed to the top (AC2) without stealing focus — `scrollIntoView`
    // moves the viewport, never the focus ring. Guarded for environments (jsdom)
    // where it is not implemented.
    const node = sectionRef.current
    if (node !== null && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'start' })
    }

    // XC-004: ONE event when the reader loads buffered posts. Reuses the 'view'
    // type + feed target the mount view uses (open `eventType`/`entityId`, no new
    // schema); the buffered count rides the sanctioned `payload` extension point.
    buildAndEmit({
      exerciseId,
      eventType: 'view',
      channel: 'social',
      actor: { kind: 'participant', participantId: session.accountId },
      wallClockTime: wallClockNowIso(),
      scenarioTime: scenarioNow().toISOString(),
      timeZone,
      target: { entityType: 'feed', entityId: 'all-posts' },
      payload: { newPostsLoaded: buffered.length },
    })
  }, [loadBuffered, personaById, renderedIds, exerciseId, timeZone, session.accountId])

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

  const displayViews = liveViews.length > 0 ? [...liveViews, ...posts] : posts

  return (
    <section ref={sectionRef} className={styles.feed} aria-labelledby="feed-heading">
      <h1 id="feed-heading" className={styles.srOnly}>Home</h1>

      {/* Sticky "▲ N new posts" pill (feeds-discovery/04). Its own polite live
          region announces the count. HIDDEN entirely for an observer/read-only
          session (D1-011) — the stream is also disabled there, so there is
          nothing to buffer or announce. For a full session it mounts at
          feed-mount (count 0, empty region), so the polite region is present
          before the first arrival changes it (reliable AT announcement). */}
      {affordances && <NewPostsPill count={newCount} onLoad={handleLoadNew} />}

      {/* aria-live region: it now changes ONLY when the reader taps the pill
          (a user-initiated load), never on its own — the initial render is not
          announced (live regions only announce subsequent changes). */}
      <ul className={styles.list} aria-live="polite">
        {displayViews.map(post => (
          <FeedRow
            key={post.id}
            post={post}
            variant={cardVariant}
            onOpenThread={onOpenThread}
            onHashtagOpen={onHashtagOpen}
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
