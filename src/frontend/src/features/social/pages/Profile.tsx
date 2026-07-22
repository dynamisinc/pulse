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
 * TELEMETRY (XC-004): emits exactly ONE `'view'` event when the profile resolves
 * (ref-guarded so a re-render / StrictMode double-invoke can't re-emit), with a
 * `profile` target and participant attribution (`actor.participantId` = the
 * session `accountId`, present for read-only sessions too — satisfies the view
 * superRefine). `wallClockTime` is telemetry-only and never rendered.
 *
 * MODEL NOTE — location/link + following count: the Phase-1 `Persona` model
 * (persona-management) carries neither a location/website nor an outbound-follow
 * count. The meta row therefore renders the joined date only (location/link
 * slots are ready for when the model gains them, R-004/COR-024 follow-on), and
 * the "Following" count defaults to 0 — the seeded cast has no outbound follow
 * edges yet; the real following count is supplied once the follow graph lands
 * (story 02). Follower magnitude BANDING is story 05; this story renders the raw
 * `followerCount`.
 */

import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCalendarDay } from '@fortawesome/free-solid-svg-icons'
import { useExerciseContext } from '@/core/exerciseContext'
import { useSession } from '@/core/auth'
import { scenarioNow, useScenarioTime } from '@/core/clock'
import { wallClockNowIso } from '@/core/time/wallClock'
import { buildAndEmit } from '@/core/telemetry'
import { PostCard, VerifiedMark, Avatar, type PostView } from '@/features/social'
import { usePersonas } from '@/features/personas'
import { useFeed } from '../hooks/useFeed'
import styles from './Profile.module.css'

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
}

/**
 * A tab's post list, memoized on its inputs so switching tabs (or a parent
 * re-render) doesn't needlessly re-render an unchanged list under burst
 * (NFR-002/SOC-071). Renders the calm in-fiction empty state when the tab has
 * no posts — never exercise/admin language.
 */
const ProfilePostList = memo(function ProfilePostList({ posts, emptyLabel }: ProfilePostListProps) {
  if (posts.length === 0) {
    return <p className={styles.state}>{emptyLabel}</p>
  }
  return (
    <ul className={styles.list}>
      {posts.map(post => (
        <li key={post.id} className={styles.row}>
          <PostCard post={post} />
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

  // XC-004: one 'view' event once the profile resolves. Ref-guarded so a
  // re-render / StrictMode double-effect can't re-emit; keyed off persona.id so
  // a not-yet-resolved (or missing) persona emits nothing.
  const viewEmittedRef = useRef(false)
  useEffect(() => {
    if (viewEmittedRef.current) return
    if (!persona) return
    viewEmittedRef.current = true
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
  const followerCount = persona.followerCount.toLocaleString('en-US')
  // No outbound follow edges are seeded yet (the follow graph is story 02); the
  // neutral default is 0 following. Rendered raw — magnitude banding is story 05.
  const followingCount = (0).toLocaleString('en-US')

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
          <span className={styles.stat} data-testid="follower-count">
            <span className={styles.statValue}>{followerCount}</span> Followers
          </span>
        </div>
      </div>

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
        <ProfilePostList posts={postsByTab[activeTab]} emptyLabel={emptyByTab[activeTab]} />
      </div>
    </section>
  )
}
