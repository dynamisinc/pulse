/**
 * features/social/services/followService.ts
 * ---------------------------------------------------------------------------
 * The follow/unfollow write + follow-graph read seam (feature:
 * profiles-social-graph, story 02 — "Follow/unfollow"; SOC-051, COR-001,
 * COR-015). Participant world (Pulse Social skin) — pure service module, no
 * UI, no COBRA. Routed through the shared axios client
 * (`@/core/services/api`) with a dev/UAT mock adapter PER CALL, mirroring
 * `personaService.ts`/`sessionResolver.ts`'s `USE_MOCK_DATA` idiom
 * (`@/core/config/mockData`, WAVE0-REVIEW precedent 15): even in mock mode
 * every call still goes through `api`'s real request pipeline (interceptors
 * included) — only the TRANSPORT is short-circuited, never the call shape.
 *
 * THE BACKEND CONTRACT (profiles-social-graph backend story 07, #370):
 *   - `POST /api/personas/{id}/follow` / `DELETE /api/personas/{id}/follow` —
 *     act for the CALLER'S session-bound persona (the server derives the
 *     actor from the session; the wire body carries no actor field).
 *     IDEMPOTENT: following an already-followed id, or unfollowing a
 *     non-edge, both succeed — neither is an error the client needs to
 *     handle specially. Refused server-side for a read-only session
 *     (COR-015) — this module's callers (`useFollow`) additionally guard on
 *     the client so a read-only/no-persona session never issues the request
 *     at all.
 *   - `GET /api/personas/{id}/following` / `/followers` — ids ONLY (no
 *     resolved persona objects; a caller resolves ids against
 *     `usePersonas()`/`personaById` itself, same convention as
 *     `FollowerList`'s caller-supplied edges).
 *   - The server emits the XC-004 follow/unfollow telemetry itself on a STATE
 *     CHANGE. This module (and `useFollow`) deliberately emit NONE — a client
 *     emit here would double-count every toggle.
 *
 * MOCK ADAPTERS (dev/test/UAT-no-backend only). Follow state is genuinely
 * mutable (unlike the read-only `SEEDED_PERSONAS` cast), so the mock keeps a
 * small in-memory edge set — `followerId -> Set<followedId>` — rather than a
 * canned static response. The Wave-1 mock session has exactly one bound
 * persona (`persona-dreyes_fh`, `core/auth/sessionResolver.ts`), so
 * follow/unfollow always act as that fixed follower in mock mode — this
 * mirrors the real contract (the server, never the client, resolves the
 * acting persona from the session).
 */

import type { AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'

/**
 * The Wave-1 mock session's bound persona (`core/auth/sessionResolver.ts`'s
 * `MOCK_SESSION_BASE.personaId`). Follow/unfollow act as this persona ONLY in
 * mock mode — mirrors the live contract, where the server (never the client)
 * resolves the acting persona from the session.
 */
const MOCK_VIEWER_PERSONA_ID = 'persona-dreyes_fh'

/**
 * MOCK SCAFFOLD state: real follow edges, `followerId -> Set<followedId>`.
 * Module-level so it persists across calls within one page session (an
 * in-memory stand-in for the backend's `Follow` table) but resets on reload —
 * fine for dev/test/UAT-no-backend, never imported by a shipped read path
 * directly (mirrors `personaService.SEEDED_PERSONAS`'s own caveat).
 */
const MOCK_EDGES = new Map<string, Set<string>>()

function mockFollowedSet(followerId: string): Set<string> {
  let set = MOCK_EDGES.get(followerId)
  if (!set) {
    set = new Set<string>()
    MOCK_EDGES.set(followerId, set)
  }
  return set
}

/** Resets the mock follow-edge state. Test-only (mirrors `resetTelemetryBuffer`). */
export function resetMockFollowEdges(): void {
  MOCK_EDGES.clear()
}

/** Pulls `{id}` out of a `/personas/{id}/<suffix>` request path. */
function extractPersonaId(url: string | undefined, suffix: string): string | undefined {
  if (url === undefined) return undefined
  const match = url.match(new RegExp(`^/personas/([^/]+)/${suffix}$`))
  return match?.[1]
}

const followMockAdapter: AxiosAdapter = config => {
  const personaId = extractPersonaId(config.url, 'follow')
  if (personaId !== undefined) {
    mockFollowedSet(MOCK_VIEWER_PERSONA_ID).add(personaId)
  }
  return Promise.resolve({ data: undefined, status: 204, statusText: 'No Content', headers: {}, config })
}

const unfollowMockAdapter: AxiosAdapter = config => {
  const personaId = extractPersonaId(config.url, 'follow')
  if (personaId !== undefined) {
    mockFollowedSet(MOCK_VIEWER_PERSONA_ID).delete(personaId)
  }
  return Promise.resolve({ data: undefined, status: 204, statusText: 'No Content', headers: {}, config })
}

/** Builds the server's `FollowListResponseDto` envelope so mock and live parse identically. */
function mockFollowListBody(personaId: string, personaIds: readonly string[]) {
  return { personaId, personaIds: [...personaIds], count: personaIds.length }
}

const followingMockAdapter: AxiosAdapter = config => {
  const personaId = extractPersonaId(config.url, 'following')
  const ids = personaId !== undefined ? [...mockFollowedSet(personaId)] : []
  const data = mockFollowListBody(personaId ?? '', ids)
  return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config })
}

