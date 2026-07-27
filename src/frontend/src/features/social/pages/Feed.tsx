/**
 * features/social/pages/Feed.tsx
 * ---------------------------------------------------------------------------
 * The All Posts / Following feed — the PILOT participant landing surface
 * (feature: feeds-discovery, story 01 "All Posts" + story 02 "Following";
 * SOC-080, SOC-081, COR-001/015, COR-053, XC-004, NFR-001/002, SOC-071).
 * Participant world (Pulse Social skin): plain semantic elements + a scoped
 * CSS Module — NO COBRA, NO themed MUI, FontAwesome-only if icons are ever
 * needed here.
 *
 * WHAT IT DOES
 *  - Renders posts, newest-first, each via the keystone `<PostCard>`
 *    (`@/features/social`). The chronological convergence (post →
 *    participant-safe view → resolved author → `PostView`, sorted) is owned by
 *    `useFeed()`/`feedService` — this page is the presentation layer.
 *  - It is the DEFAULT landing feed: mounted with no `scope` prop (or
 *    `scope="all"`) it is byte-identical to story 01's All Posts feed. A
 *    `scope="following"` mount renders the SAME component narrowed to posts by
 *    accounts the caller's persona follows (SOC-081) — story 02 extends this
 *    page/hook/service rather than forking a second feed implementation.
 *
 * SCOPE + COR-015 (story 02). `scope` defaults to `'all'`. Requesting
 * `'following'` is only honored for a session that COULD meaningfully have one
 * — a bound persona, not read-only (the SAME `!isReadOnly && personaId !==
 * undefined` predicate `useReaction`'s `canReact` uses). For a read-only /
 * no-persona session the EFFECTIVE scope is forced back to `'all'` regardless
 * of what was requested — "read-only sessions default to All Posts, never the
 * empty Following feed" (COR-015) is enforced HERE, defensively, so a future
 * integration mistake (e.g. a tab component that doesn't itself gate on
 * session state) cannot violate it. An honest, in-fiction, non-fallback empty
 * state renders when `'following'` genuinely resolves zero posts (an empty
 * follow set) — this is NOT the same message as the All Posts empty state, so
 * a reader is never left wondering whether the whole feed is broken versus
 * "you haven't followed anyone / no posts from who you follow yet".
 *
 * NOT WIRED INTO TABS HERE (out of scope, AC3 "All Posts / Following are
 * tabs..."): that UI (the shell channel's tab switcher, plus per-feed scroll
 * preservation across a switch) is an orchestrator-owned integration pass —
 * see this module's own header note in the story's implementation doc. This
 * component only guarantees it CAN be mounted with `scope="following"` and
 * behaves correctly when it is.
 *
 * THE LIVE "NEW POSTS" PILL IS DISABLED UNDER `scope="following"` (deliberate,
 * not an oversight): `useFeedStream`/`postStore`'s live source is NOT
 * follow-aware — it streams every arrival regardless of author (story 04's own
 * scope). Wiring it into a Following-scoped mount would show a pill counting
 * arrivals from accounts the reader does NOT follow, under the Following
 * label — a worse bug than no pill. Real-time for Following stays this
 * story's Out of Scope item ("real-time pill (story 04)"); story 04's own
 * follow-up is where the stream itself becomes scope-aware.
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
 *
 * AUTHOR TAP-THROUGH (profiles-social-graph integration, SOC-050):
 * `onOpenProfile` threads straight through to each `<PostCard>`'s author
 * target exactly like `onHashtagOpen` — one more optional, referentially
 * stable callback the shell channel supplies (it MUST be a `useCallback`
 * there, or every row re-renders on each channel render and the burst
 * guarantee is lost). Omitted ⇒ the author identity renders as inert text.
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
import { compareNewestFirst, type FeedScope } from '../services/feedService'
import { useFeed } from '../hooks/useFeed'
import { useFeedStream } from '../hooks/useFeedStream'
import { useReaction } from '../hooks/useReaction'
import { useAmplify } from '../hooks/useAmplify'
import { NewPostsPill } from '../components/NewPostsPill'
import { QuoteComposer } from '../components/QuoteComposer'
import styles from './Feed.module.css'

type CardVariant = 'full' | 'readOnly'

/**
 * Sorts a copy of `views` newest-first by `scenarioTime` (COR-053), reusing the
 * SINGLE shared `feedService.compareNewestFirst` (which the baseline
 * `assembleFeedView` sort also uses) so the live-arrivals prepend can never
 * drift from the baseline ordering (Copilot #301 round-2 de-dupe). The
 * comparator uses `Date.parse(string)` only — no wall clock (COR-053).
 */
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
  /** Opens the tapped AUTHOR's profile (SOC-050); supplied by the shell
   * channel. Stable identity (a `useCallback`) for the same memo reason as
   * `onOpenThread`. Omitted in isolation — the author identity stays inert. */
  onOpenProfile?: (personaId: string) => void
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
  onOpenProfile,
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
        onOpenProfile={onOpenProfile}
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
  /**
   * Which feed to render (story 02, SOC-081). Defaults to `'all'` — omitting
   * this prop is byte-identical to story 01's All Posts feed. `'following'`
   * narrows to posts by accounts the caller's persona follows, subject to the
   * COR-015 read-only/no-persona guard below (see the module header).
   */
  readonly scope?: FeedScope
  /** Opens a post's flattened thread; the shell channel (`SocialChannel`)
   * supplies it. Omitted in isolation — the feed still renders, just without
   * thread navigation. */
  readonly onOpenThread?: (id: string) => void
  /** Opens the tapped hashtag's feed (SOC-040); the shell channel supplies
   * it. Omitted in isolation — hashtags stay inert links. */
  readonly onHashtagOpen?: (tag: string) => void
  /** Opens the tapped author's profile (SOC-050); the shell channel supplies
   * it. Omitted in isolation — the author identity renders as inert text
   * (no focusable no-op — WR-002). */
  readonly onOpenProfile?: (personaId: string) => void
}

