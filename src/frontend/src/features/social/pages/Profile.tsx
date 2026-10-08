/**
 * features/social/pages/Profile.tsx
 * ---------------------------------------------------------------------------
 * The persona/participant PROFILE page (feature: profiles-social-graph, story
 * 01; SOC-050). Participant world (Pulse Social skin): plain semantic elements
 * + a scoped CSS Module — NO COBRA, NO themed MUI, FontAwesome-only icons.
 *
 * WHAT IT DOES
 *  - Renders one persona's identity hero: a banner (the persona's `bannerUrl`
 *    photo over an accent-tinted fallback, COR-030, via `--pulse-ac`), the
 *    avatar (reused `<Avatar>` — the persona's photo, else the R-004 duotone
 *    silhouette for humans / monogram for orgs), display name + the fixed
 *    seal-blue `<VerifiedMark>` when `persona.verified` (the trainable trust
 *    signal, SOC-052/story 03 — rendered by presence/absence only, never a
 *    substitute "unverified" badge), handle, bio, a meta row (location when the
 *    persona has one; joined date, in scenario time), and the follower/following
 *    counts.
 *  - Renders four REAL tabs (demo-polish F5), each over the exercise-scoped
 *    post set, cards through the keystone `<PostCard>`:
 *      Posts            authored, top-level            (`useFeed()`)
 *      Posts & replies  authored, replies included     (`resolveFeed('all',
 *                       { includeReplies: true })` via `useFeedWithReplies`, DP-5)
 *      Media            authored posts that carry media, as a thumbnail grid
 *                       (F2's `<MediaTabGrid>`; a card list is not used here)
 *      Likes            OWN profile only: the posts the viewer has liked
 *                       (`viewer.liked` on the includeReplies set). Anyone
 *                       else's profile says "Likes are private." — never fake
 *                       entries (D1-012).
 *    Replies/Likes are fetched lazily, the first time one of those tabs opens.
 *  - Forwards `onOpenThread` / `onHashtagOpen` (and, optionally, `onOpenProfile`)
 *    to every card, and wires Reply to open the thread (see REPLY below).
 *
 * LIKES IN MOCK MODE: the own-profile Likes tab reads `viewer.liked` from the
 * feed response. In live mode that is the server's per-persona truth. In dev
 * (mock) the reactions adapter persists a tap in its own store and does NOT write
 * `postStore.viewer`, so a like made in this session shows up here only for posts
 * seeded as liked; it is not reflected until the mock store learns the like. Known
 * and accepted for the demo (the live path is correct).
 *
 * PURE CONSUMER: this page composes `<PostCard>`/`<VerifiedMark>`/`<Avatar>`/
 * `<MediaTabGrid>` and reuses the shipped read seams (`useFeed`, `usePersonas`) —
 * it defines no new data model. It is rendered with a `personaId`; reaching a
 * profile from a post tap is the host's wiring (`onOpenProfile` upstream).
 *
 * SCENARIO TIME (COR-053): the joined date renders via `useScenarioTime()` bound
 * to `useExerciseContext().timeZone` — scenario time, never wall-clock. Backdated
 * join instants (E1 COR-023 — the seeded `joinedAt` predates the exercise) render
 * correctly through the same path. Each `<PostCard>` self-renders its own
 * relative post timestamp in scenario time.
 *
 * EXERCISE SCOPE (COR-001): the persona cast and the post set come from
 * `usePersonas()` / `useFeed()`, whose reads take NO client `exerciseId` — the
 * session binds the exercise and query isolation is enforced server-side. Every
 * tab filters that already-scoped set; nothing here can reach another exercise's
 * content.
 *
 * TELEMETRY (XC-004): emits exactly ONE `'view'` event per `persona.id` (a ref
 * storing the last-emitted persona id, mirroring `HashtagFeed`'s tag-keyed ref)
 * — a re-render or StrictMode double-invoke on the SAME id can't re-emit, but if
 * a future profile-to-profile navigation reuses this already-mounted page with a
 * DIFFERENT `personaId` (no unmount), the id change re-emits exactly once. Events
 * carry a `profile` target and participant attribution (`actor.participantId` =
 * the session `accountId`, present for read-only sessions too — satisfies the
 * view superRefine). `wallClockTime` is telemetry-only and never rendered.
 *
 * MODEL NOTE — location/link + following count: `Persona` now carries an optional
 * `location` (rendered in the meta row when present; no website/link field exists
 * yet) and `bannerUrl`. The "Following" count is the persona's real outbound
 * edge count (`followingCount`, story 07), 0 only for a fixture that predates it.
 * Follower magnitude BANDING is story 05 (`formatMagnitude`).
 *
 * FOLLOW CONTROL (story 02 integration, SOC-051 — CR-002/CR-003):
 *  - The viewer's own follow state is RESOLVED here (`resolveFollowing(session
 *    .personaId)`, the same directed read `useWhoToFollow` uses) and handed to
 *    `<FollowButton>` as `initiallyFollowing`. `useFollow` seeds `isFollowing`
 *    ONCE, so the control is WITHHELD until that resolves rather than mounted
 *    with a placeholder — no frame ever paints the wrong state, and the button
 *    is additionally keyed on the resolved value so a later change remounts it
 *    instead of silently keeping a stale seed.
 *  - The header's follower figure is kept in step with the button's own
 *    optimistic ±1 via `onFollowerCountChange` (a STABLE `useCallback` —
 *    SG-003: that effect depends on the callback's identity). Without it the
 *    header sat frozen on `persona.followerCount` while the button read
 *    "Following".
 *
 * READ-ONLY VARIANT (WR-003, COR-015/D1-011): the shell mount variant is read
 * via `useShellContext()`, exactly like `<Feed>` — `affordancesAvailable(variant)`
 * decides `cardVariant` (`'full'` | `'readOnly'`), threaded into every
 * `<PostCard>` this page renders (all four tabs, via `ProfilePostList`). An
 * observer/read-only session therefore sees the SAME "controls absent, counts
 * inert" treatment here that `<Feed>` already gave it — counts and post content
 * stay fully visible; only the interactive reply/repost/like affordances go.
 *
 * REPLY (Gate-2 items 7/15). When the host supplies `onOpenThread`, every card also
 * gets `onReply`, which opens that post's thread (and, once F4's reply-intent seam
 * is merged, asks for the composer to be focused there — see the `TODO(F4-merge)`
 * in `replyToPost`). Without `onOpenThread` the card's Reply stays inert text by
 * design: `PostActions` renders no focusable no-op (WR-002).
 */

