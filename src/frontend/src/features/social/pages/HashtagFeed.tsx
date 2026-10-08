/**
 * features/social/pages/HashtagFeed.tsx
 * ---------------------------------------------------------------------------
 * The hashtag feed — the posts carrying one hashtag, with a chronological
 * ("Recent") and an engagement-ranked ("Top") tab (feature: hashtags-trending,
 * story 01; demo-polish F6 story 15-explore polish; SOC-040, COR-001, COR-053,
 * XC-004, NFR-001). Participant world (Pulse Social skin): plain semantic
 * elements + a scoped CSS Module — NO COBRA, NO themed MUI, FontAwesome-only.
 *
 * DEMO-POLISH F6 (what changed over story 01). The page now has a HEADER (the
 * `#tag` title plus a post-count line, "16 posts" — shown once the posts have
 * loaded, never a premature "0 posts"), the tabs are labelled "Recent" / "Top"
 * (was "Latest"; same chronological / engagement orders, shared with Explore's
 * search toggle via `../explore/search`), and the empty state is an explicit,
 * honest text message with an icon. The CSS drops its dark-mode rules (the social
 * surface is forced light, F5) and reads the shared `--pc-*` tokens. Cards keep
 * their live actions — those come from `PostCard`, not from this page.
 *
 * WHAT IT DOES
 *  - Reuses the exercise's All Posts read (`useFeed()` — the same
 *    participant-safe, exercise-scoped convergence the main feed uses) and
 *    filters it to the posts whose text contains `tag`, via `extractHashtags`
 *    (`../utils/hashtags`, the one definition of "what a hashtag is"). Each
 *    surviving post renders through the keystone `<PostCard>` — identical card,
 *    identical scenario-time rendering — so this page is pure presentation +
 *    filtering, never a second post-rendering path.
 *  - Two tabs (SOC-040): "Recent" = chronological (scenario time descending),
 *    "Top" = ranked by engagement (like + repost + reply + share), newest-first
 *    as the tiebreak (both orders from `../explore/search`'s `sortPosts`). Tab
 *    state is local `useState` (no route — Phase 1 has no cross-channel router;
 *    see `SocialChannel`). The tablist follows the WAI-ARIA tabs pattern
 *    (NFR-001): each tab carries a unique `id` + `aria-controls` pointing at
 *    the panel, the panel carries an `id` + `aria-labelledby` pointing back at
 *    the active tab, and a roving tabindex (active tab `tabIndex=0`, inactive
 *    `tabIndex=-1`, Arrow/Home/End to move) keeps only the active tab in the
 *    natural Tab order — mirroring `Profile.tsx`'s tablist.
 *
 * ISOLATION (COR-001). The post set comes from `useFeed()`, which takes NO
 * client `exerciseId` — the session binds the exercise and query scoping is
 * server-side. Filtering by hashtag happens over that already-scoped set, so a
 * hashtag feed can never surface another exercise's posts.
 *
 * SCENARIO TIME (COR-053). This page renders no timestamp itself — every
 * `<PostCard>` self-renders its relative "2h ago" via `useScenarioTime()` in
 * the exercise zone. Wall-clock is read ONCE here for the telemetry envelope
 * only (`wallClockNowIso()`), never rendered.
 *
 * VARIANT (COR-015 / D1-011). The shell mount variant is read via
 * `useShellContext()`; cards render `full` or `readOnly` exactly as the All
 * Posts feed does, so an observer session sees inert counts with the
 * interactive controls ABSENT. `onOpenThread` (supplied by the shell channel at
 * integration — Wave 2) opens a post's thread from a card tap or reply.
 *
 * TELEMETRY (XC-004). Emits exactly ONE `'view'` event per `tag` (a ref keyed
 * on the tag, mirroring `ThreadView`), targeting the hashtag entity — so a
 * different hashtag re-emits without a remount, but switching the Recent/Top
 * tab does not (a tab switch is not a new view).
 *
 * REACHABILITY NOTE. Wiring a hashtag TAP (in a `<PostCard>`) to open this page
 * is the shell-channel view-composition change owned by the Wave-2 orchestrator
 * pass (`SocialChannel`, alongside profile navigation) — see
 * docs/features/hashtags-trending/implementation.md. This page is built and
 * self-contained now; the `data-hashtag` seam the linkified anchors carry is
 * what that pass reads.
 */

