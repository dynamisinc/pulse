/**
 * features/social/services/feedService.ts
 * ---------------------------------------------------------------------------
 * The All Posts feed read seam + the participant-safe convergence
 * (feature: feeds-discovery, story 01 — "All Posts feed"; SOC-080, COR-001,
 * COR-053, XC-002, NFR-002/SOC-071, NFR-003). Participant world (Pulse Social
 * skin) — pure model/service module, no UI, no COBRA.
 *
 * Two responsibilities, kept apart so each is swappable/testable on its own:
 *
 *   - `resolveFeed()`      The READ seam. Routed through the shared axios
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

import type { AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { toParticipantView, type Post } from '@/features/social'
import type { PostView } from '@/features/social'
import type { Persona } from '@/features/personas'
import { postStore } from './postStore'

/**
 * Short-circuits the network with the current post set, while still exercising
 * the shared axios client's request pipeline exactly as a live `/feed` call
 * would (mirrors `personaService`/`sessionResolver`'s mock adapters). Reads from
 * the module-singleton `postStore` (feeds-discovery/07) — seeded once from
 * `listPosts()` — rather than calling `listPosts()` directly, so a post appended
 * after mount is included on the next resolve and, via `useFeed`'s store
 * subscription, surfaces live without a re-fetch of the seeded baseline.
 */
const mockAdapter: AxiosAdapter = config => Promise.resolve({
  data: postStore.getPosts(),
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
})

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
 * Resolves the current exercise's public posts (the All Posts firehose).
 * Throws on request failure or a malformed body (fail-closed — no default/empty
 * feed is silently substituted, COR-001). Returns the FULL `Post` model; the
 * XC-002 narrowing to a participant-safe view happens in `assembleFeedView`.
 */
export async function resolveFeed(): Promise<Post[]> {
  const response = await api.get<Post[]>(
    '/feed',
    USE_MOCK_FEED ? { adapter: mockAdapter } : undefined,
  )
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
