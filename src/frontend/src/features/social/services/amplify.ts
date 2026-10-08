/**
 * features/social/services/amplify.ts
 * ---------------------------------------------------------------------------
 * The amplification write seam (feature: amplification, story 01 — "Repost &
 * quote-post"; SOC-020, with SOC-003 provenance + XC-004 telemetry, COR-001,
 * COR-053, NFR-004). Participant world (Pulse Social skin) — pure model/service
 * module, no UI, no COBRA.
 *
 * TWO WAYS CONTENT SPREADS (X/Twitter parity):
 *   - `repost(...)`    A lightweight amplification: the amplifier shares an
 *                      existing post to their own audience, attributed "X
 *                      reposted" in the feed. No new content — it points at an
 *                      existing post's id.
 *   - `quotePost(...)` A repost WITH added commentary that renders the original
 *                      as an embedded card. Quote-posting is how misinformation
 *                      MUTATES (the core E8 mechanic), so the commentary is
 *                      first-class free text and goes through the same
 *                      sanitizer as a normal post (NFR-004) before it is ever
 *                      stored/rendered.
 *
 * Each call:
 *   1. (quote only) SANITIZES the commentary via the shipped `sanitizeText`
 *      (NFR-004) — the SAME ingest sanitizer `createPost` uses, applied exactly
 *      once here at the amplification ingest boundary.
 *   2. Emits exactly one XC-004 telemetry event (`'repost'` / `'quote'`) via
 *      the caller-safe `buildAndEmit`, carrying provenance (`origin`, SOC-003),
 *      the acting human (COR-018), and a `target` pointing at the amplified
 *      post. It NEVER throws because of telemetry — a dead pipeline must never
 *      block an amplification (same guarantee `createPost` gives).
 *   3. Returns a PARTICIPANT-SAFE amplification record. Deliberately mirrors the
 *      `Post`/`ParticipantPostView` split (`types/post.ts`): the returned record
 *      carries NO provenance (`origin`/`actingHumanId`/wall-clock) — those exist
 *      only on the telemetry envelope, never on anything a participant surface
 *      can read (XC-002).
 *
 * TIME (COR-053): the caller supplies `scenarioTime` (from `scenarioNow()` /
 * the exercise clock) exactly as `createPost`'s callers do — this service stays
 * pure and never reads the clock itself. `wallClockTime` on the telemetry
 * envelope is stamped here via `wallClockNowIso()` (the sole sanctioned
 * wall-clock read; never participant-visible).
 *
 * ISOLATION (COR-001/XC-002): `exerciseId` is used ONLY to STAMP the record +
 * its telemetry envelope — never as a client query-scoping param (query
 * isolation stays server-side; WAVE0-REVIEW precedent 13).
 *
 * DEMO-POLISH F3 — WHAT CHANGED. The repost button is now a PERSISTED toggle
 * (`PUT`/`DELETE /api/posts/{id}/reactions/repost`, `reactionService.ts`) driven
 * by `useAmplify`. In LIVE mode the server emits the XC-004 `repost` event
 * (`payload { reposted }`, one per state change — implementation.md §1.8), so
 * the client emits nothing; in MOCK mode `useAmplify` calls
 * {@link emitRepostToggle} once per confirmed toggle, producing the same event
 * shape. Quote-posting is HIDDEN in the UI (the Quote trigger and panel are not
 * mounted, F3), but `quotePost()` and `useAmplify().doQuote` are kept intact for
 * the later quote story; the standalone `repost()` below likewise stays for its
 * own tests/back-compat and is no longer called by the UI.
 *
 * SCOPE (story 01): this module produces the amplification record + its
 * telemetry only. Wiring the record INTO the live feed (append to `postStore`)
 * and INTO the `<PostCard>` action row is the orchestrator's serial Wave-2
 * integration pass — see implementation.md's integration seam. Amplification
 * COUNTS (story 02) and CHAIN reconstruction (story 03) are out of scope; the
 * optional `causationId` below is a forward-compatible seam for story 03's
 * chain (post←repost←quote edges, SOC-022) and is not required here.
 */

import { buildAndEmit, generateEventId } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import { sanitizeText } from './sanitize'
import type { PostOrigin } from '../types/post'

/** Which amplification a record represents. */
export type AmplificationKind = 'repost' | 'quote'

/**
 * Fields shared by every `repost`/`quotePost` call. Provenance (`origin`,
 * `actingHumanId`) is telemetry-bound (SOC-003/COR-018) and never surfaces on
 * the returned record.
 */
interface AmplifyInputBase {
  readonly exerciseId: string
  readonly timeZone: string
  /** Scenario-time ISO instant of the amplification action (COR-053). */
  readonly scenarioTime: string
  /** The persona doing the amplifying (`persona-<handle>`). */
  readonly amplifierPersonaId: string
  /** The individual human behind the account (COR-018) — telemetry-only. */
  readonly actingHumanId: string
  /** The post being amplified. */
  readonly originalPostId: string
  /** Provenance of the amplification (SOC-003) — telemetry-only, never rendered. */
  readonly origin: PostOrigin
  /** Set when `origin === 'inject'` — the MSEL inject id. Telemetry-only. */
  readonly injectId?: string
  /**
   * `eventId` of the amplified post's telemetry event, for chain reconstruction
   * (SOC-022, story 03: post←repost←quote edges). Optional/forward-compatible —
   * story 01 does not require it.
   */
  readonly causationId?: string
}

