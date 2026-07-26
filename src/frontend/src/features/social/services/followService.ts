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
 * mutable (unlike the read-only `SEEDED_PERSONAS` cast), so the mock reads
 * and writes `followEdgeStore.ts`'s shared in-memory edge set — the SAME
 * store `feedService.ts`'s Following-scope mock filter reads (WR-004 fold,
 * #88/#121: the two used to be disconnected stores, so a follow never moved
 * a post into the Following feed under `VITE_USE_MOCK_DATA=true`, UAT's own
 * setting). The Wave-1 mock session has exactly one bound persona
 * (`MOCK_VIEWER_PERSONA_ID`, `core/auth/sessionResolver.ts`), so
 * follow/unfollow always act as that fixed follower in mock mode — this
 * mirrors the real contract (the server, never the client, resolves the
 * acting persona from the session).
 */

import type { AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import {
  MOCK_VIEWER_PERSONA_ID,
  mockFollowedSet,
  mockFollowerIdsOf,
  resetMockFollowEdges,
} from './followEdgeStore'

/** Test-only reset, re-exported for `followService.test.ts` (mirrors `resetTelemetryBuffer`). */
export { resetMockFollowEdges }

/** Pulls `{id}` out of a `/personas/{id}/<suffix>` request path. */
function extractPersonaId(url: string | undefined, suffix: string): string | undefined {
  if (url === undefined) return undefined
  const match = url.match(new RegExp(`^/personas/([^/]+)/${suffix}$`))
  return match?.[1]
}

/**
 * Builds the server's `FollowStateResponseDto` envelope (`personaId`/
 * `following`/`changed`) so the mock and the live 200 body parse identically —
 * the real endpoint (`FollowEndpoints.cs`'s `MapResult`) returns `200` +
 * this body for BOTH the state-changing and the idempotent-repeat case, never
 * a bare `204`. An earlier mock revision returned `204`/`undefined`, which
 * would have thrown the moment a caller started parsing the real envelope
 * (SG-001/SG-002 fold) while staying green here — this shape is now the same
 * one `resolveFollowing`/`resolveFollowers`'s `FollowListResponseDto` mock
 * already committed to.
 */
function mockFollowStateBody(personaId: string, following: boolean, changed: boolean) {
  return { personaId, following, changed }
}

const followMockAdapter: AxiosAdapter = config => {
  const personaId = extractPersonaId(config.url, 'follow')
  let changed = false
  if (personaId !== undefined) {
    const set = mockFollowedSet(MOCK_VIEWER_PERSONA_ID)
    changed = !set.has(personaId)
    set.add(personaId)
  }
  const data = mockFollowStateBody(personaId ?? '', true, changed)
  return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config })
}

const unfollowMockAdapter: AxiosAdapter = config => {
  const personaId = extractPersonaId(config.url, 'follow')
  let changed = false
  if (personaId !== undefined) {
    const set = mockFollowedSet(MOCK_VIEWER_PERSONA_ID)
    changed = set.has(personaId)
    set.delete(personaId)
  }
  const data = mockFollowStateBody(personaId ?? '', false, changed)
  return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config })
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
  const ids = personaId !== undefined ? mockFollowerIdsOf(personaId) : []
  const data = mockFollowListBody(personaId ?? '', ids)
  return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config })
}

/** Single env-guarded mock/live flip point (mirrors `personaService.ts`). */
const USE_MOCK_FOLLOW = USE_MOCK_DATA

/**
 * The wire shape of a follow/unfollow write response — the server's
 * `FollowStateResponseDto` (`FollowEndpoints.cs`): the caller-observable state
 * of ONE edge after the call. `scenarioTime` is omitted here (only present on
 * a live state CHANGE, COR-053) — this module never reads it, only
 * `following`.
 */
interface FollowStateResponse {
  readonly personaId: string
  readonly following: boolean
  readonly changed: boolean
}

function isFollowStateResponse(data: unknown): data is FollowStateResponse {
  if (!data || typeof data !== 'object') return false
  const body = data as FollowStateResponse
  return typeof body.following === 'boolean' && typeof body.changed === 'boolean'
}

/**
 * Follows `personaId` as the caller's session-bound persona. Idempotent —
 * following an already-followed id succeeds silently (no error), matching the
 * server contract. Callers (`useFollow`) are responsible for the client-side
 * read-only/no-persona guard; this function issues the request unconditionally.
 *
 * Returns the server's AUTHORITATIVE `following` value (SG-001) — never
 * assumed to be `true` just because the call didn't throw — so a caller that
 * settles its own optimistic state on this return value self-corrects a
 * client/server divergence instead of trusting its own guess.
 */
export async function followPersona(personaId: string): Promise<boolean> {
  const response = await api.post(
    `/personas/${personaId}/follow`,
    undefined,
    USE_MOCK_FOLLOW ? { adapter: followMockAdapter } : undefined,
  )
  if (!isFollowStateResponse(response.data)) {
    throw new Error('followPersona: response was not a well-formed follow-state envelope')
  }
  return response.data.following
}

/**
 * Unfollows `personaId` as the caller's session-bound persona. Idempotent —
 * unfollowing a non-edge succeeds silently, matching the server contract.
 * Returns the server's authoritative `following` value (SG-001) — see
 * `followPersona`.
 */
export async function unfollowPersona(personaId: string): Promise<boolean> {
  const response = await api.delete(
    `/personas/${personaId}/follow`,
    USE_MOCK_FOLLOW ? { adapter: unfollowMockAdapter } : undefined,
  )
  if (!isFollowStateResponse(response.data)) {
    throw new Error('unfollowPersona: response was not a well-formed follow-state envelope')
  }
  return response.data.following
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
