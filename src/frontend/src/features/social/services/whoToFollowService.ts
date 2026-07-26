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
 * EXCLUSIONS ARE APPLIED TWICE, AND THAT IS DELIBERATE. As of backend story
 * 08 the SERVER already excludes the viewer's own persona and everything the
 * viewer already follows (it resolves the viewer from the session, never from
 * a client field), so this module relays a list those rules have already been
 * applied to. `useWhoToFollow` re-applies both anyway: they are cheap set
 * operations, they keep the module correct against the mock adapter below
 * (which is viewer-agnostic), and they mean a just-completed follow write
 * disappears from the rendered list immediately rather than at the next
 * fetch. Neither layer is a ranking — see the note above.
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
 *
 * It parses `?limit=` back out of `config.url` — the very string the live path
 * sends — rather than closing over the argument, so a client/server key
 * mismatch (`?limit=` vs `?count=`) fails HERE too instead of only against a
 * real backend. Honouring the cap in mock is not cosmetic: mock/live
 * divergence is this feature's most productive defect class (a bare array
 * typed against an envelope, two disconnected follow stores, a `204` mock for
 * a `200` endpoint), and a mock that ignored `limit` while the server applied
 * it would be the next one.
 */
const mockAdapter: AxiosAdapter = config => {
  const limit = limitFromUrl(config.url)
  return Promise.resolve({
    data: limit === undefined
      ? MOCK_SUGGESTED_FOLLOW_IDS
      : MOCK_SUGGESTED_FOLLOW_IDS.slice(0, limit),
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  })
}

/** Reads the `limit` query parameter back out of a request path, if present. */
function limitFromUrl(url: string | undefined): number | undefined {
  const raw = url?.match(/[?&]limit=(\d+)/)?.[1]
  return raw === undefined ? undefined : Number(raw)
}

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
 *
 * `limit` is a server-applied CAP, not a ranking hint: the server returns the
 * first `limit` entries of the SAME order it would otherwise return in full
 * (`profiles-social-graph/08`), so a capped read is a strict prefix of an
 * uncapped one. Omitted → the whole eligible set. The server also applies the
 * self / already-followed exclusions the caller applies again locally, so a
 * cap never silently costs a renderable row to an entry the client would have
 * dropped anyway.
 */
export async function resolveSuggestedFollowIds(limit?: number): Promise<string[]> {
  const response = await api.get<string[]>(
    limit === undefined ? '/personas/suggestions' : `/personas/suggestions?limit=${limit}`,
    USE_MOCK_SUGGESTIONS ? { adapter: mockAdapter } : undefined,
  )
  if (!isStringArray(response.data)) {
    throw new Error('resolveSuggestedFollowIds: resolution returned a malformed id list')
  }
  return response.data
}