export function Feed({
  scope = 'all',
  onOpenThread,
  onHashtagOpen,
  onOpenProfile,
}: FeedProps = {}) {
  const { exerciseId, timeZone } = useExerciseContext()
  const session = useSession()
  const { variant } = useShellContext()

  // COR-015: a Following request is only honored for a session that could
  // meaningfully have a follow set — a bound persona, not read-only. Mirrors
  // `useReaction`'s `canReact` predicate exactly. A read-only/no-persona
  // session gets 'all' regardless of the requested `scope` — enforced HERE so
  // a future caller mistake (e.g. a tab bar that forgets to gate itself)
  // cannot serve the empty Following feed to an observer.
  const canUseFollowing = !session.isReadOnly && session.personaId !== undefined
  const effectiveScope: FeedScope = scope === 'following' && !canUseFollowing ? 'all' : scope
  const isFollowing = effectiveScope === 'following'
  // Shared across both telemetry emits below, so the two can never drift.
  const feedEntityId = isFollowing ? 'following-feed' : 'all-posts'

  const { posts, loading, error } = useFeed(effectiveScope)
  // Author cast for resolving buffered posts on load (the frozen baseline is
  // already resolved inside useFeed — this is only for the pill's arrivals).
  const { personas } = usePersonas()

  const affordances = affordancesAvailable(variant)
  const cardVariant: CardVariant = affordances ? 'full' : 'readOnly'

  // Real-time buffer behind the pill. Disabled (and the pill hidden) for an
  // observer/read-only session (D1-011) — nothing streams there — AND for the
  // Following scope (module header: the stream isn't follow-aware yet, story
  // 04's own follow-up).
  const streamEnabled = affordances && !isFollowing
  const { newCount, loadBuffered } = useFeedStream({ enabled: streamEnabled })

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
    // Guard BEFORE draining: if the persona cast has not resolved yet, do NOT
    // drain — every author resolution would fail and the drain would drop the
    // buffered posts the reader was just told about (data loss) while resetting
    // the count. Leave the buffer + pill intact so a later tap (once the cast
    // loads) still works. In practice the cast is loaded by now (the baseline
    // feed rendered), so this is fail-soft cover with no data loss.
    if (personaById.size === 0) return

    const buffered = loadBuffered()
    if (buffered.length === 0) return

    const resolved = resolveLiveViews(buffered, personaById, renderedIds)
    // Nothing resolved: every buffered post was a mount-window duplicate already
    // on screen or an unknown author — both correctly skipped, matching the
    // baseline `assembleFeedView` skip. The drain above already cleared the
    // count and hid the pill; don't scroll to a feed that didn't change, and
    // don't emit a load event for a load that rendered nothing. Return early.
    if (resolved.length === 0) return

    setLiveViews(prev => sortNewestFirst([...resolved, ...prev]))

    // Scroll the feed to the top (AC2) without stealing focus — `scrollIntoView`
    // moves the viewport, never the focus ring. Guarded for environments (jsdom)
    // where it is not implemented.
    const node = sectionRef.current
    if (node !== null && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'start' })
    }

    // XC-004: ONE event when the reader loads buffered posts. Reuses the 'view'
    // type + feed target the mount view uses (open `eventType`/`entityId`, no new
    // schema); the count ACTUALLY loaded into view (`resolved`, not the raw
    // drained count) rides the sanctioned `payload` extension point.
    buildAndEmit({
      exerciseId,
      eventType: 'view',
      channel: 'social',
      actor: { kind: 'participant', participantId: session.accountId },
      wallClockTime: wallClockNowIso(),
      scenarioTime: scenarioNow().toISOString(),
      timeZone,
      target: { entityType: 'feed', entityId: feedEntityId },
      payload: { newPostsLoaded: resolved.length },
    })
  }, [
    loadBuffered, personaById, renderedIds, exerciseId, timeZone, session.accountId, feedEntityId,
  ])

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
      target: { entityType: 'feed', entityId: feedEntityId },
    })
  }, [exerciseId, timeZone, session.accountId, feedEntityId])

  const displayViews = liveViews.length > 0 ? [...liveViews, ...posts] : posts

  return (
    <section ref={sectionRef} className={styles.feed} aria-labelledby="feed-heading">
      <h1 id="feed-heading" className={styles.srOnly}>{isFollowing ? 'Following' : 'Home'}</h1>

      {/* Sticky "▲ N new posts" pill (feeds-discovery/04). Its own polite live
          region announces the count. HIDDEN entirely for an observer/read-only
          session (D1-011) AND for the Following scope (module header — the
          stream isn't follow-aware yet) — `streamEnabled` covers both. For an
          enabled mount it appears at feed-mount (count 0, empty region), so
          the polite region is present before the first arrival changes it
          (reliable AT announcement). */}
      {streamEnabled && <NewPostsPill count={newCount} onLoad={handleLoadNew} />}

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
            onOpenProfile={onOpenProfile}
          />
        ))}
      </ul>

      {loading && posts.length === 0 && (
        <p className={styles.state} role="status">Loading posts…</p>
      )}
      {!loading && error !== undefined && posts.length === 0 && (
        <p className={styles.state} role="status">Posts aren’t available right now.</p>
      )}
      {/* The Following empty state is DELIBERATELY different copy from the All
          Posts one (SOC-081) — an honest "nothing from who you follow yet",
          never the same "No posts yet." wording that would read as if the
          whole feed were broken/empty, and NEVER a silent fallback to
          rendering the All Posts content instead. */}
      {!loading && error === undefined && posts.length === 0 && (
        <p className={styles.state}>
          {isFollowing ? 'No posts from accounts you follow yet.' : 'No posts yet.'}
        </p>
      )}
    </section>
  )
}
