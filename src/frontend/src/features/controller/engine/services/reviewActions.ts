/**
 * features/controller/engine/services/reviewActions.ts
 * ---------------------------------------------------------------------------
 * The review-queue ACTIONS — approve / edit / veto / re-roll / batch-approve
 * (feature: engine-review-cockpit, story 01; ADP-040, ADP-041, COR-018, NFR-004,
 * XC-002/XC-004, SOC-003). STAFF world — pure-ish service module, no UI, no
 * COBRA.
 *
 * PUBLISH PATH (the only one). An approved or edited draft publishes through the
 * SHIPPED `createPost` (`@/features/social`) — the exact E2 pipeline any post
 * uses — with `origin: 'engine'` and `actingHumanId` = the APPROVING controller
 * (COR-018 attribution on an engine-originated post). Each `GeneratedPost` in the
 * burst is published, then pushed to the live feed via `postStore.appendPost`.
 * This module NEITHER re-implements sanitization (NFR-004) NOR the post telemetry
 * (XC-004) — `createPost` owns both; the edit path routes its new text through
 * `createPost`, which sanitizes it. Do not fork `createPost`.
 *
 * ORIGIN RECONCILIATION (do not deviate). `PostOrigin` is
 * `participant | controller-as-persona | engine | inject` — there is NO
 * `engine-edited`. BOTH approve AND edit publish with `origin: 'engine'`; the
 * approve-vs-edit distinction lives in TELEMETRY only (`engine.reviewed` with
 * `action: 'edit'` vs `'approve'`). The shared `Post`/`PostOrigin` model is not
 * modified.
 *
 * TELEMETRY (ADP-041/§11, XC-004). Every action emits ONE `engine.reviewed` event
 * (`action: approve | edit | veto | re-roll`) via the caller-safe `buildAndEmit`:
 * `channel: 'system'`, `actor { kind: 'engine', actingHumanId }`, `origin:
 * 'engine'`, carrying the storyline + trigger + scenario time (XC-004). This is
 * SEPARATE from — and additional to — the `'post'` event `createPost` emits per
 * published post; it is emitted once per review DECISION, not per post.
 *
 * PURE-ISH / TESTABLE (mirrors the `composeService` / `useComposeAsPersona`
 * split). These functions take the clock/identity/exercise as an INPUT
 * ({@link ReviewActionContext}) — they read no React context and no clock
 * themselves — so they unit-test without React. `wallClockNowIso()` is read only
 * to stamp the telemetry envelope's `wallClockTime` (staff/telemetry-only,
 * never participant-visible), exactly as `createPost` does internally.
 *
 * ISOLATION (COR-001). `exerciseId`/`timeZone` STAMP the post/telemetry only —
 * never a fetch-scoping param. Staff-only; provenance never reaches a participant
 * surface (XC-002/SOC-003).
 */

import { buildAndEmit } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import { personaIdForHandle } from '@/features/personas'
import { createPost, type Post } from '@/features/social'
import { postStore } from '@/features/social/services/postStore'
import {
  AutonomyLevel,
  DelayedAutoCountdown,
  DraftDisposition,
  scenarioMinuteOf,
  type EngineReviewItem,
  type GeneratedPost,
} from '../models/reviewContracts'
import { reviewStore } from './reviewStore'

/**
 * The clock/identity/exercise inputs a review action needs — assembled by the
 * caller (`useReviewQueue`) from `useControllerIdentity()` + `useExerciseContext()`
 * + `scenarioNow()`, exactly as `useComposeAsPersona` assembles them for
 * `composeAsPersona`. Passed in (never read here) so the actions stay pure-ish.
 */
export interface ReviewActionContext {
  /** Stamping only (COR-001) — from `useExerciseContext()`. */
  readonly exerciseId: string
  /** Stamping only (COR-001) — from `useExerciseContext()`. */
  readonly timeZone: string
  /** Scenario ISO instant (COR-053) — `scenarioNow().toISOString()`. */
  readonly scenarioTime: string
  /** The APPROVING controller behind the engine-originated post (COR-018). */
  readonly actingHumanId: string
}

/** The action a single `engine.reviewed` event records (ADP-041/§11). */
export type ReviewedAction = 'approve' | 'edit' | 'veto' | 're-roll'

/** Per-item outcome of a batch approve (reported back for the AC). */
export interface BatchApproveOutcome {
  readonly draftId: string
  /** `published` when the burst was published; `skipped` when already resolved. */
  readonly outcome: 'published' | 'skipped'
}

/**
 * Publishes every post in the burst through `createPost` (origin `engine`,
 * COR-018 acting-human), pushes each to the live feed, and marks the item
 * Published. `leadTextOverride`, when supplied (the edit path), replaces the lead
 * post's text — `createPost` sanitizes it (NFR-004). Returns the published posts.
 */
function publishBurst(
  item: EngineReviewItem,
  ctx: ReviewActionContext,
  leadTextOverride?: string,
): Post[] {
  const published: Post[] = []

  item.posts.forEach((draft, index) => {
    const text = index === 0 && leadTextOverride !== undefined ? leadTextOverride : draft.text
    const post = createPost({
      exerciseId: ctx.exerciseId,
      timeZone: ctx.timeZone,
      scenarioTime: ctx.scenarioTime,
      authorPersonaId: personaIdForHandle(draft.personaHandle),
      actingHumanId: ctx.actingHumanId,
      text,
      // Approved AND edited drafts publish as `engine`; the edit distinction is
      // telemetry-only (there is no `engine-edited` origin).
      origin: 'engine',
    })
    postStore.appendPost(post)
    published.push(post)
  })

  reviewStore.updateDisposition(item.draftId, DraftDisposition.Published)
  return published
}

