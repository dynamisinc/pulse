/**
 * features/social/SocialChannel.tsx
 * ---------------------------------------------------------------------------
 * The Pulse "Social" channel — the integration composition mounted as the
 * participant shell's DEFAULT channel (Wave S2; feeds-discovery/01 + posts/01 +
 * threads-replies/01+02). This is the seam that turns four independently-built
 * stories into one working surface; App.tsx's `ParticipantShellRoute` renders
 * it in the shell's channel mount point (replacing the Phase-1 placeholder).
 *
 * WHAT IT COMPOSES
 *  - `<Composer>` (posts/01) at the top — but only when the shell variant grants
 *    interactive affordances (`affordancesAvailable(variant)`; COR-015/D1-011).
 *    In an observer / read-only / preview session the composer is ABSENT (the
 *    component also self-guards on `session.isReadOnly`, belt-and-braces).
 *  - `<Feed>` (feeds-discovery/01) below it — the All Posts firehose, the
 *    default landing surface. Its `onOpenThread` is wired to open a thread.
 *  - `<ThreadView>` (threads-replies/01) — shown IN PLACE of the feed+composer
 *    when a post is opened (via its body-tap OR its reply affordance,
 *    threads-replies/02 / SOC-011), with a "Back to feed" control.
 *
 * NAVIGATION MODEL (Phase 1): the shell mounts exactly ONE channel and has no
 * cross-channel router yet (channelNavConfig is a single-channel catalog), so
 * "open a post's thread" is local view state HERE (`openThreadId`), not a URL
 * route — the whole point of keeping it in the channel. `ThreadView` emits its
 * own `'view'` (thread-open) telemetry on mount (XC-004), so opening a thread
 * is instrumented without this component emitting anything itself.
 *
 * WHY NO `onPosted` WIRING (S2): a published post is sanitized + instrumented by
 * `createPost` and the composer clears itself, but it does NOT appear in the
 * feed here. Live/own-post insertion is feeds-discovery story 04 (the real-time
 * "new posts" pill, explicitly out of this wave), and the mock cast does not
 * seed the current participant persona as a feed author, so an optimistic
 * prepend would be dropped by the feed's author resolution anyway. Story 04
 * owns that seam (`Composer`'s `onPosted` prop is already there for it).
 *
 * WAVE-S3.1 INTEGRATION (orchestrator-owned — hashtags-trending/01 +
 * profiles-social-graph/01 "integration seam"): the local view-state above
 * generalizes from a single `openThreadId` to a small discriminated union
 * (`ChannelView`) so "feed" / "thread" / "hashtag feed" / "profile" stay
 * MUTUALLY EXCLUSIVE by construction (no risk of e.g. a thread AND a hashtag
 * feed both being "open" at once) — still local `useState`, still no router
 * (Phase 1 has none; same rationale as `openThreadId`).
 *  - Hashtag feed: `<PostCard>`'s linkified hashtag anchors already carry
 *    `data-hashtag` (hashtags-trending/01's self-contained seam); rather than
 *    read that attribute via event delegation, this pass threads a typed
 *    `onHashtagOpen` prop through `<Feed>`/`<ThreadView>` → `<PostCard>` (the
 *    same optional-callback shape `onOpenThread` already uses) — type-safe,
 *    no `any`, and it never needs a capture-phase listener working around
 *    the hashtag anchor's own `stopPropagation()`.
 *  - Profile: a "View my profile" control (rendered above the feed, a sibling
 *    of `<PostCard>` — never nested inside one) opens the SESSION's own
 *    persona profile.
 *
 * ── FINAL INTEGRATION PASS (profiles-social-graph, #88) ─────────────────────
 * Three seams land here; everything they compose was built and unit-tested in
 * its own story.
 *
 * 1. AUTHOR TAP-THROUGH (SOC-050). A post's author identity now opens THAT
 *    author's profile. The trigger is a typed optional `onOpenProfile`
 *    callback threaded `SocialChannel` → `<Feed>` / `<ThreadView>` /
 *    `<HashtagFeed>` → `<PostCard>` — the same shape `onOpenThread` and
 *    `onHashtagOpen` already use: no event delegation, no reading `data-`
 *    attributes off the DOM, no `any`. `<PostCard>` renders it as a second
 *    transparent overlay button scoped to the author identity box, stacked
 *    above the card's own body-open overlay (see that file's header for why
 *    that shape and not a `<button>` wrapped around the name). It is a
 *    `useCallback` here for the same reason `openThread` is: `<Feed>`'s rows
 *    are `React.memo`'d and an unstable identity would re-render every row on
 *    every channel render, regressing burst legibility (NFR-002/SOC-071).
 *
 * 2. `<WhoToFollow>` (SOC-053) mounts in the FEED region, a sibling of the
 *    feed — never inside a `<PostCard>`. Because it lives in the feed region,
 *    which is `hidden` while a detail view is open, it is absent (removed from
 *    the a11y tree, not merely off-screen) from the thread / hashtag / profile
 *    views by construction, exactly like `<Composer>`.
 *
 * 3. ALL POSTS ↔ FOLLOWING (SOC-080/SOC-081). A WAI-ARIA tablist switches
 *    between the two feeds. The two scopes are mounted as SEPARATE `<Feed>`
 *    INSTANCES (the Following-feed builder's explicit recommendation), not as
 *    one instance whose `scope` prop flips: each instance then keeps its own
 *    frozen per-scope baseline (`useFeed` freezes on mount), its own one-shot
 *    mount `view` telemetry, and its own scroll position across a switch. The
 *    Following instance is mounted LAZILY — on the first switch to it, and
 *    kept mounted (hidden) afterwards — so its one-shot telemetry fires when
 *    the reader actually opens it, never at channel mount, and switching back
 *    and forth after that costs no refetch and no duplicate event.
 *
 *    COR-015: a read-only / no-persona session is served All Posts regardless
 *    — `useFeed` enforces that itself, so it is NOT re-implemented here. What
 *    IS decided here is the AFFORDANCE: such a session gets NO switch at all,
 *    because a Following tab it is not allowed to be served would be a control
 *    that silently does nothing. Absent-not-inert is the same convention
 *    `<Composer>` and `<FollowButton>` already follow (D1-011). The guard is
 *    deliberately BOTH axes — the shell mount variant AND the session — so an
 *    observer mount can never surface it either.
 *
 * FOCUS MANAGEMENT (NFR-001, closes SUG-001). The view-swap effect below moves
 * focus into the newly-opened detail region on a feed→detail transition AND on
 * a detail→detail one (thread → profile via an author tap, thread → hashtag
 * feed, hashtag feed → thread), and back to the feed region on close. Before
 * this pass only feed↔detail was handled, so a detail→detail swap left focus
 * on a control that had just been unmounted — the SUG-001 gap recorded in
 * `profiles-social-graph/01`, `hashtags-trending/01` and `threads-replies/01`.
 *
 * Phase 1 has no history stack, so "Back to feed" from a detail view opened
 * FROM another detail view returns to the feed, not to the previous detail —
 * the same behavior the hashtag→thread path already has. A back stack is a
 * routing concern for the phase that introduces a router.
 *
 * World: participant (Pulse skin) — no COBRA, no themed MUI, FontAwesome only,
 * plain semantic elements + a scoped CSS Module.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowLeft, faUser } from '@fortawesome/free-solid-svg-icons'
import { useSession } from '@/core/auth'
import {
  useShellContext,
  affordancesAvailable,
} from '@/features/participant-shell/mountContract'
import { Composer } from './components/Composer'
import { Feed } from './pages/Feed'
import { ThreadView } from './components/ThreadView'
import { HashtagFeed } from './pages/HashtagFeed'
import { Profile } from './pages/Profile'
import { WhoToFollow } from './components/WhoToFollow'
import styles from './SocialChannel.module.css'

/** The channel's mutually-exclusive local views (see module header). */
type ChannelView =
  | { readonly kind: 'feed' }
  | { readonly kind: 'thread'; readonly postId: string }
  | { readonly kind: 'hashtag'; readonly tag: string }
  | { readonly kind: 'profile'; readonly personaId: string }

