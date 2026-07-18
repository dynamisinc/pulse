/**
 * features/social/hooks/useThread.ts
 * ---------------------------------------------------------------------------
 * The read seam for a FLATTENED thread (feature: threads-replies, story 01
 * "Flattened thread view"; SOC-010, D1-006). Participant world (Pulse Social
 * skin) — pure data/hook module, no UI, no COBRA.
 *
 * `useThread(focusedPostId)` resolves a thread's three parts as
 * PARTICIPANT-SAFE view models:
 *
 *   - `ancestors`  the flat chain of posts the focused post is (eventually) a
 *                  reply to, oldest first. Chain depth is unbounded (D1-006:
 *                  "unlimited reply depth, still flat") — this hook never
 *                  truncates it; `<ThreadView>` renders the whole chain as one
 *                  flat vertical list, never indented.
 *   - `focused`    the post the thread is centered on.
 *   - `replies`    the focused post's direct replies, each carrying
 *                  `replyToPersonaId` (who they're replying to — always the
 *                  focused post's author today, since this story renders only
 *                  the focused post's direct replies) and a `status` so a
 *                  taken-down reply can render an in-thread tombstone instead
 *                  of its content (SOC-005/D1-009).
 *
 * Like `personaService.resolvePersonas()`, resolution is routed through the
 * shared axios client (`@/core/services/api`) with a mock adapter behind
 * `USE_MOCK_DATA` (WAVE0-REVIEW precedent 15) — this is the swappable seam a
 * real `/threads/:id` endpoint slots into later with no consumer change.
 *
 * MOCK DATA NOTE: the mock thread is built from `listPosts()` (the Fairhaven
 * water-contamination arc's seeded posts, reused as-is for ancestors/focused)
 * plus a small, locally-authored set of reply-only fixtures (`MOCK_REPLIES_
 * BY_PARENT`) that are NOT part of `listPosts()` — they exist only to give
 * this one demo thread a real reply and a taken-down reply to exercise the
 * tombstone. `MOCK_ANCESTRY` is a hand-authored parent-chain map over the
 * seeded posts for the same demo purpose. None of this is participant-safe
 * data yet — `toParticipantView` (posts/03) is the only sanctioned narrowing,
 * applied before this hook ever hands a value back (XC-002).
 */