import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faHashtag } from '@fortawesome/free-solid-svg-icons'
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
import { extractHashtags } from '../utils/hashtags'
import { sortPosts } from '../explore/search'
import { isVisiblePost } from '../explore/visibility'
import styles from './HashtagFeed.module.css'

type CardVariant = 'full' | 'readOnly'
type HashtagTab = 'recent' | 'top'

export interface HashtagFeedProps {
  /** The hashtag to show, NORMALIZED (lowercased, no leading `#`) — the same
   * key `extractHashtags`/the linkified anchors produce. */
  readonly tag: string
  /** Opens a post's flattened thread; the shell channel supplies it at
   * integration (Wave 2). Omitted in isolation — the feed still renders. */
  readonly onOpenThread?: (id: string) => void
  /**
   * Opens the tapped AUTHOR's profile (SOC-050); the shell channel supplies
   * it, so the author tap-through works from inside a hashtag feed too, not
   * only from the main feed. Omitted in isolation — the author identity stays
   * inert text (no focusable no-op, WR-002).
   */
  readonly onOpenProfile?: (personaId: string) => void
}

interface HashtagRowProps {
  post: PostView
  variant: CardVariant
  onOpenThread?: (id: string) => void
  onReply?: (id: string) => void
  onOpenProfile?: (personaId: string) => void
}

/** A single row, memoized so an unchanged post skips re-render (NFR-002/
 * SOC-071) — props are a referentially-stable `PostView` + primitives. */
const HashtagRow = memo(function HashtagRow({
  post,
  variant,
  onOpenThread,
  onReply,
  onOpenProfile,
}: HashtagRowProps) {
  return (
    <li className={styles.row}>
      <PostCard
        post={post}
        variant={variant}
        onOpen={onOpenThread}
        onReply={onReply}
        onOpenProfile={onOpenProfile}
      />
    </li>
  )
})

/**
 * The Reply action on a card: opens the post's thread (the reader replies from
 * there). Kept as its own function so the one line F4 changes is obvious.
 */
function openThreadForReply(id: string, onOpenThread: (id: string) => void): void {
  // TODO(F4-merge): call F4's `requestReplyFocus(id)` (`../services/replyIntent`)
  // HERE, before opening the thread, so the thread's reply composer takes focus:
  //   requestReplyFocus(id)
  //   onOpenThread(id)
  onOpenThread(id)
}

