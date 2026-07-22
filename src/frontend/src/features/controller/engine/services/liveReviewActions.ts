/**
 * features/controller/engine/services/liveReviewActions.ts
 * ---------------------------------------------------------------------------
 * The LIVE review-queue ACTIONS (feature: engine-review-cockpit, story 02
 * mock→live flip; ADP-040, COR-001, COR-018). STAFF world — pure service
 * module, no UI, no COBRA. Used ONLY when `USE_MOCK_DATA` is false
 * (`@/core/config/mockData`); mirrors `reviewActions.ts`'s SIGNATURES so
 * `useReviewQueue` can pick either module behind the one flag with no change
 * to its own exposed shape.
 *
 * FIRE-AND-FORGET, OPTIMISTIC (the frozen `UseReviewQueueResult` contract is
 * SYNCHRONOUS — `approve`/`veto`/`edit`/`reroll` return `void`,
 * `batchApprove` returns `BatchApproveOutcome[]` synchronously — so these
 * functions must not `await`). Each POST is fired without awaiting (rejections
 * are swallowed here; the realtime `ReviewItemChanged` push — or the next
 * hub-reconnect resync in `liveReviewStore` — is the source of truth that
 * settles the real disposition). approve/edit/veto/batch-approve additionally
 * call `liveReviewStore.removeItemOptimistically` right away so the queue
 * updates immediately rather than waiting on the round trip; re-roll does NOT
 * optimistically mutate (the server generates the fresh draft text — there is
 * nothing correct to show locally until the push reconciles it).
 *
 * NO CLIENT `exerciseId` (COR-001) — every request carries only
 * `actingHumanId` + `timeZone`; scope is resolved server-side from the
 * session, mirroring the mock path's stamping-only contract.
 */

import { api } from '@/core/services/api'
import { DraftDisposition, type EngineReviewItem } from '../models/reviewContracts'
import type { BatchApproveOutcome, ReviewActionContext } from './reviewActions'
import { liveReviewStore } from './liveReviewStore'

/** The common action body every review endpoint accepts (COR-018; no client `exerciseId`). */
function actionBody(ctx: ReviewActionContext): { actingHumanId: string; timeZone: string } {
  return { actingHumanId: ctx.actingHumanId, timeZone: ctx.timeZone }
}

/** Fires a POST without awaiting it; the realtime push settles the real state. */
function fireAndForget(promise: Promise<unknown>): void {
  promise.catch(() => {
    // A failed fire-and-forget action leaves the optimistic local change to be
    // corrected by the next `ReviewItemChanged` push or hub-reconnect resync
    // (`liveReviewStore.refetch`) — never an unhandled rejection.
  })
}

/** `POST /api/engine/review/{draftId}/approve` — optimistically leaves the queue. */
export function approve(item: EngineReviewItem, ctx: ReviewActionContext): void {
  fireAndForget(api.post(`/engine/review/${item.draftId}/approve`, actionBody(ctx)))
  liveReviewStore.removeItemOptimistically(item.draftId)
}

/** `POST /api/engine/review/{draftId}/veto` — optimistically leaves the queue. */
export function veto(item: EngineReviewItem, ctx: ReviewActionContext): void {
  fireAndForget(api.post(`/engine/review/${item.draftId}/veto`, actionBody(ctx)))
  liveReviewStore.removeItemOptimistically(item.draftId)
}

/**
 * `POST /api/engine/review/{draftId}/edit` — same publish path as approve;
 * optimistically leaves the queue.
 */
export function edit(item: EngineReviewItem, newText: string, ctx: ReviewActionContext): void {
  fireAndForget(
    api.post(`/engine/review/${item.draftId}/edit`, { ...actionBody(ctx), text: newText }),
  )
  liveReviewStore.removeItemOptimistically(item.draftId)
}

/**
 * `POST /api/engine/review/{draftId}/re-roll` — no optimistic mutation; the
 * push carries the fresh draft.
 */
export function reroll(item: EngineReviewItem, ctx: ReviewActionContext): void {
  fireAndForget(api.post(`/engine/review/${item.draftId}/re-roll`, actionBody(ctx)))
}

/**
 * `POST /api/engine/review/batch-approve` — one request for every unresolved
 * draft. Reports the same per-item outcome shape the mock produces
 * (`published` vs `skipped`), computed synchronously (already-resolved items
 * are skipped, never re-sent).
 */
export function batchApprove(
  items: readonly EngineReviewItem[],
  ctx: ReviewActionContext,
): BatchApproveOutcome[] {
  const targets = items.filter(item =>
    item.disposition !== DraftDisposition.Published && item.disposition !== DraftDisposition.Vetoed,
  )
  const targetIds = new Set(targets.map(item => item.draftId))

  if (targets.length > 0) {
    fireAndForget(
      api.post('/engine/review/batch-approve', {
        ...actionBody(ctx),
        draftIds: targets.map(item => item.draftId),
      }),
    )
    for (const item of targets) liveReviewStore.removeItemOptimistically(item.draftId)
  }

  return items.map(item => ({
    draftId: item.draftId,
    outcome: targetIds.has(item.draftId) ? 'published' : 'skipped',
  }))
}
