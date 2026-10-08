/**
 * features/social/hooks/useReaction.ts
 * ---------------------------------------------------------------------------
 * The like/unlike state machine behind a post's action-row like control
 * (feature: reactions, story 01 — "Like with count"; SOC-030, XC-004,
 * COR-001, D1-011; PERSISTED by demo-polish F3). Participant world (Pulse Social
 * skin) — pure hook + pure helper, no UI, no COBRA, no themed MUI.
 *
 * WHAT THIS OWNS
 *  - The VIEWER'S own like state for one post: `likedByViewer` (their toggle)
 *    and `likeCount` (the running total). Seeded once from the post's current
 *    count / `viewer.liked` (so a refresh keeps the heart on) and then owned
 *    locally — a feed re-render never clobbers an in-flight toggle.
 *  - `toggleLike()`, the single sanctioned like/unlike action. It is now a REAL
 *    write: flip + ±1 optimistically, `PUT`/`DELETE /api/posts/{id}/reactions/like`,
 *    reconcile to the response's `counts` + `viewer`, and ROLL BACK exactly on
 *    failure with a brief message (`errorMessage`, announced by `PostActions` in a
 *    polite live region). A second tap while a write is in flight is a no-op.
 *    All of that lives in `useReactionToggle`, shared with the repost control.
 *  - `canReact` / `isReadOnly`: the render gate the action row consumes so the
 *    like CONTROL is ABSENT (not disabled) in an observer/read-only session or a
 *    session with no bound persona (COR-015/D1-011) — the count still renders
 *    inert there, sourced from `likeCount`.
 *
 * TELEMETRY (XC-004). LIVE mode: NONE from the client — the server emits the
 * `reaction` event once per state change (implementation.md §1.8). MOCK mode
 * (`USE_MOCK_DATA`): exactly one `'reaction'` event per confirmed toggle, add AND
 * remove (E10's mood/sentiment metrics read both directions), via
 * {@link buildLikeTelemetryInput}. `buildAndEmit` is caller-safe: a dead telemetry
 * pipeline never blocks a like.
 *
 * TWO-WORLDS / ISOLATION
 *  - `exerciseId`/`timeZone` come from `useExerciseContext()` and are used ONLY to
 *    STAMP the mock-mode telemetry envelope — never as a fetch/scoping param, and
 *    never on the wire (COR-001/XC-002): the request carries no `exerciseId`, no
 *    `personaId`, no body.
 *  - The mock-mode telemetry actor is the viewer's persona (`kind: 'persona'`,
 *    `personaId` + `actingHumanId`), mirroring `createPost`: a like is a
 *    participant action performed AS their persona account (COR-018). A session
 *    with no bound persona has no identity to react as, so `canReact` is false
 *    and `toggleLike()` is a no-op.
 *
 * SCENARIO TIME (COR-053): the mock-mode telemetry `scenarioTime` is
 * `scenarioNow().toISOString()` from `@/core/clock`; `wallClockTime` is the real
 * instant from `@/core/time/wallClock` (telemetry-only, never rendered). In LIVE
 * mode the client stamps no reaction time at all — the server uses the exercise
 * clock. Bare `new Date()`/`Date.now()` are lint-banned on this participant path.
 *
 * The public shape (`likeCount`/`likedByViewer`/`toggleLike`/`canReact`/
 * `isReadOnly`) is unchanged from the local-only version; `pending` and
 * `errorMessage` are additive.
 */

import { useCallback } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'
import { useSession } from '@/core/auth'
import { scenarioNow } from '@/core/clock'
import { wallClockNowIso } from '@/core/time/wallClock'
import { buildAndEmit, type BuildTelemetryEventInput } from '@/core/telemetry'
import { useReactionToggle } from './useReactionToggle'
import type { UseTransientMessageResult } from './useTransientMessage'

/** Options for {@link useReaction}. */
export interface UseReactionOptions {
  /** The post the like control acts on (telemetry target + isolation scope). */
  readonly postId: string
  /** The post's current like count — seeds `likeCount` (owned locally after). */
  readonly initialLikeCount: number
  /** Whether the viewer has already liked this post — seeds `likedByViewer`. */
  readonly initiallyLiked?: boolean
  /** A shared failure-message channel (one live region per card); see `useReactionToggle`. */
  readonly notice?: UseTransientMessageResult
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
  /** True while the like write is in flight (a second tap is a no-op until it settles). */
  readonly pending: boolean
  /** The brief failure message to announce after a rolled-back write, or `null`. */
  readonly errorMessage: string | null
  /**
   * Toggles the viewer's like: optimistic flip + count, persisted through
   * `reactionService`, rolled back on failure. A no-op unless `canReact`, and a
   * no-op while `pending`.
   */
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

/** Shown (and announced) when a like / unlike write fails and is rolled back. */
const LIKE_FAILURE_MESSAGE = "Couldn't update your like. Please try again."

/**
 * The like control's state + action machine for one post. See the module
 * header for the full contract; a post's action-row like affordance is its
 * only intended consumer.
 */
export function useReaction(options: UseReactionOptions): UseReactionResult {
  const { postId, initialLikeCount, initiallyLiked = false, notice } = options
  const { exerciseId, timeZone } = useExerciseContext()
  const session = useSession()

  const isReadOnly = session.isReadOnly
  const canReact = !isReadOnly && session.personaId !== undefined

  // MOCK mode only (the toggle engine never calls this live): the one XC-004
  // event per confirmed state change. Narrows `personaId` to a string (no
  // non-null assertion) and reads the scenario clock AT EMIT time.
  const emitMockTelemetry = useCallback(
    (liked: boolean) => {
      const personaId = session.personaId
      if (personaId === undefined) return
      buildAndEmit(
        buildLikeTelemetryInput({
          exerciseId,
          timeZone,
          scenarioTime: scenarioNow().toISOString(),
          wallClockTime: wallClockNowIso(),
          personaId,
          actingHumanId: session.actingHumanId,
          postId,
          liked,
        }),
      )
    },
    [exerciseId, timeZone, session.personaId, session.actingHumanId, postId],
  )

  const toggle = useReactionToggle({
    postId,
    kind: 'like',
    initialCount: initialLikeCount,
    initiallyActive: initiallyLiked,
    canAct: canReact,
    failureMessage: LIKE_FAILURE_MESSAGE,
    notice,
    emitMockTelemetry,
  })

  return {
    likeCount: toggle.count,
    likedByViewer: toggle.active,
    canReact,
    isReadOnly,
    pending: toggle.pending,
    errorMessage: toggle.errorMessage,
    toggleLike: toggle.toggle,
  }
}
