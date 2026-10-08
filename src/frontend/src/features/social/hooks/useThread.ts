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
 *
 * CONTRACT v2 (demo-polish F0): the mock thread ALSO knows the v2 fixture thread
 * from `services/mockFixtures.ts` (root -> question -> focused, whose focused post
 * has three direct replies — one with media, one taken-down TOMBSTONE). It is
 * resolved by id regardless of `DEMO_FIXTURES_ENABLED` (a thread is looked up, it
 * is not a feed), walks ancestors via `inReplyTo` (depth-capped at 50, soft-deleted
 * ancestors omitted), and returns a taken-down reply as a tombstone: `status:
 * 'taken-down'`, empty `text`, no `media`, zero `counts`. The guards below accept
 * the optional v2 members (`media`/`inReplyTo`/`viewer`) and reject malformed ones.
 *
 * REPLIES CREATED IN DEV (demo-polish F4). The mock thread is built from
 * `postStore` (seeded with `listPosts()` and, in dev, the demo fixtures) PLUS the
 * fixture threads, so a reply the participant composes in `npm run dev` — which
 * `useComposePost` appends to `postStore`, where `appendPost` links it to its
 * parent — shows in that parent's thread on the next resolve. (The older
 * `listPosts()`-only build could never show one.)
 *
 * LIVE REPLY APPEND (demo-polish F4, story 13). With `options.live`, the hook
 * also listens to the UNFILTERED arrival source (`feedStreamSource.
 * defaultArrivalSource` — replies never reach the feed's pill, they land here):
 * a post whose `inReplyTo.postId` is the focused post is APPENDED BELOW the
 * existing replies (arrival order, never re-sorted, so nothing under the reader
 * moves), de-duplicated by id against both the fetched replies and earlier live
 * ones, and counted into the focused post's `counts.reply`. It is a derived
 * overlay on the fetched thread rather than a rewrite of it, so a late fetch
 * result that already contains the live reply neither duplicates nor double-counts
 * it. `appendReply(view)` is the same append for the viewer's OWN reply (the 201
 * response), which makes the SignalR echo of that reply a no-op. `newReplyCount`
 * is how many replies arrived from SOMEONE ELSE since the thread loaded — what
 * `<ThreadView>`'s polite live region announces ("1 new reply"); the viewer's own
 * reply is not announced as new.
 *
 * Reconnect gap: a reply that arrived while the transport was down is not
 * replayed here (the feed's polling fallback reads the top-level feed only), so
 * a reload is the recovery path. Not in this story's scope.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { personaIdForHandle } from '@/features/personas'
import {
  toParticipantView,
  type ParticipantPostView,
  type Post,
  type PostCounts,
} from '@/features/social'
import { hasWellFormedV2Members } from '../services/postService'
import { postStore } from '../services/postStore'
import { listDemoFixturePosts, listDemoTakenDownPosts } from '../services/mockFixtures'
import { defaultArrivalSource, type FeedStreamSource } from '../services/feedStreamSource'

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
  /**
   * The focused post, or `undefined` while loading / if it could not be resolved.
   * Its `counts.reply` includes the replies appended live since load.
   */
  readonly focused: ParticipantPostView | undefined
  /**
   * The focused post's direct replies, oldest first as fetched, then any replies
   * appended live (or by `appendReply`) in arrival order.
   */
  readonly replies: readonly ThreadReplyView[]
  readonly loading: boolean
  readonly error: unknown
  /**
   * How many replies from SOMEONE ELSE were appended live since the thread
   * loaded. Drives the polite "N new replies" announcement; the viewer's own
   * reply never counts. 0 until a live reply arrives (and always 0 unless
   * `options.live`).
   */
  readonly newReplyCount: number
  /**
   * Appends the viewer's OWN just-published reply below the existing ones and
   * bumps the focused post's reply count — once. A no-op if that reply (by id) is
   * already in the thread, so the realtime echo of it, arriving before or after,
   * can never duplicate it.
   *
   * It is also a no-op unless the reply belongs to the thread that is focused NOW:
   * a 201 can land after the reader has moved on to another thread, and appending it
   * there would show a reply under the wrong post. The parent is `parentPostId` when
   * the caller names it (the composer knows which post it replied to), else the
   * reply's own `inReplyTo.postId`; with neither, it is appended.
   */
  readonly appendReply: (reply: ParticipantPostView, parentPostId?: string) => void
}

