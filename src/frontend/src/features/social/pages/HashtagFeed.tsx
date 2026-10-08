/**
 * features/social/pages/HashtagFeed.tsx
 * ---------------------------------------------------------------------------
 * The hashtag feed (`/hashtag/:tag`) — the posts carrying one hashtag, with a "Recent"
 * (scenario time descending) and a "Top" (engagement descending) tab (feature:
 * hashtags-trending/01; demo-polish F6; SOC-040, COR-001, COR-053, XC-004, NFR-001).
 * Participant world (Pulse Social skin): plain semantic elements + a scoped CSS
 * Module — NO COBRA, NO themed MUI, FontAwesome-only.
 *
 * WHAT IT DOES
 *  - Reads the exercise's All Posts feed (`useFeed()`, the same participant-safe,
 *    exercise-scoped read the main feed uses) and keeps the posts whose text carries
 *    the tag (`extractHashtags`, the one definition of "what a hashtag is"). Each one
 *    renders through the keystone `<PostCard>` — identical card, identical
 *    scenario-time rendering, live like/repost — so this page is filtering and
 *    presentation only.
 *  - HEADER: the tag as authors write it (`#WaterIssues`, the casing used most — the
 *    URL key is lowercase) and a post count ("16 posts"), shown once the posts have
 *    loaded, never a premature "0 posts". The `tag` prop may be any URL-ish form
 *    (`WaterIssues`, `#waterissues`, `%23waterissues`); `tagKey` normalizes it.
 *  - TABS (WAI-ARIA tabs pattern, NFR-001): unique `id` + `aria-controls`, a panel
 *    labelled by the active tab, and a roving tabindex (Arrow/Home/End) so only the
 *    active tab is in the natural Tab order — mirroring `Profile.tsx`. Tab state is
 *    local. Both orders come from `../explore/search`'s `sortPosts`, shared with
 *    Explore's search toggle; "Top" ties break newest-first.
 *  - EMPTY / ERROR: an honest text state with an icon ("No posts with #tag yet."), and
 *    a separate message when the posts could not be read (an outage is not an empty
 *    hashtag). A soft-deleted post is neither listed nor counted.
 *  - REPLY: a card's Reply opens its thread with the composer focused
 *    (`requestReplyFocus` then `onOpenThread`); with no `onOpenThread` Reply renders
 *    as inert text, never a no-op button.
 *  - HASHTAGS IN A CARD: a card's own `#Other` is a link to THAT hashtag's feed
 *    (`onHashtagOpen`, threaded to every card; Gate-2 M-4). Without it the anchors stay
 *    inert, so a hashtag page could not be left by tapping another tag.
 *  - IDS: the heading, the tabs and the panel get `useId()`-based ids, so two instances
 *    of the page (or a page beside another tablist) never collide on a static id.
 *
 * ISOLATION (COR-001): `useFeed()` takes no client `exerciseId`; filtering happens
 * over that already-scoped set. SCENARIO TIME (COR-053): this page renders no
 * timestamp itself; each card does. Wall-clock is read once for the telemetry
 * envelope only, never rendered.
 *
 * VARIANT (COR-015 / D1-011): cards render `full` or `readOnly` per the shell mount
 * variant, so an observer sees inert counts with the controls ABSENT.
 *
 * TELEMETRY (XC-004): ONE `'view'` per tag (a ref keyed on the normalized tag,
 * mirroring `ThreadView`), so a different hashtag re-emits without a remount, but a
 * Recent/Top switch does not.
 */

import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
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
import { normalizeHashtagParam } from '../layout/socialNavigation'
import { requestReplyFocus } from '../services/replyIntent'
import { extractHashtags } from '../utils/hashtags'
import { sortPosts } from '../explore/search'
import { pickDisplayCasing } from '../explore/trending'
import { isVisiblePost } from '../explore/visibility'
import styles from './HashtagFeed.module.css'

type CardVariant = 'full' | 'readOnly'
type HashtagTab = 'recent' | 'top'

export interface HashtagFeedProps {
  /**
   * The hashtag to show, in any URL-ish form (`WaterIssues`, `#WaterIssues`,
   * `%23waterissues`): the page decodes, strips `#` and lowercases it itself
   * (`tagKey`) -- the same key `extractHashtags` and the linkified anchors produce.
   */
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
  /**
   * Opens the tapped hashtag's feed (SOC-040) -- the same opener the main feed's cards
   * get -- so a card on this page can lead to a DIFFERENT hashtag. Omitted in
   * isolation: the cards' hashtags stay inert text.
   */
  readonly onHashtagOpen?: (tag: string) => void
}

interface HashtagRowProps {
  post: PostView
  variant: CardVariant
  onOpenThread?: (id: string) => void
  onReply?: (id: string) => void
  onOpenProfile?: (personaId: string) => void
  onHashtagOpen?: (tag: string) => void
}

/** A single row, memoized so an unchanged post skips re-render (NFR-002/
 * SOC-071) — props are a referentially-stable `PostView` + primitives. */
