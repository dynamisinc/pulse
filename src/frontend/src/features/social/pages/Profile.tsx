/**
 * features/social/pages/Profile.tsx
 * ---------------------------------------------------------------------------
 * The persona/participant PROFILE page (feature: profiles-social-graph, story
 * 01; SOC-050). Participant world (Pulse Social skin): plain semantic elements
 * + a scoped CSS Module — NO COBRA, NO themed MUI, FontAwesome-only icons.
 *
 * WHAT IT DOES
 *  - Renders one persona's identity hero: an accent-tinted banner (COR-030,
 *    via `--pulse-ac`), the R-004 avatar treatment (reused `<Avatar>` — duotone
 *    silhouette for humans, monogram for orgs), display name + the fixed
 *    seal-blue `<VerifiedMark>` when `persona.verified` (the trainable trust
 *    signal, SOC-052/story 03 — rendered by presence/absence only, never a
 *    substitute "unverified" badge), handle, bio, a meta row (joined date;
 *    location/link render here once the Phase-1 persona model carries them —
 *    see note below), and the follower/following counts.
 *  - Renders four tabs (Posts / Posts & replies / Media / Likes), each showing
 *    the exercise-scoped post set through the keystone `<PostCard>`.
 *
 * PURE CONSUMER: this page composes `<PostCard>`/`<VerifiedMark>`/`<Avatar>` and
 * reuses the shipped read seams (`useFeed`, `usePersonas`) — it defines no new
 * data model. It is rendered standalone with a `personaId` (Wave-1); reaching a
 * profile from a post tap is a later orchestrator-owned `SocialChannel` wiring
 * pass, NOT this story.
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
 * MODEL NOTE — location/link + following count: the Phase-1 `Persona` model
 * (persona-management) carries neither a location/website nor an outbound-follow
 * count. The meta row therefore renders the joined date only (location/link
 * slots are ready for when the model gains them, R-004/COR-024 follow-on), and
 * the "Following" count defaults to 0 — the seeded cast has no outbound follow
 * edges yet; the real following count is supplied once the follow graph lands
 * (story 02). Follower magnitude BANDING is story 05; this story renders the raw
 * `followerCount`.
 *
 * READ-ONLY VARIANT (WR-003, COR-015/D1-011): the shell mount variant is read
 * via `useShellContext()`, exactly like `<Feed>` — `affordancesAvailable(variant)`
 * decides `cardVariant` (`'full'` | `'readOnly'`), threaded into every
 * `<PostCard>` this page renders (all four tabs, via `ProfilePostList`). An
 * observer/read-only session therefore sees the SAME "controls absent, counts
 * inert" treatment here that `<Feed>` already gave it — counts and post content
 * stay fully visible; only the interactive reply/repost/like affordances go.
 */

import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCalendarDay } from '@fortawesome/free-solid-svg-icons'
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
import { resolveFollowers } from '../services/followService'
import {
  useShellContext,
  affordancesAvailable,
} from '@/features/participant-shell/mountContract'
import { useFeed } from '../hooks/useFeed'
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
  readonly emptyLabel: string
  /** WR-003: threaded from the shell variant (COR-015/D1-011) into every
   * `<PostCard>` this list renders. */
  readonly variant: CardVariant
}

/**
 * A tab's post list, memoized on its inputs so switching tabs (or a parent
 * re-render) doesn't needlessly re-render an unchanged list under burst
 * (NFR-002/SOC-071). Renders the calm in-fiction empty state when the tab has
 * no posts — never exercise/admin language.
 */
const ProfilePostList = memo(function ProfilePostList({
  posts,
  emptyLabel,
  variant,
}: ProfilePostListProps) {
  if (posts.length === 0) {
    return <p className={styles.state}>{emptyLabel}</p>
  }
  return (
    <ul className={styles.list}>
      {posts.map(post => (
        <li key={post.id} className={styles.row}>
          <PostCard post={post} variant={variant} />
        </li>
      ))}
    </ul>
  )
})

export interface ProfileProps {
  /** The persona INSTANCE id to render a profile for (`persona-<handle>`). */
  readonly personaId: string
}

/**
 * Renders the profile page for `personaId`. Resolves the persona from the
 * exercise-scoped cast and the persona's posts from the exercise-scoped feed;
 * both reads are server-side isolated (COR-001).
 */
export function Profile({ personaId }: ProfileProps) {
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

  // Posts authored by this persona, already narrowed to participant-safe views
  // and exercise-scoped by `useFeed` (COR-001/XC-002).
  const authoredPosts = useMemo(
    () => posts.filter(p => p.author.id === personaId),
    [posts, personaId],
  )
  const mediaPosts = useMemo(
    () => authoredPosts.filter(p => p.media !== undefined && p.media.length > 0),
    [authoredPosts],
  )

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

  // Re-collapse when the page is re-pointed at a DIFFERENT persona (profile-to-profile
  // navigation reuses this mounted page), so persona A's follower list can never be
  // shown under persona B's header.
  const [trackedPersonaId, setTrackedPersonaId] = useState(personaId)
  if (trackedPersonaId !== personaId) {
    setTrackedPersonaId(personaId)
    setFollowersOpen(false)
    setFollowerIds([])
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
        <p className={styles.state} role="status">Loading profile…</p>
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
  const followerCount = formatMagnitude(persona.followerCount)
  // Real outbound edges from the follow graph (story 07). Falls back to 0 only for a
  // fixture that predates the field; the live API and the seeded mock both always send it.
  const followingCount = formatMagnitude(persona.followingCount ?? 0)

  const postsByTab: Record<ProfileTabId, readonly PostView[]> = {
    posts: authoredPosts,
    // No distinct participant-visible reply-authorship model in Phase 1, so
    // "Posts & replies" shows the persona's authored set (a superset once a
    // reply model lands). Kept exercise-scoped through the same feed read.
    replies: authoredPosts,
    media: mediaPosts,
    // No like-authorship data exists participant-side in Phase 1 (SOC-050 scopes
    // out the likes graph) — the tab renders an honest empty state, never fake
    // entries (D1-012).
    likes: [],
  }

  const emptyByTab: Record<ProfileTabId, string> = {
    posts: postsLoading ? 'Loading posts…' : 'No posts yet.',
    replies: postsLoading ? 'Loading posts…' : 'No posts or replies yet.',
    media: postsLoading ? 'Loading posts…' : 'No media yet.',
    likes: 'No likes to show.',
  }

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
      <div className={styles.banner} data-testid="profile-banner" aria-hidden="true" />

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
            `useFollow`'s `canFollow` owns all three, and FollowButton renders null. */}
        <div className={styles.followAction}>
          <FollowButton
            key={persona.id}
            personaId={persona.id}
            displayName={persona.displayName}
            initialFollowerCount={persona.followerCount}
          />
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
        <ProfilePostList
          posts={postsByTab[activeTab]}
          emptyLabel={emptyByTab[activeTab]}
          variant={cardVariant}
        />
      </div>
    </section>
  )
}