/** The two mountable feed scopes, and the tablist that switches them. */
type FeedTabId = 'all' | 'following'

interface FeedTabSpec {
  readonly id: FeedTabId
  readonly label: string
}

const FEED_TABS: readonly FeedTabSpec[] = [
  { id: 'all', label: 'All Posts' },
  { id: 'following', label: 'Following' },
]

/**
 * How many "Who to follow" rows the inline module shows. A DISPLAY cap only —
 * it never changes which accounts are eligible or their planner-seeded order
 * (`WhoToFollow`/`whoToFollowService` own that, and nothing ranks anything).
 */
const WHO_TO_FOLLOW_LIMIT = 3

export function SocialChannel() {
  const { variant } = useShellContext()
  const session = useSession()
  const canCompose = affordancesAvailable(variant)

  // Local view state — Phase 1 has no cross-channel router (see module header).
  const [view, setView] = useState<ChannelView>({ kind: 'feed' })
  const isDetailView = view.kind !== 'feed'

  // Stable identities so the feed's memoized rows still skip re-render under
  // burst even though a callback is threaded down (NFR-002/SOC-071).
  const openThread = useCallback((id: string) => setView({ kind: 'thread', postId: id }), [])
  const openHashtagFeed = useCallback((tag: string) => setView({ kind: 'hashtag', tag }), [])
  const openProfile = useCallback(
    (personaId: string) => setView({ kind: 'profile', personaId }),
    [],
  )
  const backToFeed = useCallback(() => setView({ kind: 'feed' }), [])

  // The viewer's own persona, if any (observer/no-persona sessions have none —
  // "View my profile" is omitted then, mirroring Composer's own absent-not-
  // disabled convention for an unavailable affordance).
  const viewerPersonaId = session.personaId

  // ── All Posts ↔ Following (SOC-080/SOC-081; see module header) ────────────
  // Whether the switch is OFFERED at all. COR-015's "read-only/no-persona is
  // served All Posts regardless" is enforced by `useFeed` and NOT duplicated
  // here; this is only about the affordance, which such a session must not be
  // shown at all rather than shown doing nothing (D1-011). Guarded on BOTH the
  // shell mount variant and the session, mirroring `<Feed>`/`useFeed`'s own
  // `!isReadOnly && personaId !== undefined` predicate.
  const canUseFollowing = canCompose && !session.isReadOnly && viewerPersonaId !== undefined

  const [feedTab, setFeedTab] = useState<FeedTabId>('all')
  // The Following feed is mounted on FIRST switch and kept mounted after that
  // (hidden when inactive) — so its one-shot mount telemetry fires when the
  // reader opens it, and its frozen baseline + scroll position survive a
  // switch back to All Posts (module header).
  const [followingMounted, setFollowingMounted] = useState(false)

  const selectFeedTab = useCallback((tab: FeedTabId) => {
    if (tab === 'following') setFollowingMounted(true)
    setFeedTab(tab)
  }, [])

  // Roving arrow-key navigation across the tablist (NFR-001) — mirrors
  // `HashtagFeed`/`Profile`'s tablists.
  const handleFeedTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const { key } = event
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Home' && key !== 'End') return
    event.preventDefault()
    if (key === 'Home') {
      selectFeedTab('all')
      return
    }
    if (key === 'End') {
      selectFeedTab('following')
      return
    }
    selectFeedTab(feedTab === 'all' ? 'following' : 'all')
  }

  // Focus management for the in-channel view swap (NFR-001; SUG-001 resolved).
  // The feed below is HIDDEN (not unmounted) while a detail view is open, so
  // leaving focus on the just-activated control would strand it on a
  // `display:none` element — and a DETAIL→DETAIL swap (author tap from an open
  // thread, hashtag tap from a thread, thread open from a hashtag feed)
  // unmounts that control outright. Move focus INTO whichever detail region is
  // now showing on ANY transition that opens or REPLACES one, and back to the
  // feed region on close. Each region is `tabIndex={-1}` so it is a
  // programmatic-focus target without adding a keyboard tab stop. Only ONE
  // detail view is ever mounted at a time (the union above), so they share one
  // ref — React attaches the new region's ref before this passive effect runs,
  // so `detailRegionRef.current` is already the INCOMING region here.
  const feedRegionRef = useRef<HTMLDivElement>(null)
  const detailRegionRef = useRef<HTMLDivElement>(null)
  const prevViewRef = useRef<ChannelView>({ kind: 'feed' })
  useEffect(() => {
    const was = prevViewRef.current
    prevViewRef.current = view
    if (view.kind === 'feed') {
      // Closing a detail view. (`was === view` never holds on the mount pass:
      // the ref is seeded with its own literal, and both are 'feed', so no
      // focus is stolen on first render.)
      if (was.kind !== 'feed') feedRegionRef.current?.focus()
      return
    }
    // A detail view is showing. `was !== view` is true for feed→detail AND for
    // detail→detail (every `setView` builds a new object), and false for a
    // re-run where the view object didn't change.
    if (was !== view) detailRegionRef.current?.focus()
  }, [view])

  return (
    <div className={styles.channel} data-testid="social-channel">
      {/* The feed stays MOUNTED across a detail-view open/close — only hidden —
          so the compose draft, scroll position, resolved feed data, and the
          feed's emit-once view-telemetry guard all survive returning to it (no
          refetch, no duplicate feed-view). `.region` sets no `display`, so the
          `hidden` attribute's `display:none` is authoritative. */}
      <div
        ref={feedRegionRef}
        tabIndex={-1}
        hidden={isDetailView}
        className={styles.region}
        data-testid="social-feed-region"
      >
        {canCompose && <Composer />}
        {viewerPersonaId !== undefined && (
          <button
            type="button"
            className={styles.viewProfileLink}
            onClick={() => openProfile(viewerPersonaId)}
          >
            <FontAwesomeIcon icon={faUser} aria-hidden="true" className={styles.backIcon} />
            View my profile
          </button>
        )}

        {/* Suggestions module (SOC-053) — a SIBLING of the feed, never nested
            inside a `<PostCard>`. It lives in the feed region, so it is absent
            from every detail view along with the feed itself. */}
        <WhoToFollow limit={WHO_TO_FOLLOW_LIMIT} />

        {/* All Posts ↔ Following (SOC-081). Absent entirely for an observer /
            read-only / no-persona session — see `canUseFollowing`. */}
        {canUseFollowing && (
          <div className={styles.feedTabs} role="tablist" aria-label="Feed">
            {FEED_TABS.map(tab => {
              const selected = tab.id === feedTab
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`social-feed-tab-${tab.id}`}
                  aria-selected={selected}
                  aria-controls={`social-feed-panel-${tab.id}`}
                  tabIndex={selected ? 0 : -1}
                  className={
                    selected ? `${styles.feedTab} ${styles.feedTabActive}` : styles.feedTab
                  }
                  onClick={() => selectFeedTab(tab.id)}
                  onKeyDown={handleFeedTabKeyDown}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        )}

        {/* TWO SEPARATE `<Feed>` INSTANCES, not one with a flipping `scope`
            (module header): each keeps its own frozen baseline, its own
            one-shot mount telemetry, and its own scroll position. The
            wrappers carry NO class, so the `hidden` attribute's `display:none`
            is authoritative — the same trick the feed/detail regions use. */}
        <div
          role={canUseFollowing ? 'tabpanel' : undefined}
          id="social-feed-panel-all"
          aria-labelledby={canUseFollowing ? 'social-feed-tab-all' : undefined}
          hidden={feedTab !== 'all'}
          data-testid="social-feed-panel-all"
        >
          <Feed
            key="feed-all"
            scope="all"
            onOpenThread={openThread}
            onHashtagOpen={openHashtagFeed}
            onOpenProfile={openProfile}
          />
        </div>

        {followingMounted && (
          <div
            role="tabpanel"
            id="social-feed-panel-following"
            aria-labelledby="social-feed-tab-following"
            hidden={feedTab !== 'following'}
            data-testid="social-feed-panel-following"
          >
            <Feed
              key="feed-following"
              scope="following"
              onOpenThread={openThread}
              onHashtagOpen={openHashtagFeed}
              onOpenProfile={openProfile}
            />
          </div>
        )}
      </div>

      {view.kind === 'thread' && (
        <div
          ref={detailRegionRef}
          tabIndex={-1}
          className={styles.region}
          data-testid="social-thread-region"
        >
          <button type="button" className={styles.back} onClick={backToFeed}>
            <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" className={styles.backIcon} />
            Back to feed
          </button>
          <ThreadView
            focusedPostId={view.postId}
            onHashtagOpen={openHashtagFeed}
            onOpenProfile={openProfile}
          />
        </div>
      )}

      {view.kind === 'hashtag' && (
        <div
          ref={detailRegionRef}
          tabIndex={-1}
          className={styles.region}
          data-testid="social-hashtag-region"
        >
          <button type="button" className={styles.back} onClick={backToFeed}>
            <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" className={styles.backIcon} />
            Back to feed
          </button>
          <HashtagFeed
            tag={view.tag}
            onOpenThread={openThread}
            onOpenProfile={openProfile}
          />
        </div>
      )}

      {view.kind === 'profile' && (
        <div
          ref={detailRegionRef}
          tabIndex={-1}
          className={styles.region}
          data-testid="social-profile-region"
        >
          <button type="button" className={styles.back} onClick={backToFeed}>
            <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" className={styles.backIcon} />
            Back to feed
          </button>
          <Profile personaId={view.personaId} />
        </div>
      )}
    </div>
  )
}
