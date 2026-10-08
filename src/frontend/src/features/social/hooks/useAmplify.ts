/**
 * features/social/hooks/useAmplify.ts
 * ---------------------------------------------------------------------------
 * The repost (and, parked, quote) ACTION seam for one post (feature:
 * amplification, story 01 "Repost & quote-post"; SOC-020, SOC-021, SOC-003,
 * COR-001, COR-053, XC-004; the repost TOGGLE is PERSISTED by demo-polish F3).
 * Participant world (Pulse Social skin) — pure hook, no UI, no COBRA.
 *
 * WHAT THIS OWNS
 *  - `repostedByViewer` / `repostCount`: the viewer's own repost state and the
 *    running total, seeded once from the post (`viewer.reposted`, `counts.repost`)
 *    and owned locally after — exactly the like control's contract.
 *  - `toggleRepost()`: repost / undo as a REAL write — optimistic flip + ±1,
 *    `PUT`/`DELETE /api/posts/{id}/reactions/repost`, reconciled to the response's
 *    `counts` + `viewer`, rolled back exactly on failure with a brief message
 *    (`errorMessage`, announced by `PostActions` in a polite live region), and a
 *    no-op while a write is in flight. The machine is `useReactionToggle`, shared
 *    with `useReaction`.
 *  - `canAmplify`: the render gate the action row consumes so the repost control
 *    is wired (and PRESENT) only when the session can actually act — no bound
 *    persona, or a read-only/observer session, => false (D1-011, COR-015).
 *    `PostCard`'s own `variant === 'readOnly'` is the primary "controls absent"
 *    guarantee; this is belt-and-braces so a toggle can never fire.
 *  - `doQuote(commentary)`: the quote action, currently UNMOUNTED —
 *    the Quote trigger and panel are hidden (absent, not disabled; D1-011) for the
 *    demo. It is kept, with `amplify.quotePost`, for the later quote story.
 *
 * TELEMETRY (XC-004). LIVE mode: NONE from the client — the server emits the
 * `repost` event (`payload { reposted }`) once per state change (implementation.md
 * §1.8). MOCK mode: exactly one `repost` event per confirmed toggle, undo
 * included, via `amplify.emitRepostToggle` (same payload shape as the server's).
 * The old fire-and-forget `amplify.repost()` is no longer called from here.
 *
 * TWO-WORLDS / ISOLATION: identical guarantees to `useReaction.ts` — `exerciseId`/
 * `timeZone` are stamp-only (mock telemetry / quote record; never a client scoping
 * param and never on the wire, COR-001/XC-002), the actor is the viewer's own
 * persona (COR-018), and scenario time is stamped AT CALL TIME (COR-053).
 */

import { useCallback } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'
import { useSession } from '@/core/auth'
import { scenarioNow } from '@/core/clock'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { emitRepostToggle, quotePost, type QuotePostRecord } from '../services/amplify'
import { useReactionToggle } from './useReactionToggle'
import type { UseTransientMessageResult } from './useTransientMessage'

/** Options for {@link useAmplify}. */
export interface UseAmplifyOptions {
  /** The post repost/quote acts on (the amplification target). */
  readonly postId: string
  /** The post's current repost count — seeds `repostCount` (owned locally after). Default 0. */
  readonly initialRepostCount?: number
  /** Whether the viewer already reposted this post (`post.viewer.reposted`). Default false. */
  readonly initiallyReposted?: boolean
  /** A shared failure-message channel (one live region per card); see `useReactionToggle`. */
  readonly notice?: UseTransientMessageResult
}

/** The repost/quote surface an action row binds to. */
export interface UseAmplifyResult {
  /**
   * Whether the viewer can amplify at all — false in an observer/read-only
   * session or when the session has no persona to act as. Mirrors
   * `useReaction`'s `canReact` (D1-011: the action row renders NO
   * repost/quote control at all when this is false; this guard additionally
   * makes the action itself a no-op, belt-and-braces).
   */
  readonly canAmplify: boolean
  /** Whether the viewer has reposted this post (their own state). */
  readonly repostedByViewer: boolean
  /** The running repost total, updated optimistically then reconciled with the server. */
  readonly repostCount: number
  /** True while the repost write is in flight (a second tap is a no-op until it settles). */
  readonly pending: boolean
  /** The brief failure message to announce after a rolled-back write, or `null`. */
  readonly errorMessage: string | null
  /**
   * Reposts / undoes the repost as the viewer's persona: optimistic, persisted,
   * rolled back on failure. A no-op unless `canAmplify`, and a no-op while `pending`.
   */
  readonly toggleRepost: () => void
  /**
   * Quote-posts with `commentary` (sanitized by `amplify.quotePost` on
   * ingest, NFR-004). A no-op unless `canAmplify`.
   */
  readonly doQuote: (commentary: string) => QuotePostRecord | undefined
}

/** Shown (and announced) when a repost / undo write fails and is rolled back. */
const REPOST_FAILURE_MESSAGE = "Couldn't update your repost. Please try again."

/**
 * The repost/quote action machine for one post. See the module header for
 * the full contract; a post's action-row repost affordance is its only
 * intended consumer.
 */
export function useAmplify({
  postId,
  initialRepostCount = 0,
  initiallyReposted = false,
  notice,
}: UseAmplifyOptions): UseAmplifyResult {
  const { exerciseId, timeZone } = useExerciseContext()
  const session = useSession()

  const canAmplify = !session.isReadOnly && session.personaId !== undefined

  // MOCK mode only (the toggle engine never calls this live).
  const emitMockTelemetry = useCallback(
    (reposted: boolean) => {
      const personaId = session.personaId
      if (personaId === undefined) return
      emitRepostToggle({
        exerciseId,
        timeZone,
        scenarioTime: scenarioNow().toISOString(),
        amplifierPersonaId: personaId,
        actingHumanId: session.actingHumanId,
        originalPostId: postId,
        origin: 'participant',
        reposted,
      })
    },
    [exerciseId, timeZone, session.personaId, session.actingHumanId, postId],
  )

  const toggle = useReactionToggle({
    postId,
    kind: 'repost',
    initialCount: initialRepostCount,
    initiallyActive: initiallyReposted,
    canAct: canAmplify,
    failureMessage: REPOST_FAILURE_MESSAGE,
    notice,
    emitMockTelemetry,
  })

  const doQuote = useCallback((commentary: string): QuotePostRecord | undefined => {
    const personaId = session.personaId
    if (session.isReadOnly || personaId === undefined) return undefined
    return quotePost({
      exerciseId,
      timeZone,
      scenarioTime: scenarioNow().toISOString(),
      amplifierPersonaId: personaId,
      actingHumanId: session.actingHumanId,
      originalPostId: postId,
      origin: 'participant',
      commentary,
      // Live: the server emits `quote` (§1.8) -- a client emit would double-count.
      emitTelemetry: USE_MOCK_DATA,
    })
  }, [exerciseId, timeZone, session.personaId, session.actingHumanId, session.isReadOnly, postId])

  return {
    canAmplify,
    repostedByViewer: toggle.active,
    repostCount: toggle.count,
    pending: toggle.pending,
    errorMessage: toggle.errorMessage,
    toggleRepost: toggle.toggle,
    doQuote,
  }
}
