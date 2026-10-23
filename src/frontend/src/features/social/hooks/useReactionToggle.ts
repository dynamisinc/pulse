/**
 * features/social/hooks/useReactionToggle.ts
 * ---------------------------------------------------------------------------
 * The ONE persisted-toggle state machine behind the like AND the repost control
 * (demo-polish F3 "Engagement — persisted likes and reposts"; SOC-030,
 * SOC-020/021, NFR-001, COR-001, COR-015). `useReaction` (like) and `useAmplify`
 * (repost) are thin, shape-preserving wrappers over it, so the two controls can
 * never drift apart on the rules below. Participant world — pure hook, no UI.
 *
 * WHAT IT OWNS, for one post + one kind:
 *  - `active` / `count`: the viewer's own state and the running total, seeded ONCE
 *    from the post (`initiallyActive` comes from `post.viewer`, so after a page
 *    refresh the heart / repost are still on — the server returned them) and
 *    owned locally after, so a feed re-render never clobbers an in-flight toggle.
 *  - `toggle()`: flip + ±1 OPTIMISTICALLY, then `PUT` (turning on) or `DELETE`
 *    (turning off) through `reactionService`. On RESOLVE it reconciles to the
 *    server's authoritative `viewer` flag and `counts[kind]` — never trusting its
 *    own guess, so a count another participant moved meanwhile lands correctly.
 *    On REJECT it rolls BOTH back to the exact pre-toggle values and shows a brief
 *    failure message (rendered into a polite live region by `PostActions`).
 *  - The IN-FLIGHT GUARD: while a write is pending a second `toggle()` is a no-op.
 *    It is a REF, not state, so two taps inside one tick (before React re-renders)
 *    still cannot double-count or race each other's rollback. The state `toggle`
 *    acts on is a ref too (mirrored on every set), so a tap in the gap between the
 *    guard releasing and React committing the reconciled values still sees the
 *    SERVER's numbers, and a rollback there restores them.
 *  - `canAct`: the render gate. The wrapper computes it (not read-only AND a bound
 *    persona); when false `toggle()` is a no-op and the control is ABSENT in the
 *    card (D1-011), with the count rendered as inert text.
 *
 * TELEMETRY (XC-004, implementation.md §1.8). In LIVE mode the server emits the
 * `reaction` / `repost` event once per state change, so this hook emits NOTHING —
 * a client emit would double-count. In MOCK mode (`USE_MOCK_DATA`) there is no
 * server, so the wrapper's `emitMockTelemetry` runs EXACTLY ONCE per toggle that
 * actually changed state, after the write is confirmed (a failed write that rolled
 * back never happened, so it emits nothing; an idempotent repeat emits nothing —
 * the same rule the server applies).
 *
 * MOCK PARITY. In mock mode the initial state is overlaid with what the mock
 * adapter remembers (`mockReactionSnapshot`), so a card that re-mounts later in the
 * same page session agrees with an earlier toggle. Off under Vitest by default.
 *
 * LIVE COUNTS (demo-feedback story 14, DF-17 / DF-18). `externalCount` is the kind's number from
 * the card's live counts (`usePostCounts`: the post's own count, or a newer `PostEngagementChanged`
 * frame). When it CHANGES, the hook adopts it as `count` and leaves `active` exactly as it is: a
 * push is one payload for the whole exercise and never says whether *I* liked or reposted. While a
 * write is IN FLIGHT a changed external count is not applied - the frame may predate this toggle,
 * and the write's own answer reconciles the number a moment later - so an optimistic toggle is
 * never overwritten by an older frame. In MOCK mode a confirmed change also tells the mock
 * engagement source (`emitMockReactionEngagement`), which stands in for the server's push.
 *
 * MY OWN REACTION NEVER NOTIFIES ME (Gate-1 M-2). Turning a like / repost ON tells the
 * notifications store first (`noteOwnReaction`), so if the post is the viewer's own, the rise their
 * write causes is absorbed silently; a write that fails, does not turn it on, or answers a count
 * no higher than the card held before the tap (a server no-op, e.g. after a stale cached read)
 * withdraws that (N-1; the store also expires an unmatched note).
 *
 * NO IDENTITY, NO TIME ON THE WIRE (COR-001/COR-053): the service sends neither
 * `exerciseId` nor `personaId` nor a timestamp — the server derives all three.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import {
  deleteReaction,
  mockReactionSnapshot,
  putReaction,
  type ReactionKind,
} from '../services/reactionService'
import { emitMockReactionEngagement } from '../services/mockEngagementChanges'
import { postCountsStore } from '../services/postCountsStore'
import { notificationsStore } from '../notifications/notificationsStore'
import { useTransientMessage, type UseTransientMessageResult } from './useTransientMessage'
import {
  EXERCISE_ENDED_WRITE_MESSAGE,
  isEndedRefusal,
  useExerciseEndedFlag,
} from '@/features/participant-shell/writeGate'

/** Options for {@link useReactionToggle}. */
export interface UseReactionToggleOptions {
  readonly postId: string
  readonly kind: ReactionKind
  /** The post's current count for this kind — seeds `count` (owned locally after). */
  readonly initialCount: number
  /**
   * The kind's LIVE count from the card (`usePostCounts`). A change replaces `count` - never
   * `active` - unless a write is in flight (see the module header). Omit it for seed-only
   * behaviour.
   */
  readonly externalCount?: number
  /** Whether the viewer already reacted (from `post.viewer`) — seeds `active`. */
  readonly initiallyActive: boolean
  /** Whether the session may react at all (writable AND a bound persona). */
  readonly canAct: boolean
  /** The brief inline message shown when the write fails (it is rolled back). */
  readonly failureMessage: string
  /**
   * An externally owned message channel. `PostActions` shares ONE between the
   * like and the repost toggles so the card has a single live region and the most
   * recent failure always wins (two private channels would let a stale like error
   * mask a newer repost error). Omit it and the toggle owns its own.
   */
  readonly notice?: UseTransientMessageResult
  /**
   * Runs once per CONFIRMED state change, in MOCK mode only (see the module
   * header). `active` is the resulting state. Never called in live mode.
   */
  readonly emitMockTelemetry: (active: boolean) => void
}

