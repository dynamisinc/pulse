/**
 * features/social/services/livePostActions.ts
 * ---------------------------------------------------------------------------
 * The LIVE post-publish action (feature: posts / persona-operation; SOC-001,
 * CTL-001, COR-001, COR-018, COR-053). Pure service module — no UI, no COBRA.
 * Used ONLY when `USE_MOCK_DATA` is false (`@/core/config/mockData`); mirrors
 * `features/controller/engine/services/liveReviewActions.ts`'s fire-and-forget
 * conventions for the social publish path.
 *
 * `POST /api/posts` (backend-frozen `CreatePostRequest`): the wire body is
 * `CreatePostInput` narrowed to exactly `{ authorPersonaId, actingHumanId,
 * text, scenarioTime, timeZone, origin, injectId?, media? }` — NO client
 * `exerciseId` (COR-001; the server stamps scope from the session, so the
 * field is dropped here rather than merely left undefined). The response is
 * 201 with a `ParticipantPostDto` (`origin: 'participant'`) or a
 * `StaffPostDto` (every other origin); NEITHER is read here. The publish path
 * is fire-and-forget by design (see below) — the post reaches every
 * participant, including the author, via the backend's `PostReceived`
 * SignalR broadcast and the "▲ N new posts" pill (`useFeedStream` /
 * `services/feedStreamSource`), never a client-side optimistic insert (an
 * optimistic prepend would also be dropped by the feed's persona-cast
 * resolution running ahead of the round trip).
 *
 * ROLE BY ORIGIN (the two callers of this seam):
 *   - `origin: 'participant'` — the participant composer
 *     (`hooks/useComposePost.publish`) posting as the session's own bound
 *     persona.
 *   - `origin: 'controller-as-persona'` — the Controller Console posting AS an
 *     operated persona (`features/controller/hooks/useComposeAsPersona`, the
 *     call site alongside `composeService.composeAsPersona` — which stays a
 *     PURE, network-free function; this is where the live persist is fired).
 *   Every other `PostOrigin` (`'engine'`, `'inject'`) is produced server-side
 *   or via the review-queue actions (`liveReviewActions.ts`), never through
 *   this seam.
 *
 * FIRE-AND-FORGET (mirrors `liveReviewActions.ts`): `publishPost` returns the
 * request's `Promise<void>` — it does NOT swallow a rejection itself. Every
 * caller in this codebase attaches its own `.catch(() => {})` at the call
 * site (never an unhandled rejection, the known CI-teardown-race hazard) and
 * proceeds optimistically (clearing the draft) without awaiting the round
 * trip. No frontend telemetry is emitted here: the backend emits the
 * authoritative XC-004 `'post'` event once the request lands, so a
 * network-only POST from the participant path never double-counts.
 *
 * NO CLIENT `exerciseId` (COR-001) — the wire body never carries one; scope
 * is resolved server-side from the session.
 */

import { api } from '@/core/services/api'
import type { CreatePostInput } from './postService'

/**
 * The wire body `POST /api/posts` accepts — an explicit field-by-field pick
 * off `CreatePostInput` (never a spread), so a future field added to the
 * frontend model (e.g. `linkPreview`/`counts`, which are NOT part of the
 * frozen `CreatePostRequest` contract) can't silently ride onto the wire.
 */
type CreatePostRequestBody = Pick<
  CreatePostInput,
  'authorPersonaId' | 'actingHumanId' | 'text' | 'scenarioTime' | 'timeZone' | 'origin' | 'injectId' | 'media'
>

function toRequestBody(input: CreatePostInput): CreatePostRequestBody {
  return {
    authorPersonaId: input.authorPersonaId,
    actingHumanId: input.actingHumanId,
    text: input.text,
    scenarioTime: input.scenarioTime,
    timeZone: input.timeZone,
    origin: input.origin,
    ...(input.injectId !== undefined ? { injectId: input.injectId } : {}),
    ...(input.media !== undefined ? { media: input.media } : {}),
  }
}

/**
 * POSTs a new post to the live backend (`POST /api/posts`). Returns the
 * request's `Promise<void>` — callers fire-and-forget it
 * (`.catch(() => {})`) rather than awaiting the round trip; the SignalR
 * `PostReceived` broadcast (consumed by `useFeedStream`) is what actually
 * surfaces the post, never this call's resolution. No client `exerciseId`
 * (COR-001) and no frontend telemetry (the backend is the sole XC-004
 * emitter for this request) — see the module header.
 */
export async function publishPost(input: CreatePostInput): Promise<void> {
  await api.post('/posts', toRequestBody(input))
}
