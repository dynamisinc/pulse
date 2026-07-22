/**
 * features/social/hooks/useAmplify.ts
 * ---------------------------------------------------------------------------
 * The repost/quote ACTION seam for one post (Wave-S3.1 orchestrator
 * integration — feature: amplification, story 01 "Repost & quote-post";
 * SOC-020, SOC-003, COR-001, COR-053, XC-004). Participant world (Pulse Social
 * skin) — pure hook, no UI, no COBRA.
 *
 * WHY THIS EXISTS. `services/amplify.ts`'s `repost()`/`quotePost()` are pure,
 * caller-supplied-context functions (they take `exerciseId`/`timeZone`/
 * `scenarioTime`/`amplifierPersonaId`/`actingHumanId` as plain arguments,
 * deliberately staying context/clock-free so they unit-test in isolation).
 * Wiring them into a LIVE post action row means every call site needs the
 * SAME context reads + the SAME "can this session actually act?" guard — the
 * repost/quote analog of `useReaction`'s `canReact`/`toggleLike` shape. This
 * hook is that seam, so `Feed.tsx` (`FeedRow`) and `ThreadView.tsx` (all 3
 * `<PostCard>` call sites) source ONE definition of "who can amplify, and
 * what does amplifying actually call" rather than re-deriving it per call
 * site — mirrors `useReaction.ts`'s own module-header rationale.
 *
 * WHAT THIS OWNS
 *  - `canAmplify`: the render gate the action row consumes so repost/quote
 *    are wired only when the session can actually act — mirrors
 *    `useReaction`'s `canReact` (no bound persona, or a read-only/observer
 *    session, ⇒ false). PostCard's own `variant === 'readOnly'` branch is the
 *    primary "controls absent" guarantee (D1-011); this is belt-and-braces so
 *    `doRepost`/`doQuote` can never fire even if a caller mis-wires them.
 *  - `doRepost()` / `doQuote(commentary)`: the sanctioned actions. Each reads
 *    `exerciseId`/`timeZone` from `useExerciseContext()`, the acting
 *    persona/human from `useSession()`, and stamps the scenario instant via
 *    `scenarioNow().toISOString()` AT CALL TIME (never memoized early) before
 *    calling straight through to `amplify.ts`'s `repost()`/`quotePost()` —
 *    which is where the telemetry emission (XC-004), provenance stamping
 *    (SOC-003), and — for a quote — the NFR-004 sanitize all actually happen.
 *    This hook adds no business logic of its own; it only supplies context.
 *
 * SCOPE (story 01 + this integration pass): reposting/quoting here does NOT
 * mutate `post.counts.repost` (amplification COUNTS are story 02, explicitly
 * out of scope) and does NOT insert a new row into the live feed/thread
 * (mirrors `Composer`'s own `onPosted` scope note — the current viewer's own
 * amplification isn't authored by a feed-resolvable persona in the Wave-1
 * mock cast). The action is still fully real: it emits the XC-004 event and
 * returns a participant-safe amplification record — this hook simply doesn't
 * do anything further with that record (a caller that wants to show a
 * confirmation may use the return value).
 *
 * TWO-WORLDS / ISOLATION: identical guarantees to `useReaction.ts` — exactly
 * ONE amplification action per call, exerciseId/timeZone are stamp-only
 * (never a client scoping param, COR-001/XC-002), and the actor is always the
 * viewer's own persona (COR-018).
 */

import { useCallback } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'
import { useSession } from '@/core/auth'
import { scenarioNow } from '@/core/clock'
import { repost, quotePost, type RepostRecord, type QuotePostRecord } from '../services/amplify'

/** Options for {@link useAmplify}. */
export interface UseAmplifyOptions {
  /** The post repost/quote acts on (the amplification target). */
  readonly postId: string
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
  /** Reposts the post as the viewer's persona. A no-op unless `canAmplify`. */
  readonly doRepost: () => RepostRecord | undefined
  /**
   * Quote-posts with `commentary` (sanitized by `amplify.quotePost` on
   * ingest, NFR-004). A no-op unless `canAmplify`.
   */
  readonly doQuote: (commentary: string) => QuotePostRecord | undefined
}

/**
 * The repost/quote action machine for one post. See the module header for
 * the full contract; a post's action-row repost/quote affordances are its
 * only intended consumer.
 */
export function useAmplify({ postId }: UseAmplifyOptions): UseAmplifyResult {
  const { exerciseId, timeZone } = useExerciseContext()
  const session = useSession()

  const canAmplify = !session.isReadOnly && session.personaId !== undefined

  const doRepost = useCallback((): RepostRecord | undefined => {
    const personaId = session.personaId
    if (session.isReadOnly || personaId === undefined) return undefined
    return repost({
      exerciseId,
      timeZone,
      scenarioTime: scenarioNow().toISOString(),
      amplifierPersonaId: personaId,
      actingHumanId: session.actingHumanId,
      originalPostId: postId,
      origin: 'participant',
    })
  }, [exerciseId, timeZone, session.personaId, session.actingHumanId, session.isReadOnly, postId])

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
    })
  }, [exerciseId, timeZone, session.personaId, session.actingHumanId, session.isReadOnly, postId])

  return { canAmplify, doRepost, doQuote }
}
