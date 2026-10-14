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
 * THE LIVE "NEW POSTS" PILL IS FOLLOW-AWARE UNDER `scope="following"`
 * (feeds-discovery/08, #91 — supersedes the interim "pill disabled under
 * Following" build). The stream SOURCE is deliberately author-agnostic: it
 * delivers every arrival in the exercise. An earlier pass therefore switched
 * the stream off entirely for a Following mount, on the reasoning that a pill
 * counting posts from accounts the reader does not follow is worse than no
 * pill — true, but it left the Following feed permanently frozen with no
 * indication that anything was arriving at all: one dishonest state traded for
 * another. The fix is to filter, not to disable: this page now passes
 * `useFeedStream` an `admit` predicate that accepts an arrival only when its
 * `authorPersonaId` is in the VIEWER's followed set (`useFollowedSet`, resolved
 * through `followService.resolveFollowing` for the session's own persona — the
 * same server-authoritative seam, and in mock mode the same shared edge store,
 * that the Following baseline itself filters on, so the pill and the feed can
 * never disagree about who is followed). A rejected arrival is never buffered
 * and never counted, so the pill's number always drains to exactly that many
 * visible posts. Under `scope="all"` NO predicate is passed at all — the All
 * Posts path is byte-identical to before.
 *
 * A FOLLOW MADE MID-SESSION takes effect on the NEXT arrival, with no remount:
 * `useFollowedSet` re-reads the follow graph on every successful follow/unfollow
 * write (`followService.subscribeFollowChanges`), and its predicate keeps a
 * stable identity across that refresh, so the stream is never re-subscribed
 * (see that hook's header). Note this changes what ARRIVES from here on — the
 * already-frozen baseline still does not retroactively gain that account's
 * older posts (story 02's recorded, intentional frozen-baseline behaviour).
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
 * ENGAGEMENT WIRING LIVES IN THE CARD (demo-polish F0, DP-14). Until F0, `FeedRow`
 * called `useReaction()`/`useAmplify()` per post and threaded `likedByViewer`/
 * `onLike`/`onRepost`/`onQuote` (+ a per-row `<QuoteComposer>`) into `<PostCard>`.
 * That wiring moved INTO `PostActions` (a part of the card), which self-wires the
 * same hooks — so this row passes only navigation/identity props and EVERY card on
 * every surface (feed, thread, profile, hashtag) has live like/repost with no
 * per-page wiring. Behaviour is unchanged: the like total still renders the hook's
 * optimistic count immediately, telemetry is the same single event per toggle.
 * `onHashtagOpen` threads straight through to `<PostCard>` (the shell channel
 * supplies it). `FeedRow`'s memoization is unchanged (NFR-002/SOC-071): it is a
 * pure function of `post`/`variant`/the stable callbacks.
 *
 * YOUR OWN POST APPEARS INSTANTLY (demo-polish F4, story 13). D1-005's "arrivals
 * buffer behind the pill" is for OTHER people's posts. After a successful publish
 * the composer registers the created post in `ownPostStore` (`useOwnPosts`), and
 * this page merges it at the TOP of the All Posts feed at once — exactly once, no
 * pill tap. The stream must then NOT hand the same post back as an "echo":
 *   - `admit` rejects any arrival whose id is already the viewer's own (the echo
 *     that lands AFTER the 201 / registration), and
 *   - a layout effect `discard`s the own ids from the pill's buffer (the echo that
 *     landed BEFORE — the broadcast can beat the 201 response) so the count never
 *     promises a post that loads nothing.
 * Replies never reach the pill at all: the feed stream is top-level only
 * (`feedStreamSource.topLevelOnly`). A Following mount merges nothing of its own —
 * your post is not "from someone you follow" — and the own-post row de-dupes
 * against the baseline and the pill-loaded rows by id.
 *
 * THE REPLY BUTTON opens the thread with its composer focused: `onReply` records the
 * intent (`services/replyIntent`) and then calls `onOpenThread`, so it works through
 * whatever navigation the shell owns. (A body tap opens the thread without it.)
 *
 * A TAKEN-DOWN POST VANISHES (demo-polish C5, story 22). A controller's takedown reaches
 * this page as a recorded id in the session's `removedPosts` store (SignalR `PostRemoved`
 * via `realtimeFeed`; the console's own call in mock mode). The page hides any post whose id
 * is there, at once and without a refresh, wherever it came from — the frozen baseline, a
 * pill-loaded row, or the viewer's own just-published post — and it leaves NO trace: no
 * "removed" row, no moderator chrome, no announcement (the participant's fiction simply
 * has one post fewer). The pill's side is handled too: a removed id is never admitted to
 * the buffer, and one already buffered is `discard`ed before paint, so the "N new posts"
 * count never promises a post that would load nothing. What this guarantees is the DOM: a
 * removed post's card (its text, its media, its accessible names) is gone from the document, and
 * the rows this page loaded from the pill are dropped from its own state. It does NOT purge
 * in-memory caches - the frozen baseline `useFeed` resolved at mount, and `ownPostStore` - which
 * can still hold the removed post's `ParticipantPostView` until the next read or sign-out; nothing
 * renders it, and purging them is deliberately not attempted here. An id the page is not showing
 * changes nothing - no re-render of any row, no focus move.
 * If the post that was removed held keyboard focus, focus moves to the feed REGION (the
 * `<section>`, `tabIndex={-1}`) instead of falling to `<body>`, so a keyboard or
 * screen-reader user keeps their place (NFR-001); the region is named by the page heading,
 * so it is announced as "Home" / "Following". The list's polite live region announces
 * additions only, so a removal is silent by design. A read-only/observer mount opens no
 * transport (D1-011), so it learns of a removal on its next read, like a polling session.
 *
 * LOADING STATE: the "Loading posts…" line is `<FeedSkeleton>` (F0 stub -> F5
 * fills in skeleton rows); this page only decides WHEN to show it.
 *
 * AUTHOR TAP-THROUGH (profiles-social-graph integration, SOC-050):
 * `onOpenProfile` threads straight through to each `<PostCard>`'s author
 * target exactly like `onHashtagOpen` — one more optional, referentially
 * stable callback the shell channel supplies (it MUST be a `useCallback`
 * there, or every row re-renders on each channel render and the burst
 * guarantee is lost). Omitted ⇒ the author identity renders as inert text.
 */

