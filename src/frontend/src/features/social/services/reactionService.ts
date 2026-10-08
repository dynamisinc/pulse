/**
 * features/social/services/reactionService.ts
 * ---------------------------------------------------------------------------
 * The like / repost WRITE seam (demo-polish F3 "Engagement — persisted likes
 * and reposts"; SOC-030, SOC-020 repost toggle, SOC-021, COR-001, COR-015,
 * DP-10, DP-15). Participant world (Pulse Social skin) — pure service module,
 * no UI, no COBRA. Routed through the shared axios client (`@/core/services/api`)
 * with a dev/UAT mock adapter PER CALL, mirroring `followService.ts`: even in mock
 * mode every call still goes through `api`'s real request pipeline (interceptors
 * included) — only the TRANSPORT is short-circuited, never the call shape.
 *
 * THE WIRE CONTRACT (implementation.md §1.5.4, owner B3):
 *   - `PUT    /api/posts/{postId}/reactions/{like|repost}`  -> like / repost
 *   - `DELETE /api/posts/{postId}/reactions/{like|repost}`  -> unlike / undo repost
 *   Both return `200` + a `ReactionState`: the post's `counts` AFTER the change
 *   (baseline + real) and the caller's own `viewer` flags — the two things the
 *   hook reconciles its optimistic state against.
 *   Idempotent (a repeat PUT/DELETE is a 200 with no state change). Participant
 *   session with a bound persona only (DP-10 — staff do not react); the SERVER
 *   derives the acting persona and the exercise from the session.
 *   `PostReaction` is SOFT-deleted server-side (DP-15) — nothing the client does
 *   differs: un-like is simply `DELETE`.
 *
 * NO IDENTITY ON THE WIRE (COR-001/XC-002). The request has NO body, NO query
 * string and no header of ours: no `exerciseId`, no `personaId`, no scenario
 * time. The server stamps scope, actor and the exercise-clock instant itself.
 * Post ids are opaque strings (mock `post-seed-…`, live GUIDs) — URL-encoded,
 * never parsed.
 *
 * NO CLIENT TELEMETRY HERE. In LIVE mode the server emits the authoritative
 * XC-004 `reaction` / `repost` event once per STATE CHANGE (§1.8); this module
 * emits nothing and the hooks are the only place the mock-mode emission lives
 * (and only when `USE_MOCK_DATA`), so the two can never double-count.
 *
 * FAIL CLOSED. A 2xx whose body is not a well-formed `ReactionState` for the
 * requested kind REJECTS — the hook then rolls back rather than reconcile onto
 * garbage.
 *
 * MOCK ADAPTER (dev / UAT-no-backend / Vitest). Mirrors the server's semantics
 * — idempotent, count moves only on a real state change — and is STATELESS BY
 * DEFAULT: the caller passes a {@link MockReactionSeed} (what the client shows
 * for this post+kind BEFORE the write) which the adapter treats as the baseline,
 * so it works for any post id (a fixture, a freshly created post, a test's ad-hoc
 * id) without a lookup. The seed is MOCK-ONLY: it is never part of the live
 * request. Two further mock behaviours, both off the live path:
 *   - PERSISTENCE (dev only). Results are remembered in an in-memory map so a
 *     card that re-mounts later in the SAME page session (feed -> thread ->
 *     profile) re-seeds from it — the mock stand-in for "the next fetch's
 *     `viewer` says you already liked it". It is OFF under Vitest (like the rich
 *     demo fixtures, `mockFixtures.DEMO_FIXTURES_ENABLED`) so no test can leak
 *     like-state into another; opt in with `resetMockReactions({ persist: true })`.
 *     A real page refresh clears it (in-memory only); the live server is what
 *     survives a refresh.
 *   - FAILURE SWITCH (test-only). `setMockReactionFailure(true)` makes every
 *     mock write reject with an `AxiosError` 503, which the rollback tests use.
 *   The response fills the fields the client does not own (the post's reply
 *   count, the OTHER kind's count/flag) from what this module last saw, else
 *   0 / false. The hooks only reconcile the toggled kind, so those are inert.
 */

import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import type { PostCounts, PostViewerState } from '../types/post'

/** The two reaction kinds the endpoints accept (anything else is a server 400). */
export type ReactionKind = 'like' | 'repost'

/** `ReactionStateDto` (implementation.md §1.5.4): the post's state AFTER the write. */
export interface ReactionState {
  readonly postId: string
  readonly kind: ReactionKind
  /** Whether the viewer's reaction of this kind is active after the call. */
  readonly active: boolean
  /** The post's engagement counts after the change (baseline + real). */
  readonly counts: PostCounts
  /** The caller's own like/repost flags after the change. */
  readonly viewer: PostViewerState
}

/**
 * What the client currently shows for a post + kind BEFORE the write — passed to
 * the MOCK adapter only (it is never sent on the wire, see the module header).
 */
export interface MockReactionSeed {
  readonly active: boolean
  readonly count: number
}

/** Single env-guarded mock/live flip point (mirrors `followService.ts`). */
const USE_MOCK_REACTIONS = USE_MOCK_DATA

