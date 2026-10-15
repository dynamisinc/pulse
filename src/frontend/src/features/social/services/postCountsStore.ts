/**
 * features/social/services/postCountsStore.ts
 * ---------------------------------------------------------------------------
 * The live engagement counts every post card reads (demo-feedback story 14; DF-17, DF-18,
 * SOC-071). Participant world - a framework-free LEAF store (it imports nothing but React's
 * `useSyncExternalStore`), so `core/auth/endSession.ts` can reset it on sign-out without
 * pulling a feature into `core/`.
 *
 * WHAT IT HOLDS. For each post a pushed `PostEngagementChanged` named: the SHOWN counts
 * `{ reply, repost, like }` and the frame's `version`. Nothing else - never who reacted and
 * never the viewer's own liked / reposted state (a push is one payload for the whole exercise;
 * `active` stays the card's own business).
 *
 * VERSION-GATED. `apply(postId, counts, version)` keeps a frame only when its `version` is
 * HIGHER than the one held for that post. The server derives `version` from the database
 * (reaction rows + their soft-delete stamps + replies), so it rises with every state change and
 * two app instances agree: a replayed, duplicated or reordered (older) frame is dropped here
 * and can never wind a number back.
 *
 * READING IT. `usePostCounts(postId, seed)` returns the NEWEST of two sources, by the order this
 * card observed them:
 *  - the post's own `counts` from the read that rendered it (`seed`), and
 *  - the store's frame for the post.
 * A frame that arrives after the card's read wins; a re-read that re-seeds the card with
 * different numbers after the last frame wins in turn (e.g. after a reconnect, when frames were
 * missed while polling). With no frame for the post the seed is all there is.
 *
 * SIGN-OUT. `reset()` forgets every frame (called from `core/auth/endSession.ts`, so one
 * identity's numbers never decorate the next sign-in's cards on the same tab), and ALWAYS bumps a
 * reset generation (even on an empty store; the `pinState` pattern). Anything that started
 * before a reset and answers after it - an optimistic toggle settling, a mock frame from that
 * toggle - captures `generation()` first and passes it to `apply`, which drops the frame when the
 * generation has moved on, so nothing from the previous session leaks into the next.
 *
 * Where frames come from: `realtimeFeed.ts` applies every validated `PostEngagementChanged` from
 * the default engagement source (the shared hub connection, or the mock adapter under
 * `USE_MOCK_DATA`). Pure state; no network, no clock, no UI.
 */

import { useState, useSyncExternalStore } from 'react'

/** The three shown counts a push carries (structurally the post model's `PostCounts`). */
export interface EngagementCounts {
  readonly reply: number
  readonly repost: number
  readonly like: number
}

/** One post's newest accepted frame. Immutable: replaced, never mutated. */
export interface PostCountsEntry {
  readonly counts: EngagementCounts
  readonly version: number
}

type Listener = () => void

const entries = new Map<string, PostCountsEntry>()
// Bumped on EVERY reset (even an empty one): a late answer from an earlier identity is stale.
let resetGeneration = 0
const listeners = new Map<string, Set<Listener>>()

function notify(postId: string): void {
  const set = listeners.get(postId)
  if (set === undefined) return
  for (const listener of [...set]) listener()
}

/**
 * Keeps the frame when `version` is higher than the one held for `postId` (or none is held).
 * Returns whether it was kept. A frame is copied key by key - nothing else the caller's object
 * carried is stored. `generation`, when given, is the {@link generation} the caller captured when
 * its request STARTED: if a reset happened since, the frame belongs to the previous session and
 * is dropped.
 */
function apply(
  postId: string,
  counts: EngagementCounts,
  version: number,
  generation?: number,
): boolean {
  if (generation !== undefined && generation !== resetGeneration) return false
  const held = entries.get(postId)
  if (held !== undefined && version <= held.version) return false
  entries.set(postId, {
    counts: { reply: counts.reply, repost: counts.repost, like: counts.like },
    version,
  })
  notify(postId)
  return true
}

/** The newest frame held for `postId`, or `undefined`. Stable until the next accepted frame. */
function get(postId: string): PostCountsEntry | undefined {
  return entries.get(postId)
}

/** Subscribes to accepted frames for ONE post; returns the unsubscribe. */
function subscribe(postId: string, listener: Listener): () => void {
  let set = listeners.get(postId)
  if (set === undefined) {
    set = new Set()
    listeners.set(postId, set)
  }
  set.add(listener)
  return () => {
    const current = listeners.get(postId)
    if (current === undefined) return
    current.delete(listener)
    if (current.size === 0) listeners.delete(postId)
  }
}

/**
 * The current reset generation. Capture it before a request; if it changed by the time the
 * request answers, a session reset happened in between (see `apply`).
 */
function generation(): number {
  return resetGeneration
}

/**
 * Sign-out: forgets every frame and tells every mounted card (they fall back to their seed).
 * Always advances the generation.
 */
function reset(): void {
  resetGeneration += 1
  const held = [...entries.keys()]
  entries.clear()
  for (const postId of held) notify(postId)
}

/** The module-singleton store. See the module header for the contract. */
export const postCountsStore = { apply, get, subscribe, generation, reset }

/** A seed's numbers as one comparable key (a re-render with an equal object is not a re-read). */
function seedKey(seed: EngagementCounts): string {
  return `${seed.reply}|${seed.repost}|${seed.like}`
}

/** Which source a card shows, and what it last saw of each. */
interface Observed {
  readonly entry: PostCountsEntry | undefined
  readonly seedKey: string
  readonly useSeed: boolean
}

/**
 * The counts a card shows for `postId`: the newest of its `seed` (the post's own `counts`) and the
 * store's frame, by observation order (see the module header). Re-renders only when a frame for
 * THIS post is accepted.
 */
export function usePostCounts(postId: string, seed: EngagementCounts): EngagementCounts {
  const entry = useSyncExternalStore(
    listener => subscribe(postId, listener),
    () => get(postId),
    () => get(postId),
  )
  const key = seedKey(seed)
  const [observed, setObserved] = useState<Observed>(() => ({
    entry,
    seedKey: key,
    useSeed: entry === undefined,
  }))

  let current = observed
  if (observed.entry !== entry || observed.seedKey !== key) {
    // A new frame (or a reset) wins over the seed; else a fresher read re-seeded the card.
    const useSeed = observed.entry !== entry ? entry === undefined : true
    current = { entry, seedKey: key, useSeed }
    // Render-phase adjustment (React's "store information from previous renders" pattern).
    setObserved(current)
  }

  return current.useSeed || current.entry === undefined ? seed : current.entry.counts
}
