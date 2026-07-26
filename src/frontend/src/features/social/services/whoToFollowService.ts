/**
 * features/social/services/whoToFollowService.ts
 * ---------------------------------------------------------------------------
 * The "Who to follow" suggestion READ seam (feature: profiles-social-graph,
 * story 04 — "Who to follow"; SOC-053, COR-001, D1-R1). Participant world
 * (Pulse Social skin) — pure service module, no UI, no COBRA. Routed through
 * the shared axios client (`@/core/services/api`) with a dev/UAT mock
 * adapter, mirroring `personaService.ts`/`followService.ts`'s `USE_MOCK_DATA`
 * idiom (WAVE0-REVIEW precedent 15): even in mock mode the call still goes
 * through `api`'s real request pipeline — only the transport is
 * short-circuited, never the call shape.
 *
 * THE CONTRACT — IDS ONLY, ORDER-PRESERVING (mirrors `followService.ts`'s
 * `resolveFollowing`/`resolveFollowers`). `GET /api/personas/suggestions`
 * returns an ORDERED array of persona ids, never resolved `Persona` objects —
 * the caller (`useWhoToFollow`) resolves each id against `usePersonas()`, the
 * same convention `<FollowerList>` uses for its caller-supplied edges. The
 * order this module returns IS the contract: it does not rank, score, or
 * reorder anything — it relays whatever order the read returns, in that
 * order, unmodified.
 *
 * PLANNER-SEEDED TODAY; CONTROLLER-ADJUSTABLE LATER (SOC-053 / E7 CTL-021) —
 * READ-ONLY HERE. A planner seeds the default suggestion order for an
 * exercise. The E7 "adjust suggested-follows live" attention-steering lever
 * (`docs/features/world-steering/01-attention-levers.md`, CTL-021, issue #24)
 * is a SEPARATE, **Not Started** write path that will later add/remove/
 * reorder entries in the same backing list this module reads — see this
 * story's Out of Scope note in
 * `docs/features/profiles-social-graph/04-who-to-follow.md`. Building any
 * staff-facing mutation surface here would be inventing a control this story
 * never asked for, and would half-ship CTL-021 under story 04's name. This
 * module only reads.
 *
 * NO INVENTED RANKING. There is no relevance score, popularity weight, or
 * "recommended for you" heuristic anywhere in this file. The docs define no
 * such formula for suggested-follows (unlike the *audience-magnitude* reach
 * model in `./audience.ts`, a different, already-defined contract this module
 * has nothing to do with) — planner-seeded order is the whole contract.
 * Adding a scoring function here would be exactly the kind of undocumented
 * semantics a later pass would have to strip back out.
 *
 * THE IMPERSONATOR CAN LEGITIMATELY APPEAR (D1-R1/D1-008). This module never
 * filters, deprioritizes, sorts down, or otherwise treats the seeded SOC-052
 * lookalike (`@FairhavenWaterUpd`) differently from any other id in the list.
 * The mock default below includes it at its natural seed position, entirely
 * unflagged — exactly the kind of deliberate attention-steering placement a
 * planner (and later a controller, via CTL-021) is entitled to make. The
 * platform itself never vouches for, nor warns against, any entry here.
 *
 * EXCLUSIONS ARE THE CALLER'S JOB, NOT THIS MODULE'S. This seam returns the
 * full planner-seeded list as-is, with no notion of "who is asking". Never
 * suggesting the viewer's own persona, and never suggesting an account
 * already followed, are `useWhoToFollow`'s responsibility (using the
 * viewer's session + `followService.resolveFollowing`) — mirroring how
 * `feedService.resolveFeed` stays scope-agnostic and lets its caller apply
 * session-specific rules on top.
 */

import type { AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { personaIdForHandle } from '@/features/personas'

/**
 * MOCK SCAFFOLD default suggestion order (dev/test/UAT-no-backend only) — a
 * believable planner-seeded order over the Fairhaven baseline cast, standing
 * in for the eventual `/api/personas/suggestions` read. Deliberately mixes
 * verified (`FulcoEM`, `Newsline7`) and unverified accounts, INCLUDING the
 * SOC-052 impersonator (`FairhavenWaterUpd`) at its natural seed position —
 * the platform never sorts it down or filters it out (D1-R1/D1-008). This is
 * a static placeholder for CTL-021's future write path (world-steering/01,
 * out of scope for this story), never a computed recommendation.
 */
const MOCK_SUGGESTED_FOLLOW_IDS: readonly string[] = [
  personaIdForHandle('FulcoEM'),
  personaIdForHandle('FairhavenWaterUpd'),
  personaIdForHandle('Newsline7'),
  personaIdForHandle('TheScoopHQ'),
  personaIdForHandle('kwardFH'),
  personaIdForHandle('mvega_fh'),
]

/**
 * Short-circuits the network with the mock suggestion order, while still
 * exercising the shared axios client's real request pipeline (interceptors
 * included) exactly as a live call would.
 */
const mockAdapter: AxiosAdapter = config => Promise.resolve({
  data: MOCK_SUGGESTED_FOLLOW_IDS,
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
})

/** Single env-guarded mock/live flip point (mirrors the rest of this feature). */
const USE_MOCK_SUGGESTIONS = USE_MOCK_DATA

function isStringArray(data: unknown): data is string[] {
  return Array.isArray(data) && data.every(item => typeof item === 'string')
}

/**
 * Resolves the current exercise's "Who to follow" suggestion order — ids
 * only, ORDER-PRESERVING. Exercise-scoped server-side (COR-001) — takes no
 * client `exerciseId` param; the session already binds the exercise. Fails
 * closed (throws) on a malformed body, mirroring
 * `resolveFollowing`/`resolveFollowers` — never silently substitutes an
 * empty/default suggestion list.
 */
export async function resolveSuggestedFollowIds(): Promise<string[]> {
  const response = await api.get<string[]>(
    '/personas/suggestions',
    USE_MOCK_SUGGESTIONS ? { adapter: mockAdapter } : undefined,
  )
  if (!isStringArray(response.data)) {
    throw new Error('resolveSuggestedFollowIds: resolution returned a malformed id list')
  }
  return response.data
}
