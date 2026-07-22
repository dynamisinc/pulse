/**
 * features/social/hooks/useReaction.ts
 * ---------------------------------------------------------------------------
 * The like/unlike state machine behind a post's action-row like control
 * (feature: reactions, story 01 — "Like with count"; SOC-030, XC-004,
 * COR-001, D1-011). Participant world (Pulse Social skin) — pure hook + pure
 * helper, no UI, no COBRA, no themed MUI.
 *
 * WHAT THIS OWNS
 *  - The VIEWER'S own like state for one post: `likedByViewer` (their toggle)
 *    and `likeCount` (the running total, updated optimistically as they
 *    like/unlike). Seeded once from the post's current count/own-state and
 *    then owned locally — a feed re-render never clobbers an in-flight toggle.
 *  - `toggleLike()`, the single sanctioned like/unlike action: it flips the
 *    viewer's state, adjusts the count by ±1, and emits exactly one XC-004
 *    `'reaction'` telemetry event capturing the resulting state (both the
 *    add AND the remove — E10's mood/sentiment metrics read the toggle in
 *    both directions). Never throws because of telemetry (`buildAndEmit` is
 *    caller-safe): a dead telemetry pipeline must never block a like.
 *  - `canReact` / `isReadOnly`: the render gate the action row consumes so the
 *    like CONTROL is ABSENT (not disabled) in an observer/read-only session
 *    (COR-015/D1-011) — the count still renders inert there, sourced from
 *    `likeCount`.
 *
 * TWO-WORLDS / ISOLATION
 *  - `exerciseId`/`timeZone` come from `useExerciseContext()` and are used ONLY
 *    to STAMP the telemetry envelope — never as a fetch/scoping param
 *    (COR-001/XC-002); like isolation is enforced server-side once a backend
 *    lands.
 *  - The actor is attributed as the viewer's persona (`kind: 'persona'`,
 *    `personaId` + `actingHumanId`), mirroring `createPost` exactly: a like is
 *    a participant action performed AS their persona account (COR-018). A
 *    session with no bound persona has no identity to react as, so `canReact`
 *    is false and `toggleLike()` is a no-op.
 *  - Observer/read-only (COR-015/D1-011): `isReadOnly` is surfaced so the
 *    action row renders NO like control (absent, not disabled). `toggleLike()`
 *    additionally hard-guards on it (belt-and-braces).
 *
 * SCENARIO TIME (COR-053): the telemetry `scenarioTime` is
 * `scenarioNow().toISOString()` from `@/core/clock`; `wallClockTime` is the
 * real instant from `@/core/time/wallClock` (telemetry-only, never rendered).
 * Bare `new Date()`/`Date.now()` are lint-banned on this participant path.
 *
 * BACKEND SEAM: there is no reaction persistence yet — a like is local
 * optimistic state + a telemetry event. When the backend lands, the write goes
 * through a `reactionService` (mirroring `postService.createPost`); this hook's
 * public shape (`likeCount`/`likedByViewer`/`toggleLike`) is designed to stay
 * unchanged when that seam slots in.
 *
 * WIRING NOTE: this hook is self-contained and buildable/testable in
 * isolation. Threading `likedByViewer`/`toggleLike` INTO `<PostCard>`'s action
 * row (and the `Feed`/`ThreadView` call sites) is an orchestrator-owned serial
 * pass — see `docs/features/reactions/implementation.md`'s integration seam.
 */

import { useCallback, useState } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'
import { useSession } from '@/core/auth'
import { scenarioNow } from '@/core/clock'
import { wallClockNowIso } from '@/core/time/wallClock'
import { buildAndEmit, type BuildTelemetryEventInput } from '@/core/telemetry'

/** Options for {@link useReaction}. */
export interface UseReactionOptions {
  /** The post the like control acts on (telemetry target + isolation scope). */
  readonly postId: string
  /** The post's current like count — seeds `likeCount` (owned locally after). */
  readonly initialLikeCount: number
  /** Whether the viewer has already liked this post — seeds `likedByViewer`. */
  readonly initiallyLiked?: boolean
}

