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
 * NO IDENTITY, NO TIME ON THE WIRE (COR-001/COR-053): the service sends neither
 * `exerciseId` nor `personaId` nor a timestamp — the server derives all three.
 */

import { useCallback, useRef, useState } from 'react'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import {
  deleteReaction,
  mockReactionSnapshot,
  putReaction,
  type ReactionKind,
} from '../services/reactionService'
import { useTransientMessage, type UseTransientMessageResult } from './useTransientMessage'

/** Options for {@link useReactionToggle}. */
export interface UseReactionToggleOptions {
  readonly postId: string
  readonly kind: ReactionKind
  /** The post's current count for this kind — seeds `count` (owned locally after). */
  readonly initialCount: number
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
  const { message, show, clear } = options.notice ?? ownNotice

  // Seed once. In mock mode the adapter's memory wins over the post's own flags
  // (the stand-in for the next fetch reporting the viewer's state).
  const [seed] = useState(() => {
    const remembered = USE_MOCK_DATA ? mockReactionSnapshot(postId, kind) : undefined
    return remembered ?? { active: initiallyActive, count: initialCount }
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

    const write = nextActive
      ? putReaction(postId, kind, previous)
      : deleteReaction(postId, kind, previous)

    write
      .then(
        state => {
          // Reconcile onto the server's own answer (viewer flag + count).
          const confirmed = kind === 'like' ? state.viewer.liked : state.viewer.reposted
          commit({ active: confirmed, count: state.counts[kind] })
          // Mock only, and only for a real state change (the server's rule).
          if (USE_MOCK_DATA && confirmed !== previous.active) emitMockTelemetry(confirmed)
        },
        () => {
          // Roll back EXACTLY, and tell the viewer (polite live region).
          commit(previous)
          show(failureMessage)
        },
      )
      .finally(() => {
        inFlightRef.current = false
        setPending(false)
      })
  }, [canAct, commit, postId, kind, failureMessage, emitMockTelemetry, clear, show])

  return { active, count, pending, errorMessage: message, toggle }
}