/** Persistence default: dev / mock builds only, never under Vitest (module header). */
const PERSIST_BY_DEFAULT = USE_MOCK_DATA && import.meta.env.MODE !== 'test'

let persistMock = PERSIST_BY_DEFAULT
let mockFailing = false
const mockStore = new Map<string, MockReactionSeed>()

const storeKey = (postId: string, kind: ReactionKind) => `${kind}:${postId}`

/**
 * The mock's remembered state for a post + kind, or `undefined` (nothing
 * remembered, or persistence is off). The hooks seed their initial state from it
 * in mock mode so a re-mounted card agrees with an earlier toggle.
 */
export function mockReactionSnapshot(
  postId: string,
  kind: ReactionKind,
): MockReactionSeed | undefined {
  return persistMock ? mockStore.get(storeKey(postId, kind)) : undefined
}

/**
 * Test-only: forgets every remembered mock reaction and clears the failure
 * switch. `persist: true` turns the dev-only persistence ON for the test (it is
 * OFF under Vitest by default); omit it to restore the environment default.
 */
export function resetMockReactions(options: { persist?: boolean } = {}): void {
  mockStore.clear()
  mockFailing = false
  persistMock = options.persist ?? PERSIST_BY_DEFAULT
}

/** Test-only: make every mock reaction write reject (503) until reset. */
export function setMockReactionFailure(failing: boolean): void {
  mockFailing = failing
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Narrowing guard for the 200 body — fail closed on anything else. */
function isReactionState(data: unknown, kind: ReactionKind): data is ReactionState {
  if (!isRecord(data)) return false
  const { counts, viewer } = data
  return (
    typeof data.postId === 'string' &&
    data.kind === kind &&
    typeof data.active === 'boolean' &&
    isRecord(counts) &&
    isCount(counts.reply) &&
    isCount(counts.repost) &&
    isCount(counts.like) &&
    isRecord(viewer) &&
    typeof viewer.liked === 'boolean' &&
    typeof viewer.reposted === 'boolean'
  )
}

/** Builds the mock adapter for ONE write; closes over what it needs (module header). */
function mockAdapterFor(
  postId: string,
  kind: ReactionKind,
  wantActive: boolean,
  seed: MockReactionSeed,
): AxiosAdapter {
  return (config: InternalAxiosRequestConfig) => {
    if (mockFailing) {
      const response = {
        data: { error: 'mock reaction failure' },
        status: 503,
        statusText: 'Service Unavailable',
        headers: {},
        config,
      }
      return Promise.reject(
        new AxiosError('mock reaction failure', AxiosError.ERR_BAD_RESPONSE, config, null, response),
      )
    }

    // Idempotent, like the server: the count moves only on a real state change.
    const changed = seed.active !== wantActive
    const count = !changed
      ? seed.count
      : wantActive
        ? seed.count + 1
        : Math.max(0, seed.count - 1)
    const result: MockReactionSeed = { active: wantActive, count }
    if (persistMock) mockStore.set(storeKey(postId, kind), result)

    const like = kind === 'like' ? result : mockStore.get(storeKey(postId, 'like'))
    const repost = kind === 'repost' ? result : mockStore.get(storeKey(postId, 'repost'))
    const data: ReactionState = {
      postId,
      kind,
      active: wantActive,
      counts: { reply: 0, like: like?.count ?? 0, repost: repost?.count ?? 0 },
      viewer: { liked: like?.active ?? false, reposted: repost?.active ?? false },
    }
    return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config })
  }
}

async function writeReaction(
  method: 'put' | 'delete',
  postId: string,
  kind: ReactionKind,
  seed: MockReactionSeed,
): Promise<ReactionState> {
  const url = `/posts/${encodeURIComponent(postId)}/reactions/${kind}`
  // The adapter override rides ONLY in mock mode; live mode passes no config at all.
  const config = USE_MOCK_REACTIONS
    ? { adapter: mockAdapterFor(postId, kind, method === 'put', seed) }
    : undefined
  const response =
    method === 'put'
      ? await api.put<unknown>(url, undefined, config)
      : await api.delete<unknown>(url, config)
  if (!isReactionState(response.data, kind)) {
    throw new Error(`${method === 'put' ? 'putReaction' : 'deleteReaction'}: malformed reaction state`)
  }
  return response.data
}

/**
 * Likes / reposts `postId` as the caller's session-bound persona (`PUT`).
 * Idempotent. Resolves the server's authoritative {@link ReactionState}; rejects
 * on any non-2xx or malformed body (callers roll their optimistic state back).
 * `seed` is mock-only — see {@link MockReactionSeed}.
 */
export function putReaction(
  postId: string,
  kind: ReactionKind,
  seed: MockReactionSeed,
): Promise<ReactionState> {
  return writeReaction('put', postId, kind, seed)
}

/**
 * Removes the caller's like / repost on `postId` (`DELETE`). Idempotent — see
 * {@link putReaction}.
 */
export function deleteReaction(
  postId: string,
  kind: ReactionKind,
  seed: MockReactionSeed,
): Promise<ReactionState> {
  return writeReaction('delete', postId, kind, seed)
}