/** What a wrapper hook binds the card to. */
export interface UseReactionToggleResult {
  /** Whether the viewer's reaction of this kind is on. */
  readonly active: boolean
  /** The running total, updated optimistically then reconciled with the server. */
  readonly count: number
  /** True while a write is in flight (a second toggle is a no-op until it settles). */
  readonly pending: boolean
  /** The brief failure message to announce, or `null`. */
  readonly errorMessage: string | null
  /** Flips the reaction. A no-op unless `canAct`, and a no-op while `pending`. */
  readonly toggle: () => void
}

export function useReactionToggle(options: UseReactionToggleOptions): UseReactionToggleResult {
  const { postId, kind, initialCount, initiallyActive, canAct, failureMessage, emitMockTelemetry } =
    options
  const ownNotice = useTransientMessage()
  // A 403 while ended means "the exercise has ended", not a flaky write (read at failure time).
  const ended = useExerciseEndedFlag()
  const endedRef = useRef(ended)
  useEffect(() => {
    endedRef.current = ended
  }, [ended])
  const { message, show, clear } = options.notice ?? ownNotice

  // Seed once. In mock mode the adapter's memory wins over the post's own flags
  // (the stand-in for the next fetch reporting the viewer's state).
  const [seed] = useState(() => {
    const remembered = USE_MOCK_DATA ? mockReactionSnapshot(postId, kind) : undefined
    // Gate-1 H-1: the count seeds from the card's LIVE count (a frame held before this card mounted
    // included), not the read's own number - `lastExternalRef` starts at the same value, so a
    // seed from the stale read would never be corrected.
    return remembered ?? { active: initiallyActive, count: options.externalCount ?? initialCount }
  })
  const [active, setActive] = useState(seed.active)
  const [count, setCount] = useState(seed.count)
  const [pending, setPending] = useState(false)

  // The LATEST state, mirrored in a ref and updated in the same call as every
  // `setActive` / `setCount` (see `commit`). `toggle` reads it instead of its
  // render-captured `active` / `count`: the guard below is released in `.finally`,
  // BEFORE React has committed the reconciled values, so a tap in that gap would
  // otherwise act on the stale optimistic values — and a failed write there would
  // "roll back" onto them, not onto what the server last said.
  const stateRef = useRef({ active: seed.active, count: seed.count })
  const commit = useCallback((next: { active: boolean; count: number }) => {
    stateRef.current = next
    setActive(next.active)
    setCount(next.count)
  }, [])

  // A ref (not state): two taps in one tick must not both pass the guard.
  const inFlightRef = useRef(false)

  // DF-17: a pushed count moves the NUMBER only. The last external value seen is a ref so the
  // mount-time value (equal to the seed, or older than a mock memory) is never re-applied.
  const { externalCount } = options
  const lastExternalRef = useRef(externalCount)
  useEffect(() => {
    if (externalCount === undefined || externalCount === lastExternalRef.current) return
    lastExternalRef.current = externalCount
    // In flight: the optimistic value stands; the write's own answer reconciles the count.
    if (inFlightRef.current) return
    commit({ active: stateRef.current.active, count: externalCount })
  }, [externalCount, commit])

  const toggle = useCallback(() => {
    if (!canAct || inFlightRef.current) return
    inFlightRef.current = true

    const previous = stateRef.current
    const nextActive = !previous.active

    // Clamp at 0 defensively so a desynced seed can never render a negative count.
    commit({
      active: nextActive,
      count: nextActive ? previous.count + 1 : Math.max(0, previous.count - 1),
    })
    setPending(true)
    clear()

    // A sign-out / sign-in while the write is out resets the live counts store; the late answer
    // then belongs to the previous identity and must not push numbers into the next one's store.
    const generation = postCountsStore.generation()
    if (nextActive) notificationsStore.noteOwnReaction(postId, kind)
    const write = nextActive
      ? putReaction(postId, kind, previous)
      : deleteReaction(postId, kind, previous)

    write
      .then(
        state => {
          // Reconcile onto the server's own answer (viewer flag + count).
          const confirmed = kind === 'like' ? state.viewer.liked : state.viewer.reposted
          commit({ active: confirmed, count: state.counts[kind] })
          // N-1: no rise of mine is coming (not turned on, or a server no-op): release the note.
          if (nextActive && (!confirmed || state.counts[kind] <= previous.count)) {
            notificationsStore.cancelOwnReaction(postId, kind)
          }
          // Mock only, and only for a real state change (the server's rule).
          if (USE_MOCK_DATA && confirmed !== previous.active) {
            emitMockTelemetry(confirmed)
            // The mock stand-in for the server's PostEngagementChanged push (DF-17).
            emitMockReactionEngagement(postId, kind, state.counts[kind], generation)
          }
        },
        (failure: unknown) => {
          // Roll back EXACTLY, and tell the viewer (polite live region).
          commit(previous)
          if (nextActive) notificationsStore.cancelOwnReaction(postId, kind)
          show(
            isEndedRefusal(failure, endedRef.current)
              ? EXERCISE_ENDED_WRITE_MESSAGE
              : failureMessage,
          )
        },
      )
      .finally(() => {
        inFlightRef.current = false
        setPending(false)
      })
  }, [canAct, commit, postId, kind, failureMessage, emitMockTelemetry, clear, show])

  return { active, count, pending, errorMessage: message, toggle }
}