/** Options for {@link useThread}. */
export interface UseThreadOptions {
  /**
   * Listen for live replies to the focused post and append them (see the module
   * header). Default `false`: the hook is then a plain one-shot read, exactly as
   * before. `<ThreadView>` turns it on for sessions that stream (D1-011).
   */
  readonly live?: boolean
  /**
   * The arrival source for live replies. Defaults to the shared
   * `defaultArrivalSource`. Injectable for tests; MUST be a stable reference
   * across renders (it is an effect dependency).
   */
  readonly source?: FeedStreamSource
  /**
   * The viewer's own persona id. A live reply authored by it is appended but not
   * announced as new (it is the viewer's own, arriving as its echo). Omit for a
   * session with no persona.
   */
  readonly viewerPersonaId?: string
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
      inReplyTo: { postId: 'post-seed-mvega-question', authorHandle: 'mvega_fh' },
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
      inReplyTo: { postId: 'post-seed-mvega-question', authorHandle: 'mvega_fh' },
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

/** The parent of `postId`: the hand-authored legacy chain first, else `inReplyTo`. */
function parentIdOf(postId: string, byId: ReadonlyMap<string, Post>): string | undefined {
  return MOCK_ANCESTRY[postId] ?? byId.get(postId)?.inReplyTo?.postId
}

/** The server caps the ancestor walk at depth 50 (implementation.md §1.5.3). */
const MAX_ANCESTOR_DEPTH = 50

function buildAncestorChain(focusedPostId: string, byId: ReadonlyMap<string, Post>): Post[] {
  const chain: Post[] = []
  const seen = new Set<string>()
  let parentId = parentIdOf(focusedPostId, byId)

  while (parentId !== undefined && !seen.has(parentId) && chain.length < MAX_ANCESTOR_DEPTH) {
    seen.add(parentId)
    // Soft-deleted ancestors are not in `byId` (visible posts only) -> the walk stops.
    const parent = byId.get(parentId)
    if (!parent) break
    chain.unshift(parent)
    parentId = parentIdOf(parentId, byId)
  }

  return chain
}

/** Oldest first, by scenario time (the thread contract's reply order). */
function byScenarioTimeAscending(a: Post, b: Post): number {
  return Date.parse(a.scenarioTime) - Date.parse(b.scenarioTime)
}

/** A visible v2 fixture reply, shaped as a thread reply. */
function toVisibleReply(post: Post): MockReplyPost {
  return {
    ...post,
    replyToPersonaId: personaIdForHandle(post.inReplyTo?.authorHandle ?? ''),
    status: 'visible',
  }
}

/**
 * A soft-deleted reply, shaped as the contract's TOMBSTONE: `status:
 * 'taken-down'`, empty text, no media/link/viewer, zero counts. The original
 * text, media and counts are deliberately NOT carried.
 */
function toTombstone(post: Post): MockReplyPost {
  return {
    id: post.id,
    exerciseId: post.exerciseId,
    authorPersonaId: post.authorPersonaId,
    actingHumanId: post.actingHumanId,
    text: '',
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: post.createdWallClock,
    scenarioTime: post.scenarioTime,
    origin: post.origin,
    ...(post.injectId !== undefined ? { injectId: post.injectId } : {}),
    ...(post.inReplyTo !== undefined ? { inReplyTo: post.inReplyTo } : {}),
    replyToPersonaId: personaIdForHandle(post.inReplyTo?.authorHandle ?? ''),
    status: 'taken-down',
  }
}

function buildMockThreadResponse(focusedPostId: string): ThreadWireResponse {
  // Visible posts only: a soft-deleted post is never an ancestor or a focus. The
  // fixture threads are always known (a thread is looked up by id, it is not a
  // feed); `postStore` is laid over them so its version of a post wins — it holds
  // the bumped reply counts AND every reply composed since the page loaded.
  const byId = new Map<string, Post>()
  for (const post of listDemoFixturePosts()) byId.set(post.id, post)
  for (const post of postStore.getPosts()) byId.set(post.id, post)

  const replies: MockReplyPost[] = [
    ...(MOCK_REPLIES_BY_PARENT[focusedPostId] ?? []),
    ...[...byId.values()]
      .filter(post => post.inReplyTo?.postId === focusedPostId)
      .map(toVisibleReply),
    ...listDemoTakenDownPosts()
      .filter(post => post.inReplyTo?.postId === focusedPostId)
      .map(toTombstone),
  ]
  return {
    ancestors: buildAncestorChain(focusedPostId, byId),
    focused: byId.get(focusedPostId) ?? null,
    replies: replies.sort(byScenarioTimeAscending),
  }
}

// -----------------------------------------------------------------------------
// Resolution (mirrors `personaService.resolvePersonas()`'s mock/live seam)
// -----------------------------------------------------------------------------

// Mirrors `feedService.isPost`: `useThread` narrows every post through
// `toParticipantView` and then renders it in `<PostCard>`, which reads
// `counts.{reply,repost,like}`. A malformed `/threads/:id` response missing
// `counts` must fail closed HERE, not crash later at render — so validate the
// engagement counts, not just the id/text/time fields.
function isValidPost(value: unknown): value is Post {
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
    typeof p.counts.like === 'number' &&
    // Contract v2: optional media / inReplyTo / viewer must be well-formed when
    // present (shared with `feedService.isPost`).
    hasWellFormedV2Members(p)
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

/** A live (or own) reply that overlays the fetched thread. */
interface LiveReply {
  readonly view: ParticipantPostView
  /** Counted into `newReplyCount` (a reply from someone else). */
  readonly announce: boolean
}

/**
 * Resolves a flattened thread for a component. A thin useState/useEffect
 * wrapper over `resolveThread()` (mirrors `usePersonas()`) that narrows every
 * post to its participant-safe view (`toParticipantView`, XC-002) before
 * handing it back, and (with `options.live`) overlays replies that arrive after
 * the load — see the module header.
 */
export function useThread(focusedPostId: string, options: UseThreadOptions = {}): UseThreadResult {
  const { live = false, source = defaultArrivalSource, viewerPersonaId } = options

  const [ancestors, setAncestors] = useState<readonly ParticipantPostView[]>([])
  const [focused, setFocused] = useState<ParticipantPostView | undefined>(undefined)
  const [fetchedReplies, setFetchedReplies] = useState<readonly ThreadReplyView[]>([])
  const [liveReplies, setLiveReplies] = useState<readonly LiveReply[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(undefined)

  // Adds a reply to the live overlay, once per id.
  const addLiveReply = useCallback((view: ParticipantPostView, announce: boolean) => {
    setLiveReplies(prev =>
      prev.some(entry => entry.view.id === view.id) ? prev : [...prev, { view, announce }],
    )
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // A different thread starts with no overlay from the previous one.
    setLiveReplies([])

    resolveThread(focusedPostId)
      .then(resolved => {
        if (cancelled) return
        setAncestors(resolved.ancestors.map(toParticipantView))
        setFocused(resolved.focused ? toParticipantView(resolved.focused) : undefined)
        setFetchedReplies(
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
        setFetchedReplies([])
        setError(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [focusedPostId])

  // Live replies. Subscribed from mount (not from the fetch result) so a reply
  // that lands while the thread is still loading is kept and merged, not lost.
  useEffect(() => {
    if (!live) return
    const unsubscribe = source.subscribe(post => {
      if (post.inReplyTo?.postId !== focusedPostId) return
      // The viewer's own reply is appended (silently) by `appendReply`; if its
      // echo wins that race it is still not "new" to them. (The test is the viewer's
      // PERSONA, so a reply by someone else operating the same shared org persona
      // from another session is appended but not announced either - a deliberate,
      // accepted simplification: it still appears, only the announcement is skipped.)
      addLiveReply(post, post.authorPersonaId !== viewerPersonaId)
    })
    void source.start().catch(() => {})
    return () => {
      unsubscribe()
      source.stop()
    }
  }, [live, source, focusedPostId, viewerPersonaId, addLiveReply])

  // The thread focused RIGHT NOW, readable from a callback that outlives a render
  // (`appendReply` is called from a publish that can resolve after navigation).
  const focusedPostIdRef = useRef(focusedPostId)
  useEffect(() => {
    focusedPostIdRef.current = focusedPostId
  }, [focusedPostId])

  const appendReply = useCallback(
    (reply: ParticipantPostView, parentPostId?: string) => {
      const parent = parentPostId ?? reply.inReplyTo?.postId
      if (parent !== undefined && parent !== focusedPostIdRef.current) return
      addLiveReply(reply, false)
    },
    [addLiveReply],
  )

  // The overlay, minus anything the fetch already returned (a late fetch that
  // already includes the live reply must not show it twice or count it twice).
  const { replies, focusedWithLive, newReplyCount } = useMemo(() => {
    const fetchedIds = new Set(fetchedReplies.map(reply => reply.id))
    const overlay = liveReplies.filter(entry => !fetchedIds.has(entry.view.id))
    // A live reply is a DIRECT reply to the focused post, so what it replies to
    // is the focused post's author (the contract's `replyToPersonaId`) — an
    // opaque id, never derived from the handle.
    const focusedAuthorId = focused?.authorPersonaId ?? ''
    return {
      replies: overlay.length === 0
        ? fetchedReplies
        : [
          ...fetchedReplies,
          ...overlay.map((entry): ThreadReplyView => ({
            ...entry.view,
            replyToPersonaId: focusedAuthorId,
            status: 'visible',
          })),
        ],
      focusedWithLive: focused !== undefined && overlay.length > 0
        ? {
          ...focused,
          counts: { ...focused.counts, reply: focused.counts.reply + overlay.length },
        }
        : focused,
      newReplyCount: overlay.filter(entry => entry.announce).length,
    }
  }, [fetchedReplies, liveReplies, focused])

  return {
    ancestors,
    focused: focusedWithLive,
    replies,
    loading,
    error,
    newReplyCount,
    appendReply,
  }
}
