/**
 * features/social/pinned/exercisePinState.ts
 * ---------------------------------------------------------------------------
 * The "pinned for everyone" state every post card reads for its **Pinned** marker
 * (demo-feedback story 21; DF-7, DF-34, SOC-071, NFR-001). Participant world - a pure
 * module store plus one hook, no UI, no network of its own, no clock.
 *
 * WHY A SEPARATE FILE. Story 07's `pinEvents.ts` holds the viewer's PERSONAL pins
 * (`pinState`) and the settle channel (`viewerEngagement`); neither keeps the EXERCISE pin
 * per post, and that file belongs to story 07. This is the read-only per-post selector the
 * marker needs, built on the sources story 07 already provides - it opens NO new hub
 * subscription:
 *
 *   - `realtimeFeed.subscribePinChanged` (story 07's frozen fan-out of the ONE shared hub
 *     connection's `PostPinChanged { postId, pinnedForAll }`), and
 *   - `viewerEngagement` events of kind `'exercise'` (story 07's mock-mode stand-in for that
 *     push, raised by `mockPins.setMockExercisePin`).
 *
 * ONE handler is registered on each, lazily, when the first card subscribes, and stays for
 * the life of the tab: a change to a post that is not on screen right now is still recorded,
 * so a card that mounts later from an older read (the Home feed's frozen baseline) shows it.
 *
 * WHAT IT HOLDS. For each post a push named: `{ pinnedForAll }`, a fresh object per push (so
 * a repeat push of the same value is still "newer" than a re-read in between). Post ids and
 * booleans only - never who pinned it or when (XC-002, COR-053). No cap: an exercise pin is a
 * deliberate controller act, a handful per exercise.
 *
 * READING IT. `usePinnedForAll(postId, fromRead)` picks between the post's own
 * `pinnedForAll` from the read that rendered the card (`fromRead`) and the held push, with
 * the same rule as `postCountsStore.usePostCounts`:
 *  - ON MOUNT a held push wins (it is at least as new as a baseline that predates it);
 *  - WHILE MOUNTED the most recently observed wins: a push that arrives wins, and a re-read
 *    that hands the card a DIFFERENT `fromRead` wins in turn, until the next push.
 *  - KNOWN LIMIT: a push missed while the hub was down is not seen; a card that mounts after
 *    it with a held push from before the gap can show the older state until the next push or
 *    a re-read with a changed value.
 *
 * BURST LEGIBILITY (SOC-071). Listeners are kept PER POST ID: a pin change wakes only the
 * cards showing that post, never every card on the feed.
 *
 * PRIVACY (DF-6). This is the exercise pin only. The viewer's personal pin never reaches it.
 *
 * SESSION. `reset()` forgets every held push and wakes the affected cards; it is registered
 * with `registerSessionReset`, so one identity's state never decorates the next sign-in.
 */

import { useCallback, useState, useSyncExternalStore } from 'react'
import { registerSessionReset } from '@/core/auth/sessionReset'
import { realtimeFeed } from '../services/realtimeFeed'
import { viewerEngagement } from './pinEvents'

/** One post's newest pushed exercise-pin state. Immutable: replaced, never mutated. */
export interface ExercisePinEntry {
  readonly pinnedForAll: boolean
}

type Listener = () => void

const entries = new Map<string, ExercisePinEntry>()
const listeners = new Map<string, Set<Listener>>()
let disconnect: (() => void) | null = null

function notify(postId: string): void {
  const set = listeners.get(postId)
  if (set === undefined) return
  for (const listener of [...set]) listener()
}

/** Records a pushed state for `postId` (always a new entry) and wakes that post's cards only. */
function apply(postId: string, pinnedForAll: boolean): void {
  if (typeof postId !== 'string' || postId.length === 0) return
  entries.set(postId, { pinnedForAll })
  notify(postId)
}

/** Attaches the one handler per existing source (idempotent). */
function connect(): void {
  if (disconnect !== null) return
  const offPush =
    typeof realtimeFeed.subscribePinChanged === 'function'
      ? realtimeFeed.subscribePinChanged(({ postId, pinnedForAll }) => apply(postId, pinnedForAll))
      : () => {}
  const offMock = viewerEngagement.subscribe(event => {
    if (event.kind === 'exercise') apply(event.postId, event.active)
  })
  disconnect = () => {
    offPush()
    offMock()
  }
}

/** The newest pushed state for `postId`, or `undefined`. Stable until the next push. */
function get(postId: string): ExercisePinEntry | undefined {
  return entries.get(postId)
}

/** Subscribes to pushes for ONE post; returns the unsubscribe. Connects the sources lazily. */
function subscribe(postId: string, listener: Listener): () => void {
  connect()
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

/** Sign-out: forgets every held push and wakes the affected cards (they show their read). */
function reset(): void {
  const held = [...entries.keys()]
  entries.clear()
  for (const postId of held) notify(postId)
}

/** Test-only: forgets everything and detaches from the sources (the next subscribe re-attaches). */
function resetForTests(): void {
  entries.clear()
  listeners.clear()
  disconnect?.()
  disconnect = null
}

/** The module-singleton store. See the module header for the contract. */
export const exercisePinState = { get, subscribe, reset, resetForTests }

registerSessionReset(() => exercisePinState.reset(), import.meta.hot)

/** Which source a card shows, and what it last saw of each. */
interface Observed {
  readonly postId: string
  readonly entry: ExercisePinEntry | undefined
  readonly fromRead: boolean
  readonly useRead: boolean
}

/**
 * Whether the post is pinned for everyone right now: its read's `pinnedForAll` or the newest
 * push (see the module header for the rule). Re-renders only when a push for THIS post lands.
 */
export function usePinnedForAll(postId: string, fromRead: boolean): boolean {
  const subscribeToPost = useCallback(
    (listener: Listener) => subscribe(postId, listener),
    [postId],
  )
  const getEntry = useCallback(() => get(postId), [postId])
  const entry = useSyncExternalStore(subscribeToPost, getEntry, getEntry)
  const [observed, setObserved] = useState<Observed>(() => ({
    postId,
    entry,
    fromRead,
    useRead: entry === undefined,
  }))

  let current = observed
  if (observed.postId !== postId) {
    current = { postId, entry, fromRead, useRead: entry === undefined }
    setObserved(current)
  } else if (observed.entry !== entry || observed.fromRead !== fromRead) {
    // A new push (or a reset) wins over the read; else a fresher read changed the value.
    const useRead = observed.entry !== entry ? entry === undefined : true
    current = { postId, entry, fromRead, useRead }
    // Render-phase adjustment (React's "store information from previous renders" pattern).
    setObserved(current)
  }

  return current.useRead || current.entry === undefined ? fromRead : current.entry.pinnedForAll
}