/** The like surface the action row binds to. */
export interface UseReactionResult {
  /** The running like total, updated optimistically on each toggle. */
  readonly likeCount: number
  /** Whether the viewer has liked this post (their own state). */
  readonly likedByViewer: boolean
  /**
   * Whether the viewer can like at all — false in an observer session or when
   * the session has no persona to react as. The action row renders the like
   * CONTROL only when this is true (else the count is inert, D1-011).
   */
  readonly canReact: boolean
  /** Observer/read-only session (COR-015) — the like control must be ABSENT. */
  readonly isReadOnly: boolean
  /** Toggles the viewer's like, updates the count, and emits telemetry. A
   * no-op unless `canReact`. */
  readonly toggleLike: () => void
}

/** Inputs to {@link buildLikeTelemetryInput}. */
export interface LikeTelemetryParams {
  readonly exerciseId: string
  readonly timeZone: string
  readonly scenarioTime: string
  readonly wallClockTime: string
  readonly personaId: string
  readonly actingHumanId: string
  readonly postId: string
  /** The resulting state after the toggle — `true` = liked, `false` = unliked. */
  readonly liked: boolean
}

/**
 * Assembles the XC-004 `'reaction'` telemetry envelope input for a like/unlike.
 * Pure (no React, no clock/context reads) so it is unit-testable on its own and
 * the hook only supplies the sourced values. Actor is the viewer's persona
 * (`kind: 'persona'`), matching `createPost`'s attribution: a like is a
 * participant action performed AS their persona (COR-018). `payload.reaction`
 * is the fixed baseline `'like'` (story 02's sentiment set extends this vocab);
 * `payload.liked` distinguishes an add from a remove.
 */
export function buildLikeTelemetryInput(params: LikeTelemetryParams): BuildTelemetryEventInput {
  return {
    exerciseId: params.exerciseId,
    eventType: 'reaction',
    channel: 'social',
    actor: {
      kind: 'persona',
      personaId: params.personaId,
      actingHumanId: params.actingHumanId,
    },
    origin: 'participant',
    wallClockTime: params.wallClockTime,
    scenarioTime: params.scenarioTime,
    timeZone: params.timeZone,
    target: { entityType: 'post', entityId: params.postId },
    payload: { reaction: 'like', liked: params.liked },
  }
}

/**
 * The like control's state + action machine for one post. See the module
 * header for the full contract; a post's action-row like affordance is its
 * only intended consumer.
 */
export function useReaction(options: UseReactionOptions): UseReactionResult {
  const { postId, initialLikeCount, initiallyLiked = false } = options
  const { exerciseId, timeZone } = useExerciseContext()
  const session = useSession()

  const [likedByViewer, setLikedByViewer] = useState(initiallyLiked)
  const [likeCount, setLikeCount] = useState(initialLikeCount)

  const isReadOnly = session.isReadOnly
  const canReact = !isReadOnly && session.personaId !== undefined

  const toggleLike = useCallback(() => {
    // Re-derive the guard locally rather than trusting a stale closure, and
    // narrow `personaId` to a string (no non-null assertion).
    const personaId = session.personaId
    if (session.isReadOnly || personaId === undefined) return

    // Optimistic toggle: flip own state and adjust the count by ±1. Clamp at 0
    // defensively so a desynced initial count can never render negative.
    const nextLiked = !likedByViewer
    setLikedByViewer(nextLiked)
    setLikeCount(prev => (nextLiked ? prev + 1 : Math.max(0, prev - 1)))

    // Exactly one XC-004 event per toggle; caller-safe, so a telemetry failure
    // never blocks the like (COR-001: exerciseId stamps the envelope, it is not
    // a scoping param).
    buildAndEmit(
      buildLikeTelemetryInput({
        exerciseId,
        timeZone,
        scenarioTime: scenarioNow().toISOString(),
        wallClockTime: wallClockNowIso(),
        personaId,
        actingHumanId: session.actingHumanId,
        postId,
        liked: nextLiked,
      }),
    )
  }, [
    exerciseId,
    timeZone,
    session.personaId,
    session.actingHumanId,
    session.isReadOnly,
    postId,
    likedByViewer,
  ])

  return {
    likeCount,
    likedByViewer,
    canReact,
    isReadOnly,
    toggleLike,
  }
}