import { useEffect, useState } from 'react'
import type { AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { personaIdForHandle } from '@/features/personas'
import {
  listPosts,
  toParticipantView,
  type ParticipantPostView,
  type Post,
  type PostCounts,
} from '@/features/social'

/**
 * A mock reply fixture — a full `Post` (so it narrows through
 * `toParticipantView` exactly like every other post) plus the two fields this
 * story needs that no other post carries: which post it replies to, and
 * whether it has been taken down.
 */
interface MockReplyPost extends Post {
  readonly replyToPersonaId: string
  readonly status: 'visible' | 'taken-down'
}

/**
 * A thread reply as `<ThreadView>` receives it: participant-safe (no
 * provenance fields, XC-002) plus `replyToPersonaId`/`status`.
 */
export interface ThreadReplyView extends ParticipantPostView {
  readonly replyToPersonaId: string
  readonly status: 'visible' | 'taken-down'
}

export interface UseThreadResult {
  /** The ancestor chain, oldest first. Empty when the focused post is a root. */
  readonly ancestors: readonly ParticipantPostView[]
  /** The focused post, or `undefined` while loading / if it could not be resolved. */
  readonly focused: ParticipantPostView | undefined
  /** The focused post's direct replies (order: as authored). */
  readonly replies: readonly ThreadReplyView[]
  readonly loading: boolean
  readonly error: unknown
}

// -----------------------------------------------------------------------------
// Mock thread fixtures
// -----------------------------------------------------------------------------

const MOCK_EXERCISE_ID = 'ex-mock-0001'

/** Fixed authoring-time stamp for the reply fixtures below — pre-existing
 * fixture content, not a live ingest action (mirrors `postService.ts`'s
 * `SEED_WALL_CLOCK` precedent). */
const SEED_WALL_CLOCK = '2026-07-01T00:00:00.000Z'

/**
 * A hand-authored parent-chain over the seeded posts (`listPosts()`), for
 * this one demo thread: child post id -> its parent's id. Deliberately a
 * 2-deep chain (a rumor post, then Fulco EM's response to it, then the
 * citizen's question replying to that) so the ancestry chain has real depth
 * to demonstrate "unlimited depth, still flat" (D1-006) rather than a
 * single-ancestor toy case.
 */
const MOCK_ANCESTRY: Readonly<Record<string, string>> = {
  'post-seed-fulco-coordination': 'post-seed-fwupd-rumor',
  'post-seed-mvega-question': 'post-seed-fulco-coordination',
}

/**
 * Reply-only fixtures, keyed by the parent post id they reply to. NOT part of
 * `listPosts()` — these exist purely to exercise a real in-thread reply and a
 * taken-down one (SOC-005/D1-009) for the one demo thread focused on
 * `post-seed-mvega-question` (the citizen's worried question).
 */
const MOCK_REPLIES_BY_PARENT: Readonly<Record<string, readonly MockReplyPost[]>> = {
  'post-seed-mvega-question': [
    {
      id: 'post-reply-kward-1',
      exerciseId: MOCK_EXERCISE_ID,
      authorPersonaId: personaIdForHandle('kwardFH'),
      actingHumanId: 'human-participant-kward',
      text:
        'That account replying to you is NOT the official utility - get your updates from ' +
        '@FairhavenWater and @FulcoEM instead.',
      counts: { reply: 4, repost: 6, like: 21 } satisfies PostCounts,
      createdWallClock: SEED_WALL_CLOCK,
      scenarioTime: '2033-09-04T14:10:00Z',
      origin: 'participant',
      replyToPersonaId: personaIdForHandle('mvega_fh'),
      status: 'visible',
    },
    {
      id: 'post-reply-fwupd-1',
      exerciseId: MOCK_EXERCISE_ID,
      authorPersonaId: personaIdForHandle('FairhavenWaterUpd'),
      actingHumanId: 'human-simcell-rumor',
      text: 'Yes it is - the real utility is lying to you. Screenshot this before it disappears!!',
      counts: { reply: 12, repost: 40, like: 96 } satisfies PostCounts,
      createdWallClock: SEED_WALL_CLOCK,
      scenarioTime: '2033-09-04T14:12:00Z',
      origin: 'inject',
      injectId: '043',
      replyToPersonaId: personaIdForHandle('mvega_fh'),
      // A controller/moderator took this one down mid-exercise (SOC-005) - the
      // in-thread tombstone (D1-009) is the only thing `<ThreadView>` renders
      // for it.
      status: 'taken-down',
    },
  ],
}

/** The wire shape a real `/threads/:id` endpoint will return. */
interface ThreadWireResponse {
  readonly ancestors: Post[]
  readonly focused: Post | null
  readonly replies: MockReplyPost[]
}

function buildAncestorChain(focusedPostId: string, byId: ReadonlyMap<string, Post>): Post[] {
  const chain: Post[] = []
  const seen = new Set<string>()
  let parentId = MOCK_ANCESTRY[focusedPostId]

  while (parentId !== undefined && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    chain.unshift(parent)
    parentId = MOCK_ANCESTRY[parentId]
  }

  return chain
}

function buildMockThreadResponse(focusedPostId: string): ThreadWireResponse {
  const byId = new Map(listPosts().map(post => [post.id, post]))
  return {
    ancestors: buildAncestorChain(focusedPostId, byId),
    focused: byId.get(focusedPostId) ?? null,
    replies: [...(MOCK_REPLIES_BY_PARENT[focusedPostId] ?? [])],
  }
}

// -----------------------------------------------------------------------------
// Resolution (mirrors `personaService.resolvePersonas()`'s mock/live seam)
// -----------------------------------------------------------------------------

function isValidPost(value: unknown): value is Post {
  if (!value || typeof value !== 'object') return false
  const p = value as Post
  return (
    typeof p.id === 'string' && p.id.length > 0 &&
    typeof p.authorPersonaId === 'string' && p.authorPersonaId.length > 0 &&
    typeof p.text === 'string' &&
    typeof p.scenarioTime === 'string' && p.scenarioTime.length > 0
  )
}

function isValidReply(value: unknown): value is MockReplyPost {
  if (!isValidPost(value)) return false
  const r = value as MockReplyPost
  return (
    typeof r.replyToPersonaId === 'string' && r.replyToPersonaId.length > 0 &&
    (r.status === 'visible' || r.status === 'taken-down')
  )
}

function isValidThreadResponse(data: unknown): data is ThreadWireResponse {
  if (!data || typeof data !== 'object') return false
  const d = data as ThreadWireResponse
  return (
    Array.isArray(d.ancestors) && d.ancestors.every(isValidPost) &&
    (d.focused === null || isValidPost(d.focused)) &&
    Array.isArray(d.replies) && d.replies.every(isValidReply)
  )
}

/**
 * Resolves a thread's ancestors/focused/replies. Throws on request failure or
 * a malformed body (fail-closed — mirrors `resolvePersonas()`); `<ThreadView>`
 * (via `useThread`) turns that into a non-crashing "thread unavailable" render
 * rather than propagating the throw into a participant surface.
 */
export async function resolveThread(focusedPostId: string): Promise<ThreadWireResponse> {
  // A fresh adapter per call (unlike `personaService`'s single constant) since
  // the mock body depends on which thread was requested; still routed through
  // the shared axios client so a live `/threads/:id` call needs no consumer
  // change, only removing the `adapter` override.
  const mockAdapter: AxiosAdapter = config => Promise.resolve({
    data: buildMockThreadResponse(focusedPostId),
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  })

  const response = await api.get<ThreadWireResponse>(
    `/threads/${encodeURIComponent(focusedPostId)}`,
    USE_MOCK_DATA ? { adapter: mockAdapter } : undefined,
  )

  if (!isValidThreadResponse(response.data)) {
    throw new Error('resolveThread: resolution returned a malformed thread')
  }
  return response.data
}

/**
 * Resolves a flattened thread for a component. A thin useState/useEffect
 * wrapper over `resolveThread()` (mirrors `usePersonas()`) that narrows every
 * post to its participant-safe view (`toParticipantView`, XC-002) before
 * handing it back.
 */
export function useThread(focusedPostId: string): UseThreadResult {
  const [ancestors, setAncestors] = useState<readonly ParticipantPostView[]>([])
  const [focused, setFocused] = useState<ParticipantPostView | undefined>(undefined)
  const [replies, setReplies] = useState<readonly ThreadReplyView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(undefined)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    resolveThread(focusedPostId)
      .then(resolved => {
        if (cancelled) return
        setAncestors(resolved.ancestors.map(toParticipantView))
        setFocused(resolved.focused ? toParticipantView(resolved.focused) : undefined)
        setReplies(
          resolved.replies.map(reply => ({
            ...toParticipantView(reply),
            replyToPersonaId: reply.replyToPersonaId,
            status: reply.status,
          })),
        )
        setError(undefined)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setAncestors([])
        setFocused(undefined)
        setReplies([])
        setError(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [focusedPostId])

  return { ancestors, focused, replies, loading, error }
}