const HashtagRow = memo(function HashtagRow({
  post,
  variant,
  onOpenThread,
  onReply,
  onOpenProfile,
  onHashtagOpen,
}: HashtagRowProps) {
  return (
    <li className={styles.row}>
      <PostCard
        post={post}
        variant={variant}
        onOpen={onOpenThread}
        onReply={onReply}
        onOpenProfile={onOpenProfile}
        onHashtagOpen={onHashtagOpen}
      />
    </li>
  )
})

/**
 * The Reply action on a card: record the intent, then open the thread, whose reply
 * composer takes focus on arrival (F4's `requestReplyFocus` handoff).
 */
function openThreadForReply(id: string, onOpenThread: (id: string) => void): void {
  requestReplyFocus(id)
  onOpenThread(id)
}

/**
 * The routing key for whatever form of the tag arrived: URL-decoded (a malformed
 * escape keeps the raw text), `#`-stripped, lowercased. F1's `normalizeHashtagParam`
 * does the strip + lowercase + validation; a string it rejects (not a possible
 * hashtag) still gets a best-effort key, so the page renders its honest empty state
 * for it rather than throwing.
 */
function tagKey(raw: string): string {
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    // keep the raw text
  }
  return normalizeHashtagParam(decoded) ?? decoded.replace(/^#+/, '').toLowerCase()
}

/** "1 post" / "16 posts". */
function postCountLabel(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'post' : 'posts'}`
}

export function HashtagFeed({
  tag: rawTag,
  onOpenThread,
  onOpenProfile,
  onHashtagOpen,
}: HashtagFeedProps) {
  const tag = useMemo(() => tagKey(rawTag), [rawTag])
  // Unique per instance: the heading, tabs and panel ids (see the module header).
  const idBase = useId()
  const headingId = `${idBase}-heading`
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
  // How the tag reads on the page: the casing authors use most (`#WaterIssues`), else
  // the routing key.
  const label = useMemo(() => pickDisplayCasing(matched, tag) ?? `#${tag}`, [matched, tag])

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
    <section className={styles.page} aria-labelledby={headingId}>
      <header className={styles.header}>
        <h1 id={headingId} className={styles.title}>{label}</h1>
        {/* The count appears once the posts are in (never a premature "0 posts"). */}
        {!loading && error === undefined && (
          <p className={styles.subtitle} data-testid="hashtag-post-count">
            {postCountLabel(matched.length)}
          </p>
        )}
      </header>

      <div className={styles.tabs} role="tablist" aria-label={`${label} feed order`}>
        <TabButton
          idBase={idBase}
          id="recent"
          label="Recent"
          active={tab === 'recent'}
          onSelect={setTab}
          onKeyDown={handleTabKeyDown}
        />
        <TabButton
          idBase={idBase}
          id="top"
          label="Top"
          active={tab === 'top'}
          onSelect={setTab}
          onKeyDown={handleTabKeyDown}
        />
      </div>

      <ul
        className={styles.list}
        role="tabpanel"
        id={tabpanelId(idBase, tab)}
        aria-labelledby={tabId(idBase, tab)}
        aria-label={`${label}, ${tab === 'top' ? 'Top' : 'Recent'}`}
      >
        {shown.map(post => (
          <HashtagRow
            key={post.id}
            post={post}
            variant={cardVariant}
            onOpenThread={onOpenThread}
            onReply={handleReply}
            onOpenProfile={onOpenProfile}
            onHashtagOpen={onHashtagOpen}
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
          <p className={styles.emptyText}>{`No posts with ${label} yet.`}</p>
        </div>
      )}
    </section>
  )
}

/** The tab / panel DOM ids for one page instance (`useId()` base + the tab name). */
function tabId(idBase: string, tab: HashtagTab): string {
  return `${idBase}-tab-${tab}`
}
function tabpanelId(idBase: string, tab: HashtagTab): string {
  return `${idBase}-tabpanel-${tab}`
}

interface TabButtonProps {
  /** The page instance's `useId()` base, so two pages never share a tab id. */
  idBase: string
  id: HashtagTab
  label: string
  active: boolean
  onSelect: (tab: HashtagTab) => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}

/** A tab, programmatically associated with its panel per the WAI-ARIA tabs
 * pattern (NFR-001): a unique `id` + `aria-controls` pointing at the panel
 * `TabButton`'s active sibling renders (`tabpanelId(idBase, id)`), and a roving
 * `tabIndex` (0 when active, -1 otherwise) so only the active tab is Tab-reachable. */
function TabButton({ idBase, id, label, active, onSelect, onKeyDown }: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      id={tabId(idBase, id)}
      aria-selected={active}
      aria-controls={tabpanelId(idBase, id)}
      tabIndex={active ? 0 : -1}
      className={active ? `${styles.tab} ${styles.tabActive}` : styles.tab}
      onClick={() => onSelect(id)}
      onKeyDown={onKeyDown}
    >
      {label}
    </button>
  )
}
