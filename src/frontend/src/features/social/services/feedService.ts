/**
 * features/social/services/feedService.ts
 * ---------------------------------------------------------------------------
 * The All Posts / Following feed read seam + the participant-safe convergence
 * (feature: feeds-discovery, story 01 "All Posts feed" + story 02 "Following
 * feed"; SOC-080, SOC-081, COR-001, COR-015, COR-053, XC-002, NFR-002/SOC-071,
 * NFR-003). Participant world (Pulse Social skin) — pure model/service module,
 * no UI, no COBRA.
 *
 * Two responsibilities, kept apart so each is swappable/testable on its own:
 *
 *   - `resolveFeed(scope?)` The READ seam. Routed through the shared axios
 *                          client (`@/core/services/api`) with a dev/mock
 *                          adapter, mirroring `personaService.resolvePersonas`
 *                          exactly: today the adapter short-circuits to
 *                          `listPosts()` (the seeded Fairhaven arc); swapping it
 *                          for a live `/feed` endpoint needs NO consumer change
 *                          (NFR-003 contract seam). Fails CLOSED on a
 *                          malformed body — never substitutes an empty/default
 *                          feed silently.
 *
 *                          PRECEDENT (WAVE0-REVIEW 13): it takes NO client
 *                          `exerciseId` param — query isolation is server-side
 *                          (COR-001); the session already binds the exercise.
 *
 *                          STORY 02 (SOC-081): `scope` is `'all'` (default) or
 *                          `'following'`. Live mode sends `?scope=following`
 *                          straight through to `GET /api/feed` — the SAME
 *                          single-endpoint contract story 01 already calls,
 *                          just parameterized (see
 *                          `docs/features/profiles-social-graph/07-follow-graph-api.md`).
 *                          The backend does ALL the filtering (posts by
 *                          personas the caller's session-bound persona
 *                          follows) — there is deliberately NO second,
 *                          client-composed round trip here (fetch the follow
 *                          list, then filter the full feed). An empty follow
 *                          set resolves an empty 200 array; an unresolvable/
 *                          unknown scope value is a 400 the caller's `error`
 *                          state surfaces (never a silent fallback to the
 *                          unfiltered feed). Calling `resolveFeed()` with NO
 *                          argument (every existing All Posts caller) sends
 *                          the EXACT SAME request as before this story — no
 *                          `scope` param is added for the default case, so
 *                          that path stays byte-identical.
 *
 *   - `assembleFeedView()` The CONVERGENCE this story owns (see
 *                          docs/features/feeds-discovery/01). Pure function:
 *                          narrows each `Post` to its participant-safe view via
 *                          `toParticipantView` (NEVER reads `post.origin` /
 *                          `actingHumanId` — XC-002), resolves its
 *                          `authorPersonaId` to a `Persona` from the supplied
 *                          cast (a `Map` lookup), and assembles the
 *                          presentational `PostView` `<PostCard>` renders. A
 *                          post whose author persona is absent is SKIPPED (never
 *                          crashes the feed). Sorted newest-first — see below.
 *                          Scope-agnostic: it converges whatever `Post[]`
 *                          `resolveFeed()` resolved with, All Posts or
 *                          Following alike.
 *
 * ORDERING — newest-first (reverse-chronological). The D1 feed prototype places
 * the burst "▲ N new posts" pill (aria-live=polite) ABOVE the stream and new
 * posts land at the TOP (D1-005; story 04), so the stream reads newest→oldest,
 * the universal social-timeline convention and what "the firehose a PIO
 * monitors" implies. "Chronological" in the AC is used in its ordered-by-time
 * sense (the contrast is the engagement-ranked "For You" mode, story 05), not a
 * claim of oldest-first. Sorting is by `scenarioTime` only (COR-053).
 *
 * BURST NOTE (NFR-002/SOC-071): the returned array carries stable `PostView`
 * object identities for unchanged posts across calls with the same inputs (the
 * caller `useFeed` memoizes on `posts`/`personas`), so a windowing layer can be
 * dropped over the list later without reshaping this data flow.
 */