import {
  memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent,
} from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCalendarDay, faLocationDot, faLock } from '@fortawesome/free-solid-svg-icons'
import { useExerciseContext } from '@/core/exerciseContext'
import { useSession } from '@/core/auth'
import { scenarioNow, useScenarioTime } from '@/core/clock'
import { wallClockNowIso } from '@/core/time/wallClock'
import { buildAndEmit } from '@/core/telemetry'
import {
  PostCard, VerifiedMark, Avatar, FollowerList, formatMagnitude, type PostView,
} from '@/features/social'
import { usePersonas } from '@/features/personas'
import { FollowButton } from '../components/FollowButton'
import { FeedSkeleton } from '../components/FeedSkeleton'
import { ProfileSkeleton } from '../components/ProfileSkeleton'
import { MediaTabGrid } from '../components/media/MediaTabGrid'
import { resolveFollowers, resolveFollowing } from '../services/followService'
import {
  useShellContext,
  affordancesAvailable,
} from '@/features/participant-shell/mountContract'
import { useFeed } from '../hooks/useFeed'
import { useFeedWithReplies } from '../hooks/useFeedWithReplies'
import { safeImageUrl } from '../utils/safeImageUrl'
import styles from './Profile.module.css'

/** Mirrors `Feed.tsx`'s local `CardVariant` — the two `<PostCard>` render
 * modes a shell variant maps to (COR-015/D1-011). */
type CardVariant = 'full' | 'readOnly'

/** The profile avatar diameter (larger than the 42px post-card scale). */
const PROFILE_AVATAR_SIZE = 80
/** The profile verified-mark scale (larger than the 16px post-card scale). */
const PROFILE_MARK_SIZE = 22

/** The four profile tabs (SOC-050). `id` doubles as the telemetry-safe key. */
type ProfileTabId = 'posts' | 'replies' | 'media' | 'likes'

interface ProfileTabSpec {
  readonly id: ProfileTabId
  readonly label: string
}

const PROFILE_TABS: readonly ProfileTabSpec[] = [
  { id: 'posts', label: 'Posts' },
  { id: 'replies', label: 'Posts & replies' },
  { id: 'media', label: 'Media' },
  { id: 'likes', label: 'Likes' },
]

