/**
 * features/social/services/mockEngagementChanges.ts
 * ---------------------------------------------------------------------------
 * The MOCK `PostEngagementChanged` source (demo-feedback story 14, DF-17): what a mock-data build
 * (`npm run dev`, the opted-in UAT build) has instead of the hub push, so the mock demo shows
 * counts and notifications moving live too. Participant world - a pure in-tab emitter, no
 * network, no clock, no UI.
 *
 * WHEN IT EMITS (the three mock writes that move a shown count):
 *  - a mock LIKE / REPOST that changed state: `useReactionToggle` calls
 *    {@link emitMockReactionEngagement} once per confirmed toggle (mock mode only), with the
 *    kind's new count;
 *  - a mock REPLY: `postStore.appendPost` bumps the parent's `counts.reply`; this source watches
 *    the store and emits the parent's counts for every reply appended after it started watching.
 * A frame's other two counts come from the newest frame already held for the post
 * (`postCountsStore`), else the post's own counts in the mock `postStore`, so a like never zeroes
 * the reply count. `version` is one counter for the whole tab, so it rises with every frame and is
 * therefore monotonic per post, like the server's.
 *
 * OFF UNDER VITEST BY DEFAULT (the same rule as the reaction adapter's memory): a module-level
 * emitter would otherwise carry one test's numbers into the next test's cards. A test that wants
 * it turns it on with {@link setMockEngagementForTests}.
 */

import { USE_MOCK_DATA } from '@/core/config/mockData'
import { postCountsStore, type EngagementCounts } from './postCountsStore'
import { postStore } from './postStore'
import type {
  EngagementChangeSource,
  PostEngagementChangedEvent,
  PostEngagementChangedHandler,
} from './realtimeFeed'

let enabled = USE_MOCK_DATA && import.meta.env.MODE !== 'test'
let version = 0
const handlers = new Set<PostEngagementChangedHandler>()
let unsubscribeStore: (() => void) | null = null
const seenIds = new Set<string>()

function postStoreCounts(postId: string): EngagementCounts | undefined {
  const post = postStore.getPosts().find(candidate => candidate.id === postId)
  if (post === undefined) return undefined
  return { reply: post.counts.reply, repost: post.counts.repost, like: post.counts.like }
}

/** The post's current shown counts as this tab knows them (newest frame, else the mock store). */
function currentCounts(postId: string): EngagementCounts {
  return postCountsStore.get(postId)?.counts
    ?? postStoreCounts(postId)
    ?? { reply: 0, repost: 0, like: 0 }
}

function emit(postId: string, counts: EngagementCounts, generation?: number): void {
  // A toggle that started before a sign-out / sign-in reset answers into the void (pinState).
  if (generation !== undefined && generation !== postCountsStore.generation()) return
  version += 1
  const event: PostEngagementChangedEvent = {
    postId,
    counts: { reply: counts.reply, repost: counts.repost, like: counts.like },
    version,
  }
  for (const handler of [...handlers]) {
    try {
      handler(event)
    } catch {
      // Isolated: one consumer's failure never starves the others.
    }
  }
}

/** Every reply appended since this source started watching: emit its parent's new counts. */
function onStoreChange(): void {
  for (const post of postStore.getPosts()) {
    if (seenIds.has(post.id)) continue
    seenIds.add(post.id)
    const parentId = post.inReplyTo?.postId
    if (!enabled || parentId === undefined) continue
    const parent = postStoreCounts(parentId)
    if (parent === undefined) continue
    // The store bumped the parent's reply count; the like / repost numbers are the newest known.
    emit(parentId, { ...currentCounts(parentId), reply: parent.reply })
  }
}

function watchStore(): void {
  if (unsubscribeStore !== null) return
  seenIds.clear()
  for (const post of postStore.getPosts()) seenIds.add(post.id)
  unsubscribeStore = postStore.subscribe(onStoreChange)
}

/**
 * A mock like / repost CHANGED state (call once per confirmed toggle, mock mode only): emits the
 * post's counts with `kind` set to its new `count`. A no-op while the source is off, and when
 * `generation` (the `postCountsStore.generation()` captured as the toggle STARTED) is stale.
 */
export function emitMockReactionEngagement(
  postId: string,
  kind: 'like' | 'repost',
  count: number,
  generation?: number,
): void {
  if (!enabled) return
  emit(postId, { ...currentCounts(postId), [kind]: count }, generation)
}

/** The mock {@link EngagementChangeSource} (`defaultEngagementChangeSource` under mock data). */
export const mockEngagementChanges: EngagementChangeSource = {
  subscribeEngagementChanged(handler) {
    handlers.add(handler)
    watchStore()
    let active = true
    return () => {
      if (!active) return
      active = false
      handlers.delete(handler)
    }
  },
}

/**
 * Test-only: turns the emitter on or off and forgets which store posts it has seen (call it after
 * `postStore.resetForTests()`, which drops every store listener, so the next subscribe re-watches).
 */
export function setMockEngagementForTests(on: boolean): void {
  enabled = on
  if (unsubscribeStore !== null) unsubscribeStore()
  unsubscribeStore = null
  seenIds.clear()
  if (handlers.size > 0) watchStore()
}
