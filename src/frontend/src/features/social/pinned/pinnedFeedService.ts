/**
 * features/social/pinned/pinnedFeedService.ts
 * ---------------------------------------------------------------------------
 * The Pinned tab READ seam (demo-feedback story 07; DF-5). Participant world - pure
 * service module, no UI. `GET /api/feed/pinned` through the shared axios client, with a
 * mock adapter behind the existing `USE_MOCK_DATA` switch (mirrors `feedService.resolveFeed`).
 *
 * WIRE (implementation.md, story 04): `200 { items: [{ reason, post }] }`, in DF-5 order
 * (exercise pins first, newest pin first; then the viewer's pins and likes merged, newest
 * first), each post once, replies included, taken-down posts excluded, at most 200. The
 * client keeps the server's order - it never re-sorts.
 *
 * NO CLIENT SCOPE (COR-001): no `exerciseId`, no persona, no query string. The server
 * scopes everything from the session.
 *
 * FAIL CLOSED + XC-002: the body must be `{ items: [...] }` with a known `reason` and a
 * well-formed post on every item (the same guard the feed applies, contract-v2 members
 * included); anything else REJECTS, never an empty tab. Each post is then narrowed through
 * the sole sanctioned `toParticipantView`, so nothing outside the participant view (no
 * provenance, never who pinned it) can reach the tab.
 *
 * MOCK ADAPTER: builds the response from the in-tab `postStore` and the mock pin / like
 * memory (`mockPins`) with the server's rules: reason precedence `exercise` > `pin` >
 * `like`, the same order, taken-down posts (`removedPosts`) excluded, capped at 200, and
 * each post projected participant-safe with the viewer's flags and `pinnedForAll` set.
 */

import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import { AxiosError } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { compareNewestFirst } from '../services/feedService'
import { hasWellFormedV2Members, toParticipantView } from '../services/postService'
import { postStore } from '../services/postStore'
import { removedPosts } from '../services/removedPosts'
import type { ParticipantPostView, Post } from '../types/post'
import { isMockPinFailing, mockPinView } from './mockPins'
import type { PinnedFeedItem, PinnedFeedReason } from './types'

/** The most items one Pinned read returns (DF-5). */
export const PINNED_FEED_MAX_ITEMS = 200

const REASONS: readonly PinnedFeedReason[] = ['exercise', 'pin', 'like']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isReason(value: unknown): value is PinnedFeedReason {
  return typeof value === 'string' && (REASONS as readonly string[]).includes(value)
}

/** The feed's own post guard (`feedService.isPost`), applied to one pinned item's post. */
function isWirePost(value: unknown): value is Post {
  if (!isRecord(value)) return false
  const { id, authorPersonaId, text, scenarioTime, counts } = value
  return (
    typeof id === 'string' && id.length > 0 &&
    typeof authorPersonaId === 'string' && authorPersonaId.length > 0 &&
    typeof text === 'string' &&
    typeof scenarioTime === 'string' && scenarioTime.length > 0 &&
    isRecord(counts) &&
    typeof counts.reply === 'number' &&
    typeof counts.repost === 'number' &&
    typeof counts.like === 'number' &&
    hasWellFormedV2Members(value)
  )
}

/** Validates the 200 body and narrows every post (see the module header). */
function toPinnedItems(data: unknown): PinnedFeedItem[] {
  if (!isRecord(data) || !Array.isArray(data.items)) {
    throw new Error('resolvePinnedFeed: malformed pinned feed')
  }
  return data.items.map(item => {
    if (!isRecord(item) || !isReason(item.reason) || !isWirePost(item.post)) {
      throw new Error('resolvePinnedFeed: malformed pinned feed item')
    }
    return { reason: item.reason, post: toParticipantView(item.post) }
  })
}

// -----------------------------------------------------------------------------
// Mock adapter
// -----------------------------------------------------------------------------

interface MockCandidate {
  readonly reason: PinnedFeedReason
  /** Sequence order within the reason group (higher = newer); 0 for an untouched fixture flag. */
  readonly seq: number
  readonly view: ParticipantPostView
}

/** One post's mock Pinned entry, or `null` when it does not belong on the tab. */
function mockCandidate(post: Post): MockCandidate | null {
  const remembered = mockPinView(post.id)
  const pinned = remembered.pinned?.active ?? post.viewer?.pinned === true
  const liked = remembered.liked?.active ?? post.viewer?.liked === true
  const pinnedForAll = remembered.exercisePinSeq !== undefined

  let reason: PinnedFeedReason
  let seq: number
  if (pinnedForAll) {
    reason = 'exercise'
    seq = remembered.exercisePinSeq ?? 0
  } else if (pinned || liked) {
    // A post both pinned and liked sits where its NEWEST reaction puts it (the server's rule).
    reason = pinned ? 'pin' : 'like'
    seq = Math.max(
      pinned ? remembered.pinned?.seq ?? 0 : 0,
      liked ? remembered.liked?.seq ?? 0 : 0,
    )
  } else {
    return null
  }

  const safe = toParticipantView(post)
  const view: ParticipantPostView = {
    ...safe,
    viewer: { liked, reposted: safe.viewer?.reposted ?? false, pinned },
    ...(pinnedForAll ? { pinnedForAll: true as const } : {}),
  }
  return { reason, seq, view }
}

/** Newest first: the higher sequence wins, then the newer scenario time (COR-053). */
function compareCandidates(a: MockCandidate, b: MockCandidate): number {
  if (a.seq !== b.seq) return b.seq - a.seq
  return compareNewestFirst(a.view.scenarioTime, b.view.scenarioTime)
}

/** The mock `GET /api/feed/pinned` body, built with the server's DF-5 rules. */
export function buildMockPinnedFeed(): { items: PinnedFeedItem[] } {
  const exercise: MockCandidate[] = []
  const personal: MockCandidate[] = []
  for (const post of postStore.getPosts()) {
    if (removedPosts.has(post.id)) continue
    const candidate = mockCandidate(post)
    if (candidate === null) continue
    if (candidate.reason === 'exercise') exercise.push(candidate)
    else personal.push(candidate)
  }
  const ordered = [...exercise.sort(compareCandidates), ...personal.sort(compareCandidates)]
  return {
    items: ordered
      .slice(0, PINNED_FEED_MAX_ITEMS)
      .map(candidate => ({ reason: candidate.reason, post: candidate.view })),
  }
}

const mockAdapter: AxiosAdapter = (config: InternalAxiosRequestConfig) => {
  if (isMockPinFailing()) {
    const response = {
      data: { error: 'mock pinned feed failure' },
      status: 503,
      statusText: 'Service Unavailable',
      headers: {},
      config,
    }
    return Promise.reject(
      new AxiosError('mock pinned feed failure', AxiosError.ERR_BAD_RESPONSE, config, null, response),
    )
  }
  return Promise.resolve({
    data: buildMockPinnedFeed(),
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  })
}

/**
 * Resolves the viewer's Pinned tab, in the server's DF-5 order. Rejects on a request
 * failure or a malformed body (fail closed - never an empty tab in place of an error).
 */
export async function resolvePinnedFeed(): Promise<PinnedFeedItem[]> {
  const response = await api.get<unknown>(
    '/feed/pinned',
    USE_MOCK_DATA ? { adapter: mockAdapter } : undefined,
  )
  return toPinnedItems(response.data)
}
