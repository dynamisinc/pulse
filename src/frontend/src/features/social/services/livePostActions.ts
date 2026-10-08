/**
 * features/social/services/livePostActions.ts
 * ---------------------------------------------------------------------------
 * The LIVE post-publish action (feature: posts / persona-operation; SOC-001,
 * CTL-001, COR-001, COR-018, COR-053). Pure service module — no UI, no COBRA.
 * Used ONLY when `USE_MOCK_DATA` is false (`@/core/config/mockData`); the mock
 * analog is `postService.createPost`.
 *
 * `POST /api/posts` (CONTRACT v2, demo-polish implementation.md §1.5.2): the
 * wire body is `CreatePostInput` narrowed to exactly `{ authorPersonaId,
 * actingHumanId, text, scenarioTime, timeZone, origin, injectId?, media?,
 * parentPostId?, engagementBaseline? }` — NO client `exerciseId` (COR-001; the
 * server stamps scope from the session, so the field is dropped here rather than
 * merely left undefined).
 *
 *   - `media[]` is `{ mediaId, alt, posterMediaId? }` — assets the SAME actor
 *     uploaded through `core/media`. The legacy `{ kind, alt }` placeholder is no
 *     longer representable (and so no longer sent).
 *   - `parentPostId` makes the post a reply.
 *   - `engagementBaseline` ({ like?, repost?, reply? }) is STAFF ONLY: it is sent
 *     for a non-participant origin and DROPPED for `origin: 'participant'` (the
 *     server ignores it for participants anyway; never putting it on a
 *     participant's wire is the cheaper guarantee).
 *
 * RESPONSE: 201 with a `ParticipantPostDto` (`origin: 'participant'`) or a
 * `StaffPostDto` (every other origin). `publishPost` RESOLVES WITH THE PARSED
 * BODY (`CreatedPostView`) so a caller — the run sheet's `firedPostId`, an
 * instant own-post — can use the new post's id; a 2xx body that is not a post is
 * rejected (fail closed). It REJECTS on any non-2xx and SWALLOWS NOTHING: there
 * is no try/catch in this module.
 *
 * ROLE BY ORIGIN (the callers of this seam):
 *   - `origin: 'participant'` — the participant composer
 *     (`hooks/useComposePost.publish`) posting as the session's own bound
 *     persona.
 *   - `origin: 'controller-as-persona'` — the Controller Console posting AS an
 *     operated persona (`features/controller/hooks/useComposeAsPersona`, and the
 *     run sheet's fire action).
 *   Every other `PostOrigin` (`'engine'`, `'inject'`) is produced server-side
 *   or via the review-queue actions (`liveReviewActions.ts`), never through
 *   this seam.
 *
 * FIRE-AND-FORGET CALLERS: the two shipped callers still attach their own
 * `.catch(() => {})` at the call site (never an unhandled rejection — the known
 * CI-teardown-race hazard) and proceed optimistically (clearing the draft)
 * without awaiting the round trip; the post reaches every participant,
 * including the author, via the backend's `PostReceived` SignalR broadcast and
 * the "▲ N new posts" pill. A caller that WANTS the outcome simply awaits this.
 * No frontend telemetry is emitted here: the backend emits the authoritative
 * XC-004 `'post'`/`'reply'` event once the request lands, so a network-only POST
 * never double-counts (implementation.md §1.8).
 *
 * NO CLIENT `exerciseId` (COR-001) — the wire body never carries one; scope
 * is resolved server-side from the session.
 */

import { api } from '@/core/services/api'
import type {
  CreatedPostView,
  CreatePostInput,
  CreatePostMedia,
  EngagementBaseline,
} from '../types/post'
import { hasWellFormedV2Members } from './postService'

/**
 * The wire body `POST /api/posts` accepts — an explicit field-by-field pick
 * off `CreatePostInput` (never a spread), so a future field added to the
 * frontend model (e.g. `linkPreview`/`counts`, which are NOT part of the
 * frozen `CreatePostRequest` contract) can't silently ride onto the wire.
 */