import type { AxiosAdapter, AxiosRequestConfig } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { toParticipantView, type Post } from '@/features/social'
import type { PostView } from '@/features/social'
import { personaIdForHandle, type Persona } from '@/features/personas'
import { postStore } from './postStore'

/** The feed's scope (story 02, SOC-081): the unfiltered firehose, or narrowed
 * to posts by the caller's followed accounts. Kept a closed union deliberately
 * — the frontend can only ever request a value the backend recognizes, so a
 * typo can never even be EXPRESSED, let alone silently serve the wrong feed
 * under the wrong label. */
export type FeedScope = 'all' | 'following'

/**
 * MOCK-ONLY (dev/test) stand-in for "who the current mock session's persona
 * follows". There is no frontend follow store yet in this worktree — the
 * write path (profiles-social-graph story 02, `useFollow`/`followService.ts`)
 * is a parallel, not-yet-merged build — so this fixed set is what gives the
 * mock adapter's Following scope something honest, non-fabricated to filter
 * TO rather than fabricating post content: it narrows the same seeded
 * Fairhaven posts (`postStore`/`listPosts`) to a believable subset, it never
 * invents new posts. Every author id here is a REAL seeded persona/post
 * author (`postService.ts`'s `SEEDED_POSTS`).
 *
 * This is intentionally a Wave-boundary placeholder (mirrors `postStore.ts`'s
 * own "Wave-1 minimal slice" precedent): once the mock follow store lands,
 * the mock adapter below should read from IT instead, so following/unfollowing
 * an account in mock mode actually moves posts in and out of this feed. Until
 * then, `setMockFollowingForTests` is the only sanctioned way to vary it
 * (test-only — no production code calls it).
 */
const DEFAULT_MOCK_FOLLOWED_PERSONA_IDS: readonly string[] = [
  personaIdForHandle('FairhavenWater'),
  personaIdForHandle('kwardFH'),
]

let mockFollowedPersonaIds = new Set<string>(DEFAULT_MOCK_FOLLOWED_PERSONA_IDS)

/**
 * TEST-ONLY escape hatch overriding the mock adapter's Following-scope filter
 * set (see the constant above). Passing `undefined` restores the default mock
 * set. Never called from non-test code — the real filtering, in live mode, is
 * entirely server-side (COR-001).
 */
export function setMockFollowingForTests(personaIds: readonly string[] | undefined): void {
  mockFollowedPersonaIds = new Set(personaIds ?? DEFAULT_MOCK_FOLLOWED_PERSONA_IDS)
}

/**
 * Short-circuits the network with the current post set, while still exercising
 * the shared axios client's request pipeline exactly as a live `/feed` call
 * would (mirrors `personaService`/`sessionResolver`'s mock adapters). Reads from
 * the module-singleton `postStore` (feeds-discovery/07) — seeded once from
 * `listPosts()` — rather than calling `listPosts()` directly, so a post appended
 * after mount is included on the next resolve and, via `useFeed`'s store
 * subscription, surfaces live without a re-fetch of the seeded baseline.
 *
 * Following scope (story 02): reads `config.params.scope` — the SAME query
 * param a live call carries — and filters to `mockFollowedPersonaIds` when it
 * is `'following'`. An empty filtered result is returned as an empty array,
 * never substituted with the unfiltered set (mirrors the real backend's
 * documented empty-follow-set behavior).
 */
const mockAdapter: AxiosAdapter = config => {
  const params = config.params as { scope?: FeedScope } | undefined
  const all = postStore.getPosts()
  const data = params?.scope === 'following'
    ? all.filter(post => mockFollowedPersonaIds.has(post.authorPersonaId))
    : all

  return Promise.resolve({
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  })
}

/** Single env-guarded mock/live flip point (WAVE0-REVIEW 15). */
const USE_MOCK_FEED = USE_MOCK_DATA

