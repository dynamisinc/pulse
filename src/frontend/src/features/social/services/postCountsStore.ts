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
 * `active` stays the card's own business). At most {@link MAX_ENTRIES} posts are held; past that
 * the oldest frame no mounted card is reading is forgotten first.
 *
 * VERSION-GATED. `apply(postId, counts, version)` keeps a frame only when its `version` is
 * HIGHER than the one held for that post. The server derives `version` from the database
 * (reaction rows + their soft-delete stamps + replies), so it rises with every state change and
 * two app instances agree: a replayed, duplicated or reordered (older) frame is dropped here
 * and can never wind a number back.
 *
 * READING IT. `usePostCounts(postId, seed)` picks between the post's own `counts` from the read
 * that rendered the card (`seed`) and the store's frame:
 *  - WHILE MOUNTED, the most recently observed wins: a frame that arrives after the card's read
 *    wins, and a re-read that re-seeds the card with different numbers wins in turn, until the
 *    next frame.
 *  - ON MOUNT (Gate-1 M-3), a held frame wins over the seed only while the push stream has been
 *    CONTINUOUS since the frame arrived. Every change that moves a shown count pushes a frame
 *    (like / repost / reply, and a reply takedown pushes its parent), so while the stream is
 *    unbroken the newest frame is at least as new as any read - even a read that landed after it
 *    carries the same numbers. When the stream breaks (the hub drops, reconnects or is stopped:
 *    `markGap()`), frames may have been missed, so a held frame from before the gap no longer
 *    beats a fresh seed on mount; a frame that arrives after the gap is trusted again. This is
 *    the rule instead of comparing a receive time with each query's `dataUpdatedAt`: cards are fed
 *    by several readers (feed, thread, profile, Pinned) and none of them hands the card its read
 *    time.
 *  - KNOWN LIMIT (Gate-1 L-A): a frame lost WHILE the connection stays `Connected` (a send that
 *    failed server-side and was only logged) is not a gap the client can see. A card mounting
 *    after it can then show the older held number until that post's next frame, or until a
 *    re-read re-seeds a mounted card.
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
 * `USE_MOCK_DATA`) and calls `markGap()` whenever the hub connection leaves `Connected`. Pure
 * state; no network, no clock, no UI.
 */

import { useCallback, useState, useSyncExternalStore } from 'react'

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
  /** The stream epoch the frame arrived in (see `markGap`). */
  readonly epoch: number
}

/** Most posts the store holds a frame for (Gate-1 L-3). */
export const MAX_ENTRIES = 500

type Listener = () => void

/** Insertion-ordered: the first key is the oldest frame. */
const entries = new Map<string, PostCountsEntry>()
const listeners = new Map<string, Set<Listener>>()
// Bumped on EVERY reset (even an empty one): a late answer from an earlier identity is stale.
let resetGeneration = 0
// Bumped whenever the push stream breaks: frames from an earlier epoch may have missed changes.
let streamEpoch = 0

function notify(postId: string): void {
  const set = listeners.get(postId)
  if (set === undefined) return
  for (const listener of [...set]) listener()
}

/** Forgets the oldest frame no mounted card reads (else the oldest of all) once over the cap. */
function enforceCap(): void {
  if (entries.size <= MAX_ENTRIES) return
  let victim: string | undefined
  for (const postId of entries.keys()) {
    if (!listeners.has(postId)) {
      victim = postId
      break
    }
  }
  victim ??= entries.keys().next().value
  if (victim === undefined) return
  entries.delete(victim)
  notify(victim)
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
  entries.delete(postId) // re-insert at the newest end
  entries.set(postId, {
    counts: { reply: counts.reply, repost: counts.repost, like: counts.like },
    version,
    epoch: streamEpoch,
  })
  enforceCap()
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
 * The push stream broke (the hub connection left `Connected`): frames may be missed from here,
 * so a frame held from before now stops beating a fresh read ON MOUNT. Mounted cards keep what
 * they show (nothing is notified); a later frame for a post is trusted again.
 */
function markGap(): void {
  streamEpoch += 1
}

/** Whether a held frame may beat a card's seed on mount (see the module header). */
function isTrusted(entry: PostCountsEntry): boolean {
  return entry.epoch === streamEpoch
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
export const postCountsStore = { apply, get, subscribe, markGap, generation, reset }

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
 * The counts a card shows for `postId`: its `seed` (the post's own `counts`) or the store's frame
 * (see the module header for the rule). Re-renders only when a frame for THIS post is accepted.
 */
export function usePostCounts(postId: string, seed: EngagementCounts): EngagementCounts {
  const subscribeToPost = useCallback(
    (listener: Listener) => subscribe(postId, listener),
    [postId],
  )
  const getEntry = useCallback(() => get(postId), [postId])
  const entry = useSyncExternalStore(subscribeToPost, getEntry, getEntry)
  const key = seedKey(seed)
  const [observed, setObserved] = useState<Observed>(() => ({
    entry,
    seedKey: key,
    // On mount a held frame wins only while the stream has been unbroken since it arrived.
    useSeed: entry === undefined || !isTrusted(entry),
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
