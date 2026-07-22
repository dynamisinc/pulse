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
 *  - Profile: profiles-social-graph/01's own AC set has no "tap the author
 *    name to open a profile" checkbox — that trigger is a SEPARATE, not-yet-
 *    built interaction (it would need carving a new clickable target out of
 *    `<PostCard>`'s header, which is currently ONE nested `onOpen` region —
 *    doing that here would be over-building past this pass's named seam).
 *    What IS wired now is a real, minimal, self-contained entry point: a
 *    "View my profile" control (rendered above the feed, a sibling of
 *    `<PostCard>` — never nested inside one) that opens the SESSION's own
 *    persona profile. This satisfies "the profile view is reachable" without
 *    building any follow/tap-through UI (that remains stories 02/04's job).
 *
 * World: participant (Pulse skin) — no COBRA, no themed MUI, FontAwesome only,
 * plain semantic elements + a scoped CSS Module.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
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
import styles from './SocialChannel.module.css'

/** The channel's mutually-exclusive local views (see module header). */
type ChannelView =
  | { readonly kind: 'feed' }
  | { readonly kind: 'thread'; readonly postId: string }
  | { readonly kind: 'hashtag'; readonly tag: string }
  | { readonly kind: 'profile'; readonly personaId: string }

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

  // Focus management for the in-channel view swap (NFR-001). The feed below is
  // HIDDEN (not unmounted) while a detail view is open, so leaving focus on the
  // just-activated control would strand it on a `display:none` element — move
  // focus INTO the detail view on open, and back to the feed region on close.
  // Each region is `tabIndex={-1}` so it is a programmatic-focus target
  // without adding a keyboard tab stop. Only ONE detail view is ever mounted
  // at a time (the union above), so they share one ref.
  const feedRegionRef = useRef<HTMLDivElement>(null)
  const detailRegionRef = useRef<HTMLDivElement>(null)
  const prevViewRef = useRef<ChannelView>({ kind: 'feed' })
  useEffect(() => {
    const was = prevViewRef.current
    prevViewRef.current = view
    if (was.kind === 'feed' && view.kind !== 'feed') {
      detailRegionRef.current?.focus()
    } else if (was.kind !== 'feed' && view.kind === 'feed') {
      feedRegionRef.current?.focus()
    }
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
        <Feed onOpenThread={openThread} onHashtagOpen={openHashtagFeed} />
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
          <ThreadView focusedPostId={view.postId} onHashtagOpen={openHashtagFeed} />
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
          <HashtagFeed tag={view.tag} onOpenThread={openThread} />
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