interface CreatePostRequestBody {
  readonly authorPersonaId: string
  readonly actingHumanId: string
  readonly text: string
  readonly scenarioTime: string
  readonly timeZone: string
  readonly origin: CreatePostInput['origin']
  readonly injectId?: string
  readonly media?: CreatePostMedia[]
  readonly parentPostId?: string
  readonly engagementBaseline?: EngagementBaseline
}

/** Picks the three contract keys of one attachment (never a spread). */
function toWireMedia(item: CreatePostMedia): CreatePostMedia {
  return {
    mediaId: item.mediaId,
    alt: item.alt,
    ...(item.posterMediaId !== undefined ? { posterMediaId: item.posterMediaId } : {}),
  }
}

/** Picks the three baseline keys (never a spread). */
function toWireBaseline(baseline: EngagementBaseline): EngagementBaseline {
  return {
    ...(baseline.like !== undefined ? { like: baseline.like } : {}),
    ...(baseline.repost !== undefined ? { repost: baseline.repost } : {}),
    ...(baseline.reply !== undefined ? { reply: baseline.reply } : {}),
  }
}

function toRequestBody(input: CreatePostInput): CreatePostRequestBody {
  return {
    authorPersonaId: input.authorPersonaId,
    actingHumanId: input.actingHumanId,
    // `text` is forwarded RAW: NFR-004 sanitization for a persisted post is the
    // SERVER's authoritative boundary — PostIngestService runs PostSanitizer
    // (strip, never encode) at ingest before persistence — so the client is not
    // the trust boundary here. (The mock path's `createPost` sanitizes locally
    // only because it never reaches that server boundary.)
    text: input.text,
    scenarioTime: input.scenarioTime,
    timeZone: input.timeZone,
    origin: input.origin,
    ...(input.injectId !== undefined ? { injectId: input.injectId } : {}),
    ...(input.media !== undefined ? { media: input.media.map(toWireMedia) } : {}),
    ...(input.parentPostId !== undefined ? { parentPostId: input.parentPostId } : {}),
    // STAFF ONLY: a participant's baseline is never put on the wire.
    ...(input.engagementBaseline !== undefined && input.origin !== 'participant'
      ? { engagementBaseline: toWireBaseline(input.engagementBaseline) }
      : {}),
  }
}

/**
 * True when `data` is a post body the client can render/use: the participant-
 * safe core (`id`, `authorPersonaId`, `text`, `scenarioTime`, `counts`) plus
 * well-formed optional v2 members. A staff body's extra provenance keys are
 * allowed (the staff caller reads its own write); they are not validated.
 */
function isCreatedPostView(data: unknown): data is CreatedPostView {
  if (typeof data !== 'object' || data === null) return false
  const p = data as CreatedPostView
  return (
    typeof p.id === 'string' && p.id.length > 0 &&
    typeof p.authorPersonaId === 'string' && p.authorPersonaId.length > 0 &&
    typeof p.text === 'string' &&
    typeof p.scenarioTime === 'string' && p.scenarioTime.length > 0 &&
    typeof p.counts === 'object' && p.counts !== null &&
    typeof p.counts.reply === 'number' &&
    typeof p.counts.repost === 'number' &&
    typeof p.counts.like === 'number' &&
    hasWellFormedV2Members(p)
  )
}

/**
 * POSTs a new post to the live backend (`POST /api/posts`) and resolves with
 * the parsed 201 view (participant or staff shape). Rejects on a non-2xx
 * (axios throws) or a 2xx body that is not a post; swallows nothing. No client
 * `exerciseId` (COR-001) and no frontend telemetry (the backend is the sole
 * XC-004 emitter for this request) — see the module header.
 */
export async function publishPost(input: CreatePostInput): Promise<CreatedPostView> {
  const response = await api.post<unknown>('/posts', toRequestBody(input))
  if (!isCreatedPostView(response.data)) {
    throw new Error('publishPost: the server returned a malformed post')
  }
  return response.data
}
