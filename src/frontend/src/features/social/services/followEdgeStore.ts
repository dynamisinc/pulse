/**
 * features/social/services/followEdgeStore.ts
 * ---------------------------------------------------------------------------
 * The SINGLE in-memory mock follow-edge store, shared by `followService.ts`
 * (the follow/unfollow write + directed-read seam, profiles-social-graph
 * story 02) and `feedService.ts` (the Following-scope mock read filter,
 * feeds-discovery story 02). Dev/test/UAT-no-backend only — `edges` stands in
 * for the backend's `Follow` table exactly the way `postStore.ts` stands in
 * for the `Post` table. Participant world (Pulse Social skin) — pure
 * data/service module, no UI, no COBRA.
 *
 * WHY THIS MODULE EXISTS (Gate-1 fold, WR-004, #88/#121). Before this fix,
 * `followService.ts` kept its OWN `MOCK_EDGES` map, and `feedService.ts`
 * separately filtered the Following feed against a FROZEN LITERAL set
 * (`DEFAULT_MOCK_FOLLOWED_PERSONA_IDS` / a module-level `mockFollowedPersonaIds`
 * it never updated). The two stores were unrelated: under
 * `VITE_USE_MOCK_DATA=true` (UAT's own setting) following an account moved the
 * write into `followService`'s map, but the Following feed kept reading the
 * unrelated frozen set, so a follow never moved a single post into the feed.
 * The feature looked built and did nothing where it would actually be
 * demoed. This module is now the ONE place mock follow state lives; both
 * services read AND write it, so a follow always shows up in the feed it is
 * supposed to, and an unfollow always removes it.
 *
 * SEEDING: on first load, the viewer persona (`MOCK_VIEWER_PERSONA_ID`)
 * already follows `DEFAULT_MOCK_FOLLOWED_PERSONA_IDS` — two REAL seeded
 * accounts (`postService.ts`'s `SEEDED_POSTS` authors), never fabricated ones
 * — so a fresh dev/UAT session's Following feed has believable content before
 * the reader follows anyone. `resetMockFollowEdges()` (test-only) does NOT
 * restore that seeded baseline — it clears the graph to genuinely EMPTY
 * (nobody following anybody), because that is the clean-slate every OTHER
 * consumer of this store already tests against (e.g. `04-who-to-follow`'s
 * suggestion-exclusion specs, which need a blank follow graph to assert their
 * planner-seeded order unfiltered). A spec that wants the seeded DEFAULT back
 * on purpose calls `feedService.setMockFollowingForTests(undefined)`
 * explicitly, which is a narrower, opt-in restore scoped to the viewer only.
 * `setMockFollowedSetForTests()` is the general escape hatch for a test that
 * needs ANY specific (including empty) set for a given follower, without
 * touching anyone else's edges.
 *
 * NEVER imported by a shipped read path directly — always through
 * `followService`'s or `feedService`'s own exported functions (mirrors
 * `postStore`'s own caveat).
 */

// Imported from the LEAF module (`personas/types`) rather than the
// `@/features/personas` barrel on purpose: `personaService.ts`'s mock adapter
// now reads THIS store back (WR-005 — composing the mock `followerCount` the
// way the live server composes it), and going through the barrel would close
// the loop `personas/index -> personaService -> followEdgeStore ->
// personas/index`. `personas/types.ts` imports nothing, so this edge keeps the
// module graph acyclic. `personaIdForHandle` is a pure id helper — no cast, no
// service, no seeding.
import { personaIdForHandle } from '@/features/personas/types'

/**
 * The Wave-1 mock session's bound persona (`core/auth/sessionResolver.ts`'s
 * `MOCK_SESSION_BASE.personaId`). Follow/unfollow act as this persona ONLY in
 * mock mode, and it is the ONLY mock "viewer" the Following feed filters for
 * — mirrors the live contract, where the server (never the client) resolves
 * the acting persona from the session.
 */
export const MOCK_VIEWER_PERSONA_ID = 'persona-dreyes_fh'

/**
 * The viewer's DEFAULT followed set — real seeded accounts, never fabricated
 * content — so the Following feed has something to show before the reader
 * follows anyone. `feedService`'s `setMockFollowingForTests(undefined)`
 * restores exactly this set.
 */
export const DEFAULT_MOCK_FOLLOWED_PERSONA_IDS: readonly string[] = [
  personaIdForHandle('FairhavenWater'),
  personaIdForHandle('kwardFH'),
]

function seededEdges(): Map<string, Set<string>> {
  return new Map([[MOCK_VIEWER_PERSONA_ID, new Set(DEFAULT_MOCK_FOLLOWED_PERSONA_IDS)]])
}

/**
 * `followerId -> Set<followedId>`. Module-level so it persists across calls
 * within one page session (an in-memory stand-in for the backend's `Follow`
 * table) but resets on reload — fine for dev/test/UAT-no-backend, never
 * imported directly by a shipped read path (mirrors `postStore`'s own
 * caveat).
 */
let edges: Map<string, Set<string>> = seededEdges()

/**
 * Returns (creating if absent) the mutable followed-id set for `followerId`.
 * The returned `Set` is live — mutating it (via `.add`/`.delete`) writes
 * straight through to the store, exactly like the old per-service map this
 * replaces.
 */
export function mockFollowedSet(followerId: string): Set<string> {
  let set = edges.get(followerId)
  if (!set) {
    set = new Set<string>()
    edges.set(followerId, set)
  }
  return set
}

/**
 * Returns the REAL (never the SOC-054 magnitude) follower ids of
 * `followedId` — every `followerId` whose own set contains it.
 */
export function mockFollowerIdsOf(followedId: string): string[] {
  const followers: string[] = []
  for (const [followerId, followedIds] of edges) {
    if (followedIds.has(followedId)) followers.push(followerId)
  }
  return followers
}

/**
 * TEST-ONLY escape hatch: replaces `followerId`'s ENTIRE followed-id set with
 * exactly `personaIds` (including an empty array — a genuinely empty follow
 * set is a distinct, sanctioned state, not "no override"). Passing
 * `undefined` clears it to empty. Never called from non-test code.
 */
export function setMockFollowedSetForTests(
  followerId: string,
  personaIds: readonly string[] | undefined,
): void {
  edges.set(followerId, new Set(personaIds ?? []))
}

/**
 * Clears the mock follow-edge state to a genuinely EMPTY graph — nobody
 * following anybody. Test-only. This is NOT the same as the module's own
 * INITIAL (first-load) state, which is seeded (see the module header) — the
 * two are deliberately different: the seeded default is what a fresh dev/UAT
 * session shows the reader, while this reset is the clean slate the existing
 * test suite (across `followService`, `feedService`, and `04-who-to-follow`'s
 * suggestion-exclusion specs) already depends on. A spec that wants the
 * seeded default back on purpose calls
 * `feedService.setMockFollowingForTests(undefined)` instead.
 */
export function resetMockFollowEdges(): void {
  edges = new Map()
}