/** Input to {@link repost}. */
export type RepostInput = AmplifyInputBase

/** Input to {@link quotePost}. `commentary` is sanitized on ingest (NFR-004). */
export interface QuotePostInput extends AmplifyInputBase {
  readonly commentary: string
  /**
   * Whether this call emits the XC-004 `'quote'` event. Default `true` (the direct,
   * mock-era behaviour). `useAmplify` passes `USE_MOCK_DATA`: in LIVE mode the server
   * owns amplification telemetry (implementation.md §1.8, as for `repost`), so a client
   * emit would double-count once the quote story wires the write.
   */
  readonly emitTelemetry?: boolean
}

/** Fields shared by every participant-safe amplification record. */
interface AmplificationRecordBase {
  readonly id: string
  readonly exerciseId: string
  readonly amplifierPersonaId: string
  readonly originalPostId: string
  /** Scenario-time ISO instant of the amplification (COR-053). */
  readonly scenarioTime: string
}

/** A plain repost — the amplifier shared the original to their audience. */
export interface RepostRecord extends AmplificationRecordBase {
  readonly kind: 'repost'
}

/** A quote-post — a repost with sanitized commentary that embeds the original. */
export interface QuotePostRecord extends AmplificationRecordBase {
  readonly kind: 'quote'
  /** The author's commentary, already sanitized (NFR-004). */
  readonly commentary: string
}

/**
 * Emits exactly one XC-004 amplification event. Never throws (caller-safe
 * `buildAndEmit`) — a dead telemetry pipeline must never block an
 * amplification. `actor.kind` is always `'persona'` (the amplification is
 * attributed to the persona account it was made AS); `origin` on the envelope
 * carries the provenance distinction, and `actingHumanId` satisfies the
 * schema's conditional 'controller-as-persona' attribution (COR-018).
 */
function emitAmplification(
  eventType: AmplificationKind,
  input: AmplifyInputBase,
  payload?: Record<string, unknown>,
): void {
  buildAndEmit({
    exerciseId: input.exerciseId,
    eventType,
    channel: 'social',
    actor: {
      kind: 'persona',
      personaId: input.amplifierPersonaId,
      actingHumanId: input.actingHumanId,
    },
    origin: input.origin,
    injectId: input.injectId,
    causationId: input.causationId,
    wallClockTime: wallClockNowIso(),
    scenarioTime: input.scenarioTime,
    timeZone: input.timeZone,
    target: { entityType: 'post', entityId: input.originalPostId },
    payload,
  })
}

/**
 * Reposts an existing post to the amplifier's audience (attributed "X
 * reposted"). Emits one XC-004 `'repost'` event (provenance included) and
 * returns a participant-safe record. Never throws because of telemetry.
 */
export function repost(input: RepostInput): RepostRecord {
  const id = `repost-${generateEventId()}`
  emitAmplification('repost', input)
  return {
    id,
    kind: 'repost',
    exerciseId: input.exerciseId,
    amplifierPersonaId: input.amplifierPersonaId,
    originalPostId: input.originalPostId,
    scenarioTime: input.scenarioTime,
  }
}

/** Input to {@link emitRepostToggle}: a repost context plus the toggle's RESULTING state. */
export interface RepostToggleInput extends AmplifyInputBase {
  /** The state AFTER the toggle — `true` = reposted, `false` = repost undone. */
  readonly reposted: boolean
}

/**
 * Emits the one XC-004 `'repost'` event for a CONFIRMED repost / undo, with the
 * server's own payload shape (`{ reposted: true|false }`, implementation.md
 * §1.8) so the mock-mode event is indistinguishable from the live server's.
 * MOCK MODE ONLY: the live server is authoritative and the caller (`useAmplify`)
 * must not call this when `USE_MOCK_DATA` is false. Never throws (caller-safe
 * `buildAndEmit`).
 */
export function emitRepostToggle(input: RepostToggleInput): void {
  emitAmplification('repost', input, { reposted: input.reposted })
}

/**
 * Quote-posts an existing post: sanitizes the commentary (NFR-004), emits one
 * XC-004 `'quote'` event (provenance included; unless `emitTelemetry` is `false`, the
 * live-mode case where the server owns it), and returns a participant-safe
 * record carrying the SANITIZED commentary + a reference to the embedded
 * original. Never throws because of telemetry.
 */
export function quotePost(input: QuotePostInput): QuotePostRecord {
  const commentary = sanitizeText(input.commentary)
  const id = `quote-${generateEventId()}`
  if (input.emitTelemetry !== false) emitAmplification('quote', input)
  return {
    id,
    kind: 'quote',
    exerciseId: input.exerciseId,
    amplifierPersonaId: input.amplifierPersonaId,
    originalPostId: input.originalPostId,
    commentary,
    scenarioTime: input.scenarioTime,
  }
}