function isPost(value: unknown): value is Post {
  if (!value || typeof value !== 'object') return false
  const p = value as Post
  return (
    typeof p.id === 'string' && p.id.length > 0 &&
    typeof p.authorPersonaId === 'string' && p.authorPersonaId.length > 0 &&
    typeof p.text === 'string' &&
    typeof p.scenarioTime === 'string' && p.scenarioTime.length > 0 &&
    !!p.counts && typeof p.counts === 'object' &&
    typeof p.counts.reply === 'number' &&
    typeof p.counts.repost === 'number' &&
    typeof p.counts.like === 'number'
  )
}

function isPostArray(data: unknown): data is Post[] {
  return Array.isArray(data) && data.every(isPost)
}

/**
 * Resolves the current exercise's posts for the given `scope` (default `'all'`
 * — the unfiltered firehose). Throws on request failure or a malformed body
 * (fail-closed — no default/empty feed is silently substituted, COR-001).
 * Returns the FULL `Post` model; the XC-002 narrowing to a participant-safe
 * view happens in `assembleFeedView`.
 *
 * `scope: 'following'` sends `?scope=following` (SOC-081) — the backend
 * resolves the caller's session-bound persona's follow set and filters
 * server-side; an empty follow set resolves an empty array, never a fallback
 * to the unfiltered feed. Calling this with NO argument (every story-01
 * caller) builds the EXACT SAME request as before this story — no `params`
 * key at all — so the All Posts path is byte-identical.
 */
export async function resolveFeed(scope: FeedScope = 'all'): Promise<Post[]> {
  const params = scope === 'following' ? { scope } : undefined
  const requestConfig: AxiosRequestConfig | undefined = USE_MOCK_FEED
    ? { adapter: mockAdapter, ...(params !== undefined ? { params } : {}) }
    : params !== undefined ? { params } : undefined

  const response = await api.get<Post[]>('/feed', requestConfig)
  if (!isPostArray(response.data)) {
    throw new Error('resolveFeed: resolution returned a malformed post set')
  }
  return response.data
}

/**
 * Compares two scenario-time ISO instants for a newest-first sort. The SINGLE
 * shared newest-first comparator — `assembleFeedView` (the baseline feed sort)
 * and `Feed`'s live-arrivals prepend both use it, so the two can never drift
 * (Copilot #301 round-2 de-dupe).
 *
 * `Date.parse` parses a GIVEN instant string to epoch-ms — it does NOT read the
 * wall clock (unlike `Date.now()` / `new Date()`, which the participant-surface
 * lint ban forbids and which would leak real time onto a COR-053 surface). An
 * unparseable instant sorts last (treated as oldest) rather than throwing.
 */
export function compareNewestFirst(a: string, b: string): number {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  const safeA = Number.isNaN(ta) ? -Infinity : ta
  const safeB = Number.isNaN(tb) ? -Infinity : tb
  return safeB - safeA
}

/**
 * THE CONVERGENCE (story 01). Maps each `Post` to the participant-safe
 * `PostView` `<PostCard>` renders — narrowing away provenance (XC-002) and
 * resolving the author persona — then sorts newest-first by `scenarioTime`.
 *
 * @param posts    Full posts from `resolveFeed()`.
 * @param personas The exercise cast from `usePersonas()`; a post whose
 *   `authorPersonaId` is absent from this set is SKIPPED (the feed never
 *   crashes on a missing author).
 */
export function assembleFeedView(
  posts: readonly Post[],
  personas: readonly Persona[],
): PostView[] {
  const personaById = new Map<string, Persona>(personas.map(p => [p.id, p]))

  const views: PostView[] = []
  for (const post of posts) {
    // XC-002: the ONLY sanctioned narrowing — strips origin/actingHumanId/etc.
    const safe = toParticipantView(post)
    const author = personaById.get(safe.authorPersonaId)
    if (!author) continue // missing author → skip, never crash the feed.

    views.push({
      id: safe.id,
      author,
      text: safe.text,
      counts: safe.counts,
      scenarioTime: safe.scenarioTime,
      ...(safe.media !== undefined ? { media: safe.media } : {}),
      ...(safe.linkPreview !== undefined ? { linkPreview: safe.linkPreview } : {}),
    })
  }

  return views.sort((a, b) => compareNewestFirst(a.scenarioTime, b.scenarioTime))
}