const followersMockAdapter: AxiosAdapter = config => {
  const personaId = extractPersonaId(config.url, 'followers')
  const ids: string[] = []
  if (personaId !== undefined) {
    for (const [followerId, followedIds] of MOCK_EDGES) {
      if (followedIds.has(personaId)) ids.push(followerId)
    }
  }
  const data = mockFollowListBody(personaId ?? '', ids)
  return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config })
}

/** Single env-guarded mock/live flip point (mirrors `personaService.ts`). */
const USE_MOCK_FOLLOW = USE_MOCK_DATA

/**
 * Follows `personaId` as the caller's session-bound persona. Idempotent —
 * following an already-followed id succeeds silently (no error), matching the
 * server contract. Callers (`useFollow`) are responsible for the client-side
 * read-only/no-persona guard; this function issues the request unconditionally.
 */
export async function followPersona(personaId: string): Promise<void> {
  await api.post(
    `/personas/${personaId}/follow`,
    undefined,
    USE_MOCK_FOLLOW ? { adapter: followMockAdapter } : undefined,
  )
}

/**
 * Unfollows `personaId` as the caller's session-bound persona. Idempotent —
 * unfollowing a non-edge succeeds silently, matching the server contract.
 */
export async function unfollowPersona(personaId: string): Promise<void> {
  await api.delete(
    `/personas/${personaId}/follow`,
    USE_MOCK_FOLLOW ? { adapter: unfollowMockAdapter } : undefined,
  )
}

/**
 * The wire shape of a follow/followers-ids response.
 *
 * This is an ENVELOPE, not a bare array — verified against the server's
 * `FollowListResponseDto` (`Pulse.WebApi/Features/Social/Follows/FollowEndpoints.cs`),
 * which emits `personaId` / `personaIds` / `count`. An earlier revision typed this
 * as `string[]` and threw on every live call while the mock adapter returned a bare
 * array, so the whole suite stayed green — the mock/live divergence this feature has
 * to keep designing against. The mock adapters below emit the SAME envelope precisely
 * so a shape regression fails in test rather than only in UAT.
 */
interface FollowIdsResponse {
  readonly personaId: string
  readonly personaIds: readonly string[]
  readonly count: number
}

function isFollowIdsResponse(data: unknown): data is FollowIdsResponse {
  if (!data || typeof data !== 'object') return false
  const body = data as FollowIdsResponse
  return Array.isArray(body.personaIds) && body.personaIds.every(id => typeof id === 'string')
}

/**
 * Resolves the ids `personaId` follows (real outbound edges only — never the
 * SOC-054 magnitude). Fails closed (throws) on a malformed body, mirroring
 * `resolvePersonas`.
 */
export async function resolveFollowing(personaId: string): Promise<string[]> {
  const response = await api.get<FollowIdsResponse>(
    `/personas/${personaId}/following`,
    USE_MOCK_FOLLOW ? { adapter: followingMockAdapter } : undefined,
  )
  if (!isFollowIdsResponse(response.data)) {
    throw new Error('resolveFollowing: resolution returned a malformed id list')
  }
  return [...response.data.personaIds]
}

/**
 * Resolves the ids that follow `personaId` (real inbound edges only — never
 * the SOC-054 magnitude, and never the same thing as `followerCount`, which
 * is magnitude + real edges composed). Fails closed on a malformed body.
 */
export async function resolveFollowers(personaId: string): Promise<string[]> {
  const response = await api.get<FollowIdsResponse>(
    `/personas/${personaId}/followers`,
    USE_MOCK_FOLLOW ? { adapter: followersMockAdapter } : undefined,
  )
  if (!isFollowIdsResponse(response.data)) {
    throw new Error('resolveFollowers: resolution returned a malformed id list')
  }
  return [...response.data.personaIds]
}
