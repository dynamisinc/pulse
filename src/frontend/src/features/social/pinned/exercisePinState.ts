/**
 * features/social/pinned/exercisePinState.ts
 * ---------------------------------------------------------------------------
 * The "pinned for everyone" state every post card reads for its **Pinned** marker
 * (demo-feedback story 21; DF-7, DF-34, SOC-071, NFR-001). Participant world - a pure
 * module store plus one hook, no UI, no clock. Its only network use is the one recovery read
 * after a hub gap (see HUB GAPS), through story 07's existing Pinned read seam.
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
 * WHAT IT HOLDS. For each post a push (or a recovery read) named: `{ pinnedForAll }`, a fresh
 * object per push (so a repeat push of the same value is still "newer" than a re-read in
 * between). Post ids and
 * booleans only - never who pinned it or when (XC-002, COR-053). No cap: an exercise pin is a
 * deliberate controller act, a handful per exercise.
 *
 * READING IT. `usePinnedForAll(postId, fromRead)` picks between the post's own
 * `pinnedForAll` from the read that rendered the card (`fromRead`) and the held push, with
 * the same rule as `postCountsStore.usePostCounts`:
 *  - ON MOUNT a held push wins (it is at least as new as a baseline that predates it);
 *  - WHILE MOUNTED the most recently observed wins: a push that arrives wins, and a re-read
 *    that hands the card a DIFFERENT `fromRead` wins in turn, until the next push.
 *  - HUB GAPS (#553 Copilot, replacing Gate-1 M-1's drop): when the shared connection leaves
 *    `Connected` (reconnecting, disconnected) pushes may be missed, but the reads do not
 *    refresh either (Home freezes its baseline; a thread re-reads only on focus), so dropping
 *    the held state would throw away valid pins. Instead the held state is KEPT through the
 *    gap, and on the transition back to `Connected` the store makes ONE authoritative read of
 *    the exercise's pins (`GET /api/feed/pinned`, story 04/07, via `resolvePinnedFeed`): its
 *    `reason: 'exercise'` items are the set pinned for everyone. Every held or mounted post id
 *    becomes pinned or unpinned to match that set, every id in it becomes pinned, and only the
 *    ids whose state changed are woken. A push that lands while the read is in flight is newer
 *    than the read and is kept. A failed read keeps the last-known state (and logs). The answer
 *    is dropped if a session reset (sign-out / sign-in, the exercise switch of a participant)
 *    or a newer recovery read overtook it. A deliberate `stop()` (reason `'stopped'`, run by
 *    the session reset itself) is not a gap. Mock mode makes no read: the mock exercise pin is
 *    an in-tab channel that cannot miss a change. This is a state listener on
 *    `realtimeConnection` (`onStateChange`), not a hub subscription.
 *
 * BURST LEGIBILITY (SOC-071). Listeners are kept PER POST ID: a pin change wakes only the
 * cards showing that post, never every card on the feed.
 *
 * PRIVACY (DF-6). This is the exercise pin only. The viewer's personal pin never reaches it.
 *
 * SESSION. `reset()` forgets every held push, wakes the affected cards and advances the reset
 * generation (so a recovery read still in flight is ignored when it answers); it is registered
 * with `registerSessionReset`, so one identity's state never decorates the next sign-in.
 * A Vite hot replace of this module detaches its handlers (`import.meta.hot.dispose`).
 */

import { useCallback, useState, useSyncExternalStore } from 'react'
import { registerSessionReset } from '@/core/auth/sessionReset'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { HubConnectionState, realtimeConnection } from '@/core/realtime/connection'
import { realtimeFeed } from '../services/realtimeFeed'
import { viewerEngagement } from './pinEvents'
import { resolvePinnedFeed } from './pinnedFeedService'

/** One post's newest pushed exercise-pin state. Immutable: replaced, never mutated. */
export interface ExercisePinEntry {
  readonly pinnedForAll: boolean
}

type Listener = () => void