import {
  memo,
  useCallback,
  useId,
  useMemo,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from 'react'
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
import { compareNewestFirst, toPostView, type FeedScope } from '../services/feedService'
import { useFeed } from '../hooks/useFeed'
import { useFeedStream } from '../hooks/useFeedStream'
import { useFollowedSet } from '../hooks/useFollowedSet'
import { useOwnPosts } from '../hooks/useOwnPosts'
import { ownPostStore } from '../services/ownPostStore'
import { removedPosts } from '../services/removedPosts'
import { requestReplyFocus } from '../services/replyIntent'
import { NewPostsPill } from '../components/NewPostsPill'
import { FeedSkeleton } from '../components/FeedSkeleton'
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
    out.push(toPostView(view, author))
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
  /** Opens this post's thread with the reply composer focused (the reply button);
   * stable identity for the same memo reason. Omitted in isolation. */
  onReply?: (id: string) => void
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
 * the default shallow comparison is correct here. The like/repost/quote state is
 * owned by the card's `PostActions` (see the module header), not by the row.
 */
const FeedRow = memo(function FeedRow({
  post,
  variant,
  onOpenThread,
  onReply,
  onHashtagOpen,
  onOpenProfile,
}: FeedRowProps) {
  return (
    <li className={styles.row} data-feed-post-id={post.id}>
      {/* Tapping the post body opens the flattened thread (SOC-011); its reply
          affordance opens it with the composer focused (F4). The shell channel
          supplies onOpenThread. */}
      <PostCard
        post={post}
        variant={variant}
        onOpen={onOpenThread}
        onReply={onReply}
        onHashtagOpen={onHashtagOpen}
        onOpenProfile={onOpenProfile}
      />
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

  // The viewer's followed set — resolved ONLY for a Following mount. An All
  // Posts mount passes `undefined`, so it issues no follow-graph request and
  // behaves exactly as it did before this seam existed. `session.personaId` is
  // always defined when `isFollowing` holds (the COR-015 guard above).
  const { isFollowed } = useFollowedSet(isFollowing ? session.personaId : undefined)

  // The arrival filter (module header). Three rules, all applied at the moment a
  // post is OFFERED to the buffer:
  //  - never count the viewer's OWN post as "new" - it is already on screen at the
  //    top (an echo that lands after registration is rejected here; one that landed
  //    before is `discard`ed below);
  //  - never buffer a post that has already been TAKEN DOWN (C5): a removal can beat the
  //    arrival, and a counted-but-removed post would promise a load that shows nothing;
  //  - under Following, admit only accounts the reader follows (feeds-discovery/08).
  // Stable identity - `isFollowing` and `isFollowed` are stable for the component's
  // life and `ownPostStore.has` / `removedPosts.has` are read at call time - so this
  // predicate never re-subscribes the stream, not even when the reader follows someone.
  const admitArrival = useCallback(
    (post: ParticipantPostView) =>
      !ownPostStore.has(post.id) &&
      !removedPosts.has(post.id) &&
      (!isFollowing || isFollowed(post.authorPersonaId)),
    [isFollowing, isFollowed],
  )

  // Real-time buffer behind the pill. Disabled (and the pill hidden) ONLY for an
  // observer/read-only session (D1-011) — nothing streams there. The stream is
  // top-level only (replies never raise the pill - `feedStreamSource`).
  const streamEnabled = affordances
  const { newCount, loadBuffered, discard } = useFeedStream({
    enabled: streamEnabled,
    admit: admitArrival,
  })

  // The viewer's own just-published posts (ownPostStore), newest-registered first.
  const ownPosts = useOwnPosts()

  // An own post whose echo arrived BEFORE it was registered (the broadcast can beat
  // the 201) is already buffered and counted: take it back out before paint, so the
  // pill never flashes a number for a post that is already on screen.
  useLayoutEffect(() => {
    if (ownPosts.length > 0) discard(ownPosts.map(post => post.id))
  }, [ownPosts, discard])

  // Posts the reader has LOADED from the pill — prepended above the frozen
  // baseline, newest-first, accumulated across taps. Untouched until a tap.
  const [liveViews, setLiveViews] = useState<readonly PostView[]>([])

  const sectionRef = useRef<HTMLElement>(null)

  // Taken-down posts (C5): the session's removed ids, a stable snapshot that changes only when
  // a removal is recorded. Everything displayed below is filtered through it.
  const removed = useSyncExternalStore(removedPosts.subscribe, removedPosts.getAll)

  // A removed post that is still buffered behind the pill is taken out BEFORE paint, so the
  // count never flashes a number for a post that would load nothing. (A removed post that
  // arrives afterwards never gets in: `admitArrival`.) Pruning `liveViews` drops the removed
  // text from this page's own state too; the functional update returns the SAME array when
  // nothing matches, so an unrelated removal costs no re-render.
  useLayoutEffect(() => {
    if (removed.size === 0) return
    discard([...removed])
    setLiveViews(prev => (prev.some(view => removed.has(view.id))
      ? prev.filter(view => !removed.has(view.id))
      : prev))
  }, [removed, discard])

  // Focus continuity (NFR-001). When the removed post held focus, React is about to unmount the
  // focused node and the browser would drop focus to <body>. The store notifies SYNCHRONOUSLY,
  // before React re-renders, so this listener still sees the focused card; it only records the
  // intent, and the layout effect below (after the row is gone) moves focus to the feed region.
  //
  // A second case (Gate-2 B L-2): the post's MEDIA VIEWER is open. It is mounted inside the row
  // but portalled to <body>, so focus is in the viewer - outside `section` - and the card test
  // above does not see it. When the row unmounts the viewer goes with it and focus would fall to
  // <body>. So the listener also remembers WHATEVER held focus; after the removal commits, if that
  // element was taken out of the document with the row (and focus has nowhere to be), the region
  // gets it. An element that is still connected - the controller was elsewhere - is left alone.
  const refocusRegionRef = useRef(false)
  const focusedAtRemovalRef = useRef<HTMLElement | null>(null)
  useEffect(() => removedPosts.subscribe(() => {
    const section = sectionRef.current
    const active = document.activeElement
    if (section === null || !(active instanceof HTMLElement) || active === document.body) return
    if (!section.contains(active)) {
      focusedAtRemovalRef.current = active
      return
    }
    const postId = active.closest<HTMLElement>('[data-feed-post-id]')?.dataset.feedPostId
    if (postId !== undefined && removedPosts.has(postId)) refocusRegionRef.current = true
  }), [])
  useLayoutEffect(() => {
    const remembered = focusedAtRemovalRef.current
    focusedAtRemovalRef.current = null
    const lostWithTheRow =
      remembered !== null
      && !remembered.isConnected
      && (document.activeElement === null || document.activeElement === document.body)
    if (!refocusRegionRef.current && !lostWithTheRow) return
    refocusRegionRef.current = false
    // The scroll position is the reader's: focusing must not move the viewport.
    sectionRef.current?.focus({ preventScroll: true })
  }, [removed])
  // The sr-only <h1> labelling the section. Home mounts TWO Feed instances (All Posts and
  // the lazily mounted Following), so a literal id would be duplicated in the document
  // (Gate-2 low); `useId()` gives each its own.
  const headingId = useId()

  const personaById = useMemo(
    () => new Map(personas.map(p => [p.id, p] as const)),
    [personas],
  )

  // The viewer's own TOP-LEVEL posts as renderable views (a reply is not a feed
  // item). Not merged under Following - your post is not "from someone you follow".
  // Only posts authored by THIS session's persona are merged: `ownPostStore` is also
  // reset on sign-out (`core/auth/endSession`), and this is the second line of defence
  // if a post made as another persona ever survived into this session.
  // Memoized so the rows keep their identity (NFR-002/SOC-071).
  const viewerPersonaId = session.personaId
  const ownViews = useMemo(
    () => isFollowing || viewerPersonaId === undefined
      ? []
      : resolveLiveViews(
        ownPosts.filter(
          post => post.inReplyTo == null && post.authorPersonaId === viewerPersonaId,
        ),
        personaById,
        new Set(posts.map(post => post.id)),
      ),
    [isFollowing, viewerPersonaId, ownPosts, personaById, posts],
  )

  // Ids already on screen (own + loaded-live + frozen baseline) — a loaded buffered
  // post matching one is skipped, so the mount-window overlap never dupes.
  const renderedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const view of ownViews) ids.add(view.id)
    for (const view of liveViews) ids.add(view.id)
    for (const post of posts) ids.add(post.id)
    return ids
  }, [ownViews, liveViews, posts])

  // The reply button: remember that this thread is being opened to reply, then
  // open it (works through whatever navigation the shell owns - replyIntent).
  const handleReply = useCallback((postId: string) => {
    if (onOpenThread === undefined) return
    requestReplyFocus(postId)
    onOpenThread(postId)
  }, [onOpenThread])

  const handleLoadNew = useCallback(() => {
    // Guard BEFORE draining: if the persona cast has not resolved yet, do NOT
    // drain — every author resolution would fail and the drain would drop the
    // buffered posts the reader was just told about (data loss) while resetting
    // the count. Leave the buffer + pill intact so a later tap (once the cast
    // loads) still works. In practice the cast is loaded by now (the baseline
    // feed rendered), so this is fail-soft cover with no data loss.
    if (personaById.size === 0) return

    // A post taken down while it sat behind the pill never loads (belt and braces: the layout
    // effect above has normally discarded it already).
    const buffered = loadBuffered().filter(post => !removedPosts.has(post.id))
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

  // Above the frozen baseline: the viewer's own posts and anything loaded from the
  // pill, newest-first by scenario time (COR-053). The sort is stable, so equal
  // instants keep own-before-loaded. De-duped by id (own vs loaded vs baseline).
  const aboveBaseline = useMemo(() => {
    if (ownViews.length === 0) return liveViews
    const ownIds = new Set(ownViews.map(view => view.id))
    return sortNewestFirst([...ownViews, ...liveViews.filter(view => !ownIds.has(view.id))])
  }, [ownViews, liveViews])
  // What is actually shown: own + loaded + baseline, minus anything taken down (C5). The array
  // is rebuilt only when one of its inputs changes; the rows' own `PostView` identities are
  // untouched, so a removal re-renders no surviving row (NFR-002/SOC-071).
  const displayViews = useMemo(() => {
    const all = aboveBaseline.length > 0 ? [...aboveBaseline, ...posts] : posts
    return removed.size === 0 ? all : all.filter(post => !removed.has(post.id))
  }, [aboveBaseline, posts, removed])
  // Every post the page held is gone: say so in the page's own empty-state voice.
  const allRemoved = posts.length > 0 && displayViews.length === 0

  return (
    <section
      ref={sectionRef}
      className={styles.feed}
      aria-labelledby={headingId}
      tabIndex={-1}
    >
      <h1 id={headingId} className={styles.srOnly}>{isFollowing ? 'Following' : 'Home'}</h1>

      {/* Sticky "▲ N new posts" pill (feeds-discovery/04). Its own polite live
          region announces the count. HIDDEN entirely for an observer/read-only
          session (D1-011) — the one thing `streamEnabled` now gates. Under
          Following it IS shown, counting only arrivals from followed accounts
          (feeds-discovery/08 — see the module header). For an enabled mount it
          appears at feed-mount (count 0, empty region), so the polite region is
          present before the first arrival changes it (reliable AT
          announcement). */}
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
            onReply={onOpenThread !== undefined ? handleReply : undefined}
            onHashtagOpen={onHashtagOpen}
            onOpenProfile={onOpenProfile}
          />
        ))}
      </ul>

      {loading && posts.length === 0 && <FeedSkeleton />}
      {!loading && error !== undefined && posts.length === 0 && (
        <p className={styles.state} role="status">Posts aren’t available right now.</p>
      )}
      {/* The Following empty state is DELIBERATELY different copy from the All
          Posts one (SOC-081) — an honest "nothing from who you follow yet",
          never the same "No posts yet." wording that would read as if the
          whole feed were broken/empty, and NEVER a silent fallback to
          rendering the All Posts content instead. */}
      {!loading && error === undefined && (posts.length === 0 || allRemoved) && (
        <p className={styles.state}>
          {isFollowing ? 'No posts from accounts you follow yet.' : 'No posts yet.'}
        </p>
      )}
    </section>
  )
}