interface ProfilePostListProps {
  readonly posts: readonly PostView[]
  /** The calm in-fiction line shown when the tab is loaded and has nothing. */
  readonly emptyLabel: string
  /** True while the tab's posts are still loading and there is nothing to show yet. */
  readonly loading: boolean
  /** WR-003: threaded from the shell variant (COR-015/D1-011) into every
   * `<PostCard>` this list renders. */
  readonly variant: CardVariant
  /** Forwarded to each card; every one is optional and absent-means-inert. */
  readonly onOpenThread?: (postId: string) => void
  readonly onReply?: (postId: string) => void
  readonly onHashtagOpen?: (tag: string) => void
  readonly onOpenProfile?: (personaId: string) => void
}

/**
 * A tab's post list, memoized on its inputs so switching tabs (or a parent
 * re-render) doesn't needlessly re-render an unchanged list under burst
 * (NFR-002/SOC-071). While loading it shows the feed skeleton (never "Loading…"
 * text); once loaded it renders the calm in-fiction empty state when the tab has
 * no posts — never exercise/admin language.
 */
const ProfilePostList = memo(function ProfilePostList({
  posts,
  emptyLabel,
  loading,
  variant,
  onOpenThread,
  onReply,
  onHashtagOpen,
  onOpenProfile,
}: ProfilePostListProps) {
  if (posts.length === 0) {
    return loading ? <FeedSkeleton /> : <p className={styles.state}>{emptyLabel}</p>
  }
  return (
    <ul className={styles.list}>
      {posts.map(post => (
        <li key={post.id} className={styles.row}>
          <PostCard
            post={post}
            variant={variant}
            onOpen={onOpenThread}
            onReply={onReply}
            onHashtagOpen={onHashtagOpen}
            onOpenProfile={onOpenProfile}
          />
        </li>
      ))}
    </ul>
  )
})

export interface ProfileProps {
  /** The persona INSTANCE id to render a profile for (`persona-<handle>`). */
  readonly personaId: string
  /**
   * Opens a post's thread (card body, Media-grid thumbnail, and — see REPLY in the
   * module header — the card's Reply action). Optional: omit it and the cards are
   * not openable and Reply stays inert text.
   */
  readonly onOpenThread?: (postId: string) => void
  /** Opens the hashtag feed for a tapped `#tag` (no leading `#`). Optional. */
  readonly onHashtagOpen?: (tag: string) => void
  /**
   * Opens another author's profile from a card's author identity (the Likes tab
   * shows other people's posts). Optional; absent means the identity is plain text.
   */
  readonly onOpenProfile?: (personaId: string) => void
}

/**
 * Renders the profile page for `personaId`. Resolves the persona from the
 * exercise-scoped cast and the persona's posts from the exercise-scoped feed;
 * both reads are server-side isolated (COR-001).
 */