const entries = new Map<string, ExercisePinEntry>()
const listeners = new Map<string, Set<Listener>>()
let disconnect: (() => void) | null = null
/** Advanced by every reset: a recovery read started under an older generation is ignored. */
let generation = 0
/** Advanced by every recovery read: only the newest one may apply its answer. */
let readSeq = 0
/** Whether the hub has left `Connected` since the last recovery (pushes may have been missed). */
let gapOpen = false

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

/** Drops every held push and wakes the affected cards (they fall back to their read). */
function dropHeld(): void {
  const held = [...entries.keys()]
  entries.clear()
  for (const postId of held) notify(postId)
}

/**
 * After a hub gap: ONE authoritative read of the exercise's pins, then every held or mounted
 * post (and every post in the answer) is set to match it. Only changed ids are woken. See the
 * module header (HUB GAPS) for the rules.
 */
async function reconcile(): Promise<void> {
  if (USE_MOCK_DATA) return
  const startedIn = generation
  const seq = ++readSeq
  const before = new Map(entries)
  let pinnedForAll: ReadonlySet<string>
  try {
    const items = await resolvePinnedFeed()
    pinnedForAll = new Set(
      items.filter(item => item.reason === 'exercise').map(item => item.post.id),
    )
  } catch (error) {
    if (startedIn !== generation || seq !== readSeq) return
    // Keep the last-known state: it is the best this tab knows until the next push or gap.
    console.warn(
      '[pinned] recovery read after a hub gap failed; keeping the last-known exercise pins:',
      error instanceof Error ? error.message : String(error),
    )
    return
  }
  // A sign-out / sign-in or a newer recovery read overtook this one.
  if (startedIn !== generation || seq !== readSeq) return

  const known = new Set([...entries.keys(), ...listeners.keys(), ...pinnedForAll])
  const changed: string[] = []
  for (const postId of known) {
    const current = entries.get(postId)
    // A push that landed while the read was in flight is newer than the read: it stays.
    if (current !== before.get(postId)) continue
    const pinned = pinnedForAll.has(postId)
    if (current?.pinnedForAll === pinned) continue
    entries.set(postId, { pinnedForAll: pinned })
    changed.push(postId)
  }
  for (const postId of changed) notify(postId)
}

/** Attaches the one handler per existing source, plus the hub-gap listener (idempotent). */
function connect(): void {
  if (disconnect !== null) return
  const offPush =
    typeof realtimeFeed.subscribePinChanged === 'function'
      ? realtimeFeed.subscribePinChanged(({ postId, pinnedForAll }) => apply(postId, pinnedForAll))
      : () => {}
  const offMock = viewerEngagement.subscribe(event => {
    if (event.kind === 'exercise') apply(event.postId, event.active)
  })
  // A hub gap: keep the held state, and reconcile from the server once the hub is back.
  const offState = realtimeConnection.onStateChange((state, reason) => {
    if (state !== HubConnectionState.Connected) {
      // A deliberate stop is the session reset's own doing, not a missed-push window.
      if (reason !== 'stopped') gapOpen = true
      return
    }
    if (!gapOpen) return
    gapOpen = false
    void reconcile()
  })
  disconnect = () => {
    offPush()
    offMock()
    offState()
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

/**
 * Sign-out / sign-in: forgets every held push, wakes the affected cards (they show their read)
 * and makes any recovery read still in flight answer into nothing.
 */
function reset(): void {
  generation += 1
  gapOpen = false
  dropHeld()
}

/** Test-only: forgets everything and detaches from the sources (the next subscribe re-attaches). */
function resetForTests(): void {
  generation += 1
  readSeq += 1
  gapOpen = false
  entries.clear()
  listeners.clear()
  disconnect?.()
  disconnect = null
}

/** The module-singleton store. See the module header for the contract. */
export const exercisePinState = { get, subscribe, reset, resetForTests }

registerSessionReset(() => exercisePinState.reset(), import.meta.hot)
// A hot-replaced module must not leave its handlers on the shared sources (Gate-1 L-5).
import.meta.hot?.dispose(() => disconnect?.())

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