/** Emits the single `engine.reviewed` telemetry event for an action (ADP-041). */
function emitReviewed(
  item: EngineReviewItem,
  ctx: ReviewActionContext,
  action: ReviewedAction,
): void {
  buildAndEmit({
    exerciseId: ctx.exerciseId,
    eventType: 'engine.reviewed',
    channel: 'system',
    actor: { kind: 'engine', actingHumanId: ctx.actingHumanId },
    origin: 'engine',
    wallClockTime: wallClockNowIso(),
    scenarioTime: ctx.scenarioTime,
    timeZone: ctx.timeZone,
    target: { entityType: 'engine-draft', entityId: item.draftId },
    payload: {
      action,
      storylineId: item.storylineId,
      storyline: item.storylineTag,
      // The trigger + storyline context every engine action is logged with
      // (ADP-041/XC-004); mocked from the item's brief in Phase 1.
      trigger: item.storylineBrief,
      postCount: item.postCount,
    },
  })
}

/**
 * Approves the burst: publishes it as its persona(s) via the E2 pipeline and logs
 * `engine.reviewed` (approve). Returns the published posts.
 */
export function approve(item: EngineReviewItem, ctx: ReviewActionContext): Post[] {
  const published = publishBurst(item, ctx)
  emitReviewed(item, ctx, 'approve')
  return published
}

/**
 * Publishes the burst with the lead post's text replaced by `newText` (routed
 * through `createPost`, which sanitizes it — NFR-004) and logs `engine.reviewed`
 * (edit). Same `origin: 'engine'` as approve; only the telemetry action differs.
 */
export function edit(item: EngineReviewItem, newText: string, ctx: ReviewActionContext): Post[] {
  const published = publishBurst(item, ctx, newText)
  emitReviewed(item, ctx, 'edit')
  return published
}

/**
 * Vetoes the burst: marks it Vetoed (never published) and logs `engine.reviewed`
 * (veto). No post reaches the feed.
 */
export function veto(item: EngineReviewItem, ctx: ReviewActionContext): void {
  reviewStore.updateDisposition(item.draftId, DraftDisposition.Vetoed)
  emitReviewed(item, ctx, 'veto')
}

/**
 * Re-rolls the burst: requests a fresh MOCK draft (Phase 1 stand-in for the E8
 * engine re-generating), resetting the item back to review — a fresh countdown +
 * CountingDown for a Delayed-auto burst, or Queued for a Suggest burst — and logs
 * `engine.reviewed` (re-roll). Nothing publishes.
 */
export function reroll(item: EngineReviewItem, ctx: ReviewActionContext): void {
  const posts = rerollPosts(item)
  const wasDelayedAuto = item.routedAtLevel === AutonomyLevel.DelayedAuto

  const nextCountdown = wasDelayedAuto
    ? new DelayedAutoCountdown({
      exerciseId: item.exerciseId,
      storylineId: item.storylineId,
      draftId: item.draftId,
      startedScenarioMinute: scenarioMinuteOf(Date.parse(ctx.scenarioTime)),
      countdownMinutes: item.countdown?.countdownMinutes ?? 3,
    })
    : null

  const nextDisposition = wasDelayedAuto ? DraftDisposition.CountingDown : DraftDisposition.Queued

  reviewStore.replaceItem(item.draftId, current =>
    current.withReroll(posts, nextCountdown, nextDisposition),
  )
  emitReviewed(item, ctx, 're-roll')
}

/**
 * Batch-approves several bursts, reporting a per-item outcome (the AC). Already
 * resolved items (Published/Vetoed) are skipped, not re-published.
 */
export function batchApprove(
  items: readonly EngineReviewItem[],
  ctx: ReviewActionContext,
): BatchApproveOutcome[] {
  return items.map(item => {
    const resolved =
      item.disposition === DraftDisposition.Published ||
      item.disposition === DraftDisposition.Vetoed
    if (resolved) {
      return { draftId: item.draftId, outcome: 'skipped' }
    }
    approve(item, ctx)
    return { draftId: item.draftId, outcome: 'published' }
  })
}

// ---------------------------------------------------------------------------
// Mock re-roll content (Phase 1 stand-in for the E8 engine re-generating)
// ---------------------------------------------------------------------------

/** Alternate persona-voiced takes the mock re-roll cycles to, keyed by handle. */
const REROLL_VARIANTS: Readonly<Record<string, string>> = {
  FulcoEM:
    '@mvega_fh Understood — here is where things stand: Zones 2-4 stay under a boil-water advisory ' +
    'out of caution while lab results finish. Use bottled or boiled water only. We will post results ' +
    'the minute they are confirmed. #WaterIssues',
  Newsline7:
    'DEVELOPING: Officials say the Fairhaven boil-water advisory holds for Zones 2-4 pending results; ' +
    'no shelters needed. We are confirming details before we report specifics — updates to come.',
  TheScoopHQ:
    'Fairhaven residents want straight answers on the water. Officials say testing is ongoing — we are ' +
    'watching for the results. #Fairhaven',
  mvega_fh:
    'trying to stay calm here — can someone official tell us plainly what to do about tap water right ' +
    'now? worried about my kids',
}

/**
 * Produces a fresh mock draft for a re-roll: each post's text is swapped for its
 * persona's alternate take (falling back to a clearly-marked re-roll of the
 * original when a handle has no canned variant), keeping the persona + hashtags.
 */
function rerollPosts(item: EngineReviewItem): GeneratedPost[] {
  return item.posts.map(draft => ({
    ...draft,
    text: REROLL_VARIANTS[draft.personaHandle] ?? `(re-rolled) ${draft.text}`,
  }))
}