/** "1 post" / "16 posts". */
function postCountLabel(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'post' : 'posts'}`
}

export function HashtagFeed({ tag, onOpenThread, onOpenProfile }: HashtagFeedProps) {
  const { exerciseId, timeZone } = useExerciseContext()
  const session = useSession()
  const { variant } = useShellContext()
  const { posts, loading, error } = useFeed()

  const cardVariant: CardVariant = affordancesAvailable(variant) ? 'full' : 'readOnly'

  // Local tab state — defaults to chronological "Recent".
  const [tab, setTab] = useState<HashtagTab>('recent')

  // Posts carrying this hashtag, already exercise-scoped by `useFeed` (a
  // soft-deleted post would never count). `sortPosts` (shared with Explore's
  // search toggle) gives both orders: 'recent' = scenario time descending,
  // 'top' = engagement descending with newest-first as the tiebreak.
  const matched = useMemo(
    () => posts.filter(post => isVisiblePost(post) && extractHashtags(post.text).includes(tag)),
    [posts, tag],
  )
  const shown = useMemo(() => sortPosts(matched, tab), [matched, tab])

  // The Reply action opens the thread. Stable identity so the memoized rows skip
  // re-render (NFR-002/SOC-071); absent when no thread opener was supplied, so
  // the card renders Reply as inert text rather than a no-op button.
  const handleReply = useMemo(
    () =>
      onOpenThread === undefined
        ? undefined
        : (id: string) => openThreadForReply(id, onOpenThread),
    [onOpenThread],
  )

  // XC-004: one 'view' per hashtag. Keying the ref on `tag` re-emits when the
  // page is re-pointed at a DIFFERENT hashtag without a remount, but a
  // Recent/Top tab switch (not a new view) does not.
  const emittedForRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (emittedForRef.current === tag) return
    emittedForRef.current = tag
    buildAndEmit({
      exerciseId,
      eventType: 'view',
      channel: 'social',
      actor: { kind: 'participant', participantId: session.accountId },
      wallClockTime: wallClockNowIso(),
      scenarioTime: scenarioNow().toISOString(),
      timeZone,
      target: { entityType: 'hashtag', entityId: tag },
    })
  }, [tag, exerciseId, timeZone, session.accountId])

  const isEmpty = !loading && error === undefined && matched.length === 0

  // Roving tabindex (NFR-001): Arrow/Home/End moves selection between the two
  // tabs — mirroring Profile.tsx's tablist — so only the active tab sits in the
  // natural Tab order (inactive tabs carry tabIndex={-1}).
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    setTab(current => (current === 'recent' ? 'top' : 'recent'))
  }

  return (
    <section className={styles.page} aria-labelledby="hashtag-feed-heading">
      <header className={styles.header}>
        <h1 id="hashtag-feed-heading" className={styles.title}>{`#${tag}`}</h1>
        {/* The count appears once the posts are in (never a premature "0 posts"). */}
        {!loading && error === undefined && (
          <p className={styles.subtitle} data-testid="hashtag-post-count">
            {postCountLabel(matched.length)}
          </p>
        )}
      </header>

      <div className={styles.tabs} role="tablist" aria-label={`#${tag} feed order`}>
        <TabButton
          id="recent"
          label="Recent"
          active={tab === 'recent'}
          onSelect={setTab}
          onKeyDown={handleTabKeyDown}
        />
        <TabButton
          id="top"
          label="Top"
          active={tab === 'top'}
          onSelect={setTab}
          onKeyDown={handleTabKeyDown}
        />
      </div>

      <ul
        className={styles.list}
        aria-live="polite"
        role="tabpanel"
        id={`hashtag-tabpanel-${tab}`}
        aria-labelledby={`hashtag-tab-${tab}`}
        aria-label={`#${tag}, ${tab === 'top' ? 'Top' : 'Recent'}`}
      >
        {shown.map(post => (
          <HashtagRow
            key={post.id}
            post={post}
            variant={cardVariant}
            onOpenThread={onOpenThread}
            onReply={handleReply}
            onOpenProfile={onOpenProfile}
          />
        ))}
      </ul>

      {loading && matched.length === 0 && (
        <p className={styles.state} role="status">Loading posts…</p>
      )}
      {!loading && error !== undefined && matched.length === 0 && (
        <p className={styles.state} role="status">Posts aren’t available right now.</p>
      )}
      {isEmpty && (
        <div className={styles.empty} data-testid="hashtag-empty">
          <FontAwesomeIcon icon={faHashtag} className={styles.emptyIcon} aria-hidden="true" />
          <p className={styles.emptyText}>{`No posts with #${tag} yet.`}</p>
        </div>
      )}
    </section>
  )
}

interface TabButtonProps {
  id: HashtagTab
  label: string
  active: boolean
  onSelect: (tab: HashtagTab) => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}

/** A tab, programmatically associated with its panel per the WAI-ARIA tabs
 * pattern (NFR-001): a unique `id` + `aria-controls` pointing at the panel
 * `TabButton`'s active sibling renders (`hashtag-tabpanel-${id}`), and a roving
 * `tabIndex` (0 when active, -1 otherwise) so only the active tab is Tab-reachable. */
function TabButton({ id, label, active, onSelect, onKeyDown }: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      id={`hashtag-tab-${id}`}
      aria-selected={active}
      aria-controls={`hashtag-tabpanel-${id}`}
      tabIndex={active ? 0 : -1}
      className={active ? `${styles.tab} ${styles.tabActive}` : styles.tab}
      onClick={() => onSelect(id)}
      onKeyDown={onKeyDown}
    >
      {label}
    </button>
  )
}