export function Profile({ personaId, onOpenThread, onHashtagOpen, onOpenProfile }: ProfileProps) {
  const { exerciseId, timeZone } = useExerciseContext()
  const session = useSession()
  const { personas, loading: personasLoading, error: personasError } = usePersonas()
  const { posts, loading: postsLoading } = useFeed()
  const { format } = useScenarioTime(timeZone)

  // WR-003 (COR-015/D1-011): mirrors `<Feed>` exactly — the shell variant
  // decides whether every `<PostCard>` this page renders gets the interactive
  // action row or the absent-controls/inert-counts read-only treatment.
  const { variant } = useShellContext()
  const cardVariant: CardVariant = affordancesAvailable(variant) ? 'full' : 'readOnly'

  const [activeTab, setActiveTab] = useState<ProfileTabId>('posts')

  const persona = useMemo(
    () => personas.find(p => p.id === personaId),
    [personas, personaId],
  )

  // Likes are visible on the viewer's OWN profile only (the likes graph is private): an
  // interactive session bound to a persona, looking at that persona's page. Everyone else
  // (another account's page, a persona-less session, a read-only/observer session, which
  // has no `viewer` state of its own) gets the honest "Likes are private" state — never
  // fake entries. Same `!isReadOnly && personaId !== undefined` predicate as the feed.
  const isOwnProfile =
    !session.isReadOnly && session.personaId !== undefined && session.personaId === personaId

  // Posts authored by this persona, already narrowed to participant-safe views
  // and exercise-scoped by `useFeed` (COR-001/XC-002). `useFeed()` is the TOP-LEVEL
  // feed, so these are the persona's original posts; the `inReplyTo` check is
  // belt-and-braces against a source that ever returns a reply here.
  const authoredPosts = useMemo(
    () => posts.filter(p => p.author.id === personaId && p.inReplyTo === undefined),
    [posts, personaId],
  )
  // Media tab: the persona's authored top-level posts that carry media. (A reply's
  // photo appears under "Posts & replies", with its context.)
  const mediaPosts = useMemo(
    () => authoredPosts.filter(p => p.media !== undefined && p.media.length > 0),
    [authoredPosts],
  )

  // "Posts & replies" and the own-profile "Likes" read the includeReplies superset
  // (DP-5), fetched lazily the first time one of those tabs is open and refreshed on
  // each return to one, so a like made on another tab is reflected.
  const repliesFeedActive = activeTab === 'replies' || (activeTab === 'likes' && isOwnProfile)
  const {
    posts: allPostsWithReplies,
    loading: repliesLoading,
    error: repliesError,
  } = useFeedWithReplies(repliesFeedActive, personas)
  const authoredWithReplies = useMemo(
    () => allPostsWithReplies.filter(p => p.author.id === personaId),
    [allPostsWithReplies, personaId],
  )
  const likedPosts = useMemo(
    () => (isOwnProfile ? allPostsWithReplies.filter(p => p.viewer?.liked === true) : []),
    [allPostsWithReplies, isOwnProfile],
  )

  // Banner photo: the persona's `bannerUrl` over the accent-tint fallback. Tracks the
  // URL that failed (not a boolean) so a changed `bannerUrl` gets a fresh attempt.
  const [failedBannerUrl, setFailedBannerUrl] = useState<string | undefined>(undefined)

  // REPLY (Gate-2 items 7/15): Reply opens the post's thread. Only offered when the
  // host can open a thread; otherwise PostActions renders Reply as inert text.
  const replyToPost = useCallback((postId: string) => {
    // TODO(F4-merge): call F4's `requestReplyFocus(postId)` (services/replyIntent.ts)
    // HERE, before opening the thread, so the thread opens with the composer focused.
    // F4's file is not in this branch yet; until then Reply just opens the thread.
    onOpenThread?.(postId)
  }, [onOpenThread])
  const onReply = onOpenThread !== undefined ? replyToPost : undefined

  // XC-004: one 'view' event per persona.id. The ref stores the LAST-EMITTED
  // persona id (mirroring HashtagFeed's tag-keyed ref) so a re-render /
  // StrictMode double-effect on the SAME id can't re-emit, but re-pointing this
  // already-mounted page at a DIFFERENT personaId (profile->profile navigation,
  // no unmount) re-emits exactly once for the new id.
  const emittedForRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!persona) return
    if (emittedForRef.current === persona.id) return
    emittedForRef.current = persona.id
    buildAndEmit({
      exerciseId,
      eventType: 'view',
      channel: 'social',
      actor: { kind: 'participant', participantId: session.accountId },
      wallClockTime: wallClockNowIso(),
      scenarioTime: scenarioNow().toISOString(),
      timeZone,
      target: { entityType: 'profile', entityId: persona.id },
    })
  }, [persona, exerciseId, timeZone, session.accountId])

  // --- Followers expand (story 05, D1-012) ------------------------------------------
  // Collapsed by default; resolving the real edges is deferred until the participant
  // actually asks for them, so an ordinary profile view costs no extra request.
  const [followersOpen, setFollowersOpen] = useState(false)
  const [followerIds, setFollowerIds] = useState<readonly string[]>([])

  // --- Follow state + header count (story 02 integration) ---------------------------
  // CR-002. `undefined` is a THIRD state — "not resolved yet" — deliberately distinct
  // from `false`. `useFollow` seeds `isFollowing` ONCE via `useState`, so seeding it
  // with a placeholder `false` and correcting it afterwards would leave the button
  // reading "Follow"/`aria-pressed="false"` on an account the viewer already follows.
  // That is not merely cosmetic: tapping it runs the optimistic `+1` path, the server
  // answers the idempotent `{ following: true, changed: false }` (no edge written, no
  // telemetry), and `useFollow` then SETTLES on `previousCount + 1` — the client
  // showing a follower gain that never happened.
  const [viewerFollows, setViewerFollows] = useState<boolean | undefined>(undefined)
  // CR-003: the header's own follower count, kept in step with <FollowButton>'s
  // optimistic ±1 through the `onFollowerCountChange` escape hatch that component
  // documents for exactly this host. `undefined` until the button reports its seed;
  // the persona's own count is the fallback until then (and for sessions where the
  // control is absent entirely, where the two are equal anyway).
  const [headerFollowerCount, setHeaderFollowerCount] = useState<number | undefined>(undefined)

  // Re-collapse when the page is re-pointed at a DIFFERENT persona (profile-to-profile
  // navigation reuses this mounted page), so persona A's follower list can never be
  // shown under persona B's header.
  const [trackedPersonaId, setTrackedPersonaId] = useState(personaId)
  if (trackedPersonaId !== personaId) {
    setTrackedPersonaId(personaId)
    setFollowersOpen(false)
    setFollowerIds([])
    // Re-arm the follow gate too: persona B must never inherit persona A's resolved
    // follow state or adjusted count, not even for a single frame.
    setViewerFollows(undefined)
    setHeaderFollowerCount(undefined)
  }

  useEffect(() => {
    if (!followersOpen) return
    let cancelled = false
    resolveFollowers(personaId)
      .then(ids => { if (!cancelled) setFollowerIds(ids) })
      // Fail quietly to "no real edges": the magnitude line still renders honestly, and
      // a failed edge read must never fabricate rows (D1-012).
      .catch(() => { if (!cancelled) setFollowerIds([]) })
    return () => { cancelled = true }
  }, [followersOpen, personaId])

  // CR-002: resolve whether the VIEWER already follows this account, so <FollowButton>
  // is seeded with the PERSISTED state instead of the hardcoded `false` default nothing
  // was overriding. Same directed read `useWhoToFollow` already uses (COR-001: it takes
  // no client `exerciseId` — the session binds the exercise).
  const viewerPersonaId = session.personaId
  useEffect(() => {
    // The control is absent for these sessions anyway (`useFollow().canFollow` is false
    // for read-only, for no bound persona, and on the viewer's OWN profile), so answer
    // locally rather than issue a request whose answer is never rendered.
    if (session.isReadOnly || viewerPersonaId === undefined || viewerPersonaId === personaId) {
      setViewerFollows(false)
      return
    }
    let cancelled = false
    resolveFollowing(viewerPersonaId)
      .then(ids => { if (!cancelled) setViewerFollows(ids.includes(personaId)) })
      // Fail closed to "not following": a failed read must never assert a follow
      // relationship the viewer may not have.
      .catch(() => { if (!cancelled) setViewerFollows(false) })
    return () => { cancelled = true }
  }, [viewerPersonaId, personaId, session.isReadOnly])

  // SG-003: <FollowButton>'s count-sync effect depends on this callback's IDENTITY, so
  // it MUST be a stable reference — an inline arrow would re-fire that effect on every
  // render of this page. The setter is stable, so the dep list is genuinely empty.
  const handleFollowerCountChange = useCallback((count: number) => {
    setHeaderFollowerCount(count)
  }, [])

  // The real edges, resolved against the already exercise-scoped cast (COR-001) — an id
  // the cast doesn't contain is dropped rather than rendered as a placeholder row.
  const followerEdges = useMemo(
    () => followerIds
      .map(id => personas.find(p => p.id === id))
      .filter((p): p is NonNullable<typeof p> => p !== undefined),
    [followerIds, personas],
  )

  // XC-004 (WR-005 from story 05's review): expanding Followers is a participant view
  // action and must not be silent in the AAR. Emitted on OPEN only — collapsing is not a
  // view — and `<FollowerList>` itself stays presentational.
  const toggleFollowers = () => {
    const opening = !followersOpen
    setFollowersOpen(opening)
    if (!opening || !persona) return
    buildAndEmit({
      exerciseId,
      eventType: 'view',
      channel: 'social',
      actor: { kind: 'participant', participantId: session.accountId },
      wallClockTime: wallClockNowIso(),
      scenarioTime: scenarioNow().toISOString(),
      timeZone,
      target: { entityType: 'profile', entityId: `${persona.id}:followers` },
    })
  }

  // Loading gate: wait for the cast before deciding "not found".
  if (personasLoading && !persona) {
    return (
      <section className={styles.profile}>
        <ProfileSkeleton />
      </section>
    )
  }

  if (!persona) {
    return (
      <section className={styles.profile}>
        <p className={styles.state} role="status">
          {personasError !== undefined
            ? 'This profile isn’t available right now.'
            : 'This account doesn’t exist.'}
        </p>
      </section>
    )
  }

  const joinedLabel = format(persona.joinedAt, { format: 'dateline' })

  // SOC-054 (story 05): the DISPLAYED follower count is magnitude + real edges, already
  // composed server-side into `followerCount` (story 07). `audienceMagnitude` is the raw
  // magnitude, carried separately precisely so nothing recomposes it and double-counts —
  // `audienceReach()` takes the two apart. Magnitude-formatted ("48.2K"), never a raw
  // integer, and `formatMagnitude` truncates so a count is never overstated.
  //
  // CR-003: once <FollowButton> has reported a count, THAT is the live figure — the
  // persona object never changes, so reading `persona.followerCount` here left the
  // header frozen while the button said "Following". Invisible for mid/large-band
  // personas (`formatMagnitude` truncates a ±1 away), plainly visible for the seeded
  // nano-band accounts, which render as exact integers below 1,000.
  const followerCount = formatMagnitude(headerFollowerCount ?? persona.followerCount)
  // Real outbound edges from the follow graph (story 07). Falls back to 0 only for a
  // fixture that predates the field; the live API and the seeded mock both always send it.
  const followingCount = formatMagnitude(persona.followingCount ?? 0)

  const bannerSrc = safeImageUrl(persona.bannerUrl)
  const bannerImage =
    bannerSrc !== undefined && bannerSrc !== failedBannerUrl ? bannerSrc : undefined
  const location = persona.location?.trim()

  // What each LIST tab shows. (Media renders a thumbnail grid and Likes may be the
  // private state, so those two are handled in the panel below; their entries here
  // supply the data + empty copy they fall back on.)
  const repliesUnavailable = repliesError !== undefined && authoredWithReplies.length === 0
  const tabContent: Record<ProfileTabId, {
    readonly posts: readonly PostView[]
    readonly loading: boolean
    readonly emptyLabel: string
  }> = {
    posts: { posts: authoredPosts, loading: postsLoading, emptyLabel: 'No posts yet.' },
    replies: {
      posts: authoredWithReplies,
      loading: repliesLoading,
      emptyLabel: repliesUnavailable
        ? 'Posts aren’t available right now.'
        : 'No posts or replies yet.',
    },
    media: { posts: mediaPosts, loading: postsLoading, emptyLabel: 'No media yet.' },
    likes: {
      posts: likedPosts,
      loading: repliesLoading,
      emptyLabel: repliesError !== undefined && likedPosts.length === 0
        ? 'Posts aren’t available right now.'
        : 'You haven’t liked any posts yet.',
    },
  }
  const activeContent = tabContent[activeTab]

  // Roving arrow-key navigation across the tablist (NFR-001 keyboard support).
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = PROFILE_TABS.findIndex(t => t.id === activeTab)
    if (currentIndex < 0) return
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % PROFILE_TABS.length
    if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + PROFILE_TABS.length) % PROFILE_TABS.length
    }
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = PROFILE_TABS.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const next = PROFILE_TABS[nextIndex]
    if (next) setActiveTab(next.id)
  }

  return (
    <section className={styles.profile} aria-labelledby="profile-name">
      {/* Decorative (the name/handle carry identity): the accent tint is the base, the
          persona's banner photo covers it, and a failed load simply uncovers the tint. */}
      <div className={styles.banner} data-testid="profile-banner" aria-hidden="true">
        {bannerImage !== undefined && (
          <img
            className={styles.bannerImage}
            data-testid="profile-banner-image"
            src={bannerImage}
            alt=""
            decoding="async"
            onError={() => setFailedBannerUrl(bannerImage)}
          />
        )}
      </div>

      <div className={styles.identity} data-testid="profile-identity">
        <span className={styles.avatarRing}>
          <Avatar persona={persona} size={PROFILE_AVATAR_SIZE} />
        </span>

        <div className={styles.nameRow}>
          <h1 id="profile-name" className={styles.displayName}>{persona.displayName}</h1>
          {persona.verified && (
            <span className={styles.verifiedMark}>
              <VerifiedMark size={PROFILE_MARK_SIZE} />
            </span>
          )}
        </div>
        <span className={styles.handle}>{`@${persona.handle}`}</span>

        {persona.bio && <p className={styles.bio}>{persona.bio}</p>}

        <div className={styles.meta}>
          {location !== undefined && location.length > 0 && (
            <span className={styles.metaItem} data-testid="profile-location">
              <FontAwesomeIcon
                icon={faLocationDot}
                aria-hidden="true"
                className={styles.metaIcon}
              />
              <span>{location}</span>
            </span>
          )}
          <span className={styles.metaItem}>
            <FontAwesomeIcon icon={faCalendarDay} aria-hidden="true" className={styles.metaIcon} />
            <span>
              Joined{' '}
              <time dateTime={persona.joinedAt} data-testid="profile-joined">{joinedLabel}</time>
            </span>
          </span>
        </div>

        <div className={styles.stats}>
          <span className={styles.stat} data-testid="following-count">
            <span className={styles.statValue}>{followingCount}</span> Following
          </span>
          {/* Followers is a BUTTON because it expands the D1-012 follower list. Counts
              stay visible to every session including observers (D1-011 removes action
              affordances, not information). */}
          <button
            type="button"
            className={`${styles.stat} ${styles.statButton}`}
            data-testid="follower-count"
            aria-expanded={followersOpen}
            aria-controls="profile-followers"
            onClick={toggleFollowers}
          >
            <span className={styles.statValue}>{followerCount}</span> Followers
          </button>
        </div>

        {/* D1-011: the Follow control is ABSENT for observer/read-only and no-persona
            sessions, and on the viewer's OWN profile (the server 400s a self-follow) —
            `useFollow`'s `canFollow` owns all three, and FollowButton renders null.

            CR-002 — NO FLASH OF THE WRONG STATE. The control is WITHHELD until
            `viewerFollows` resolves, rather than mounted with a placeholder `false`
            that a late `initiallyFollowing` could never correct (`useFollow` seeds
            `isFollowing` once). So the button's very first painted frame already
            carries the persisted state; there is no "Follow" -> "Following" flip to
            see. The key then pins that guarantee for good: any future change to the
            resolved value remounts the control instead of leaving a stale seed behind
            (`useFollow` re-points itself on a `personaId` change, but NOT on an
            `initiallyFollowing` change — the key covers precisely that gap). */}
        <div className={styles.followAction}>
          {viewerFollows !== undefined && (
            <FollowButton
              key={`${persona.id}:${viewerFollows}`}
              personaId={persona.id}
              displayName={persona.displayName}
              initialFollowerCount={persona.followerCount}
              initiallyFollowing={viewerFollows}
              onFollowerCountChange={handleFollowerCountChange}
            />
          )}
        </div>
      </div>

      {followersOpen && (
        <div id="profile-followers" data-testid="profile-followers">
          <FollowerList edges={followerEdges} magnitude={persona.audienceMagnitude ?? 0} />
        </div>
      )}

      <div className={styles.tabs} role="tablist" aria-label="Profile timeline">
        {PROFILE_TABS.map(tab => {
          const selected = tab.id === activeTab
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`profile-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`profile-tabpanel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              className={selected ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={handleTabKeyDown}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id={`profile-tabpanel-${activeTab}`}
        aria-labelledby={`profile-tab-${activeTab}`}
      >
        {activeTab === 'likes' && !isOwnProfile ? (
          // Honest, not empty-by-accident: someone else's likes are not shown to anyone.
          <div className={styles.state} data-testid="profile-likes-private">
            <FontAwesomeIcon icon={faLock} aria-hidden="true" className={styles.stateIcon} />
            <p className={styles.stateText}>Likes are private.</p>
          </div>
        ) : activeTab === 'media' && mediaPosts.length > 0 ? (
          <MediaTabGrid posts={mediaPosts} onOpenPost={onOpenThread} />
        ) : (
          <ProfilePostList
            posts={activeContent.posts}
            emptyLabel={activeContent.emptyLabel}
            loading={activeContent.loading}
            variant={cardVariant}
            onOpenThread={onOpenThread}
            onReply={onReply}
            onHashtagOpen={onHashtagOpen}
            onOpenProfile={onOpenProfile}
          />
        )}
      </div>
    </section>
  )
}
