/**
 * features/controller/services/composeService.ts
 * ---------------------------------------------------------------------------
 * The post-as-persona publish SEAM (feature: persona-operation, story 01 -
 * "Post as any persona into an enabled channel"; CTL-001, COR-018, SOC-003,
 * XC-002, R-003 - and demo-polish C1, story 17 "Post as persona v2"). Staff world
 * (Controller Console) - pure model/service module, no UI, no COBRA.
 *
 * KEYSTONE, SECURITY-CRITICAL. This is the one place the console turns a
 * controller's compose action into a published post. TWO adapters behind the ONE
 * `USE_MOCK_DATA` flip point (`@/core/config/mockData`, branched by the caller,
 * `useComposeAsPersona`):
 *
 *   MOCK  {@link composeAsPersona}: forward to the SHIPPED `createPost`
 *         (`@/features/social`) with `origin: 'controller-as-persona'` and the
 *         acting-human attribution (COR-018). Synchronous and pure (no network). It
 *         is the mock analog of the v2 `POST /api/posts`: it resolves media through
 *         the mock registry, links a reply (`parentPostId`), and emits exactly one
 *         XC-004 `post` / `reply` event - and, like the server, it REFUSES an
 *         out-of-range `engagementBaseline` instead of clamping it (see below).
 *
 *   LIVE  {@link publishAsPersonaLive}: AWAIT `livePostActions.publishPost`
 *         (`POST /api/posts`, no client `exerciseId`) and turn the 201 `StaffPostDto`
 *         into the console's `Post`. NOTHING is swallowed: a non-2xx rejects with the
 *         axios error (its server message is shown by the composer), and a 2xx body
 *         that is not a post rejects with {@link ComposeUnconfirmedError} (the post may
 *         ALREADY exist, so the composer must not offer a blind retry). It never
 *         calls `createPost`: the server is the SOLE XC-004 emitter for a live post
 *         (`post`, or `reply` with `payload.parentPostId`; implementation.md section
 *         1.8), so the former "accepted double-count" is retired now that attribution
 *         is server-derived - and an uploaded (real) media id is unknown to the mock
 *         registry anyway.
 *
 * The seam does NOT re-implement sanitization (NFR-004): `createPost` owns it in
 * mock mode and the server's `PostSanitizer` owns it live. It does NOT build the
 * telemetry event, and it does NOT read the clock or the exercise context - those
 * arrive as inputs from the caller, keeping it pure and unit-testable.
 *
 * ENGAGEMENT BASELINE (staff-only, CTL-001). A seeded starting like / repost / reply
 * count, whole numbers 0..1,000,000. The server answers 400
 * ("engagementBaseline values must be between 0 and 1000000.") for anything else;
 * the mock `createPost` would silently CLAMP, hiding the bug until UAT. So
 * {@link validateEngagementBaseline} is the ONE client-side check, used by the
 * composer form (inline message, blocks Fire), by the mock adapter (throws the same
 * 400 text as a {@link ComposeRejectedError}) and by the live adapter (refuses before
 * the round trip).
 *
 * TWO WORLDS / ISOLATION
 *   - The produced `Post` carries staff/telemetry-only provenance (`origin`,
 *     `actingHumanId`, `createdWallClock`). That provenance must NEVER reach a
 *     participant surface - the ONLY participant path is `toParticipantView`
 *     (`@/features/social`), which structurally drops those fields (XC-002, SOC-003).
 *     This module never narrows to a participant view itself.
 *   - `exerciseId`/`timeZone` are STAMPING inputs only (COR-001) - never a client
 *     query-scoping param, and never on the wire.
 *
 * SCOPE: post and reply (`parentPostId`). Repost/quote-as-persona and DMs are not
 * representable here and remain out of scope.
 */

import { isAxiosError } from 'axios'
import { wallClockNowIso } from '@/core/time/wallClock'
import {
  createPost,
  type CreatedPostView,
  type CreatePostInput,
  type CreatePostMedia,
  type EngagementBaseline,
  type Post,
  type PostOrigin,
  type StaffPostView,
} from '@/features/social'
import { publishPost } from '@/features/social/services/livePostActions'

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * Input to {@link composeAsPersona} / {@link publishAsPersonaLive}. Mirrors the
 * participant-safe subset of `CreatePostInput` - but `origin` is NOT accepted: it is
 * fixed to `'controller-as-persona'` inside, so a caller can never post-as-persona
 * under any other provenance. `authorPersonaId` is the ACTIVE persona's id (the world
 * the controller is speaking as); `actingHumanId` is the operating controller
 * (COR-018), supplied by the caller - never inferred here.
 */
export interface ComposeAsPersonaInput {
  /** Stamping only (COR-001) - from `useExerciseContext()`. */
  readonly exerciseId: string
  /** Stamping only (COR-001) - from `useExerciseContext()`. */
  readonly timeZone: string
  /** Scenario ISO instant (COR-053) - `scenarioNow().toISOString()`. */
  readonly scenarioTime: string
  /** The ACTIVE persona's INSTANCE id - the account the post is authored as. */
  readonly authorPersonaId: string
  /** The operating controller behind the shared persona (COR-018). */
  readonly actingHumanId: string
  readonly text: string
  /** Assets the controller already uploaded / picked (contract v2); each needs alt text. */
  readonly media?: CreatePostMedia[]
  /** Makes this post a reply to `parentPostId` (an opaque post id). */
  readonly parentPostId?: string
  /** STAFF only: the seeded starting engagement. Validated, never clamped. */
  readonly engagementBaseline?: EngagementBaseline
}

// ---------------------------------------------------------------------------
// Engagement baseline (client-side validation; the server answers 400)
// ---------------------------------------------------------------------------

/** The server's bound on one baseline number (`PostIngestService.MaxEngagementBaseline`). */
export const MAX_ENGAGEMENT_BASELINE = 1_000_000

/** The server's 400 text for an out-of-range baseline (the mock throws the same words). */
export const BASELINE_RANGE_MESSAGE = 'engagementBaseline values must be between 0 and 1000000.'

/** Inline wording for a bad field in the composer form. */
export const BASELINE_FIELD_MESSAGE = 'Enter a whole number from 0 to 1,000,000.'

/** True for an integer in 0..{@link MAX_ENGAGEMENT_BASELINE}. */
export function isValidBaselineValue(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_ENGAGEMENT_BASELINE
}

/** The result of parsing one baseline text field. */
export type BaselineFieldResult =
  | { readonly ok: true; readonly value: number | undefined }
  | { readonly ok: false; readonly error: string }

/**
 * Parses one baseline input. Blank means "not set" (`value: undefined`); otherwise it
 * must be plain digits (no sign, decimal point, exponent or separators) and an
 * integer in range. Never clamps.
 */
export function parseBaselineField(raw: string): BaselineFieldResult {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: true, value: undefined }
  if (!/^\d+$/.test(trimmed)) return { ok: false, error: BASELINE_FIELD_MESSAGE }
  const value = Number(trimmed)
  if (!isValidBaselineValue(value)) return { ok: false, error: BASELINE_FIELD_MESSAGE }
  return { ok: true, value }
}

/**
 * Validates a baseline object (the members that are present). Returns the server's
 * 400 text when any is not an integer 0..1,000,000, else `undefined`.
 */
export function validateEngagementBaseline(
  baseline: EngagementBaseline | undefined,
): string | undefined {
  if (baseline === undefined) return undefined
  for (const value of [baseline.like, baseline.repost, baseline.reply]) {
    if (value !== undefined && !isValidBaselineValue(value)) return BASELINE_RANGE_MESSAGE
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * A publish the (mock) server would have refused with a 400 - thrown by the mock
 * adapter and by the pre-flight checks so the console shows the SAME failure it
 * would see live. `status` is the HTTP status it stands in for.
 */
export class ComposeRejectedError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ComposeRejectedError'
    this.status = status
  }
}

/**
 * The server answered 2xx but the body was not a post: the post MAY ALREADY EXIST, so
 * a blind retry could double-post. Distinct from a transport failure.
 */
export class ComposeUnconfirmedError extends Error {
  constructor(message = 'The server answered, but the response could not be read.') {
    super(message)
    this.name = 'ComposeUnconfirmedError'
  }
}

/** What a failed publish proves, hence what the UI may say about retrying. */
export type PublishFailureKind =
  /** The server (or mock) refused the request: the same draft would be refused again. */
  | 'rejected'
  /** The server ANSWERED that it created nothing (5xx, 429, 408): retry is reasonable. */
  | 'failed'
  /**
   * The post may ALREADY exist: an unreadable 2xx, a 504, or NO response at all (a
   * connection that drops after the request was sent looks exactly like one that never
   * connected). The console withholds a blind retry: the controller must first check
   * the feed and then choose to post again anyway, or to discard the draft.
   */
  | 'unconfirmed'

/** A classified publish failure, ready for the error banner. */
export interface PublishFailure {
  readonly kind: PublishFailureKind
  /** HTTP status, when the failure came from the server (or stands in for it). */
  readonly status?: number
  /** The message to show: the server's own text when it sent one. */
  readonly message: string
}

/** Longest server message the banner shows (a plain-text 4xx body is short; this caps abuse). */
const MAX_MESSAGE_LENGTH = 300

/** The sentence that goes with every 'unconfirmed' outcome. */
export const UNCONFIRMED_MESSAGE = 'The post may already be live - check the feed before posting again.'

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

/** The `{"error":"<code>"}` codes the 429 / 503 responses use, in words. */
const ERROR_CODE_TEXT: Readonly<Record<string, string>> = {
  rate_limited: 'Too many requests right now. Wait a moment and try again.',
  too_many_requests: 'Too many requests right now. Wait a moment and try again.',
  unavailable: 'The service is not available right now.',
  service_unavailable: 'The service is not available right now.',
}

function cleanMessage(text: string): string | undefined {
  const cleaned = text.replace(CONTROL_CHARS, ' ').trim()
  if (cleaned === '') return undefined
  return cleaned.length > MAX_MESSAGE_LENGTH
    ? `${cleaned.slice(0, MAX_MESSAGE_LENGTH)}...`
    : cleaned
}

/**
 * The human-readable message in a failed response body: a plain JSON string (the
 * existing 4xx convention, `Results.BadRequest("...")`), `{ error: "<code>" }`
 * (429 / 503), or a ProblemDetails-style `{ detail | title | message }`. Anything else
 * is `undefined` (the caller falls back to a status-based message).
 */
function serverMessageOf(data: unknown): string | undefined {
  if (typeof data === 'string') return cleanMessage(data)
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as Record<string, unknown>
  const code = record.error
  if (typeof code === 'string') return ERROR_CODE_TEXT[code] ?? cleanMessage(code)
  for (const field of ['detail', 'title', 'message']) {
    const value = record[field]
    if (typeof value === 'string') {
      const message = cleanMessage(value)
      if (message !== undefined) return message
    }
  }
  return undefined
}

/**
 * Classifies a publish rejection into what the banner should say (see the module
 * header and {@link PublishFailureKind}):
 *  - {@link ComposeRejectedError} (the mock / pre-flight 400) and any other plain
 *    `Error` thrown by the MOCK adapter -> 'rejected' with its own message;
 *  - {@link ComposeUnconfirmedError} -> 'unconfirmed';
 *  - an axios failure with a 2xx response, a 504, or NO response at all (a connection
 *    dropped after the request was sent is indistinguishable from one that never
 *    connected) -> 'unconfirmed';
 *  - 408 / 429 / other 5xx -> 'failed' (the server answered that it took nothing);
 *  - any other 4xx -> 'rejected', with the SERVER's message.
 * A plain `Error` from the MOCK pipeline has its engineering prefix (`createPost: `)
 * stripped, so the banner reads as a message and not as a stack fragment.
 */
export function classifyPublishFailure(failure: unknown): PublishFailure {
  if (failure instanceof ComposeRejectedError) {
    return { kind: 'rejected', status: failure.status, message: failure.message }
  }
  if (failure instanceof ComposeUnconfirmedError) {
    return { kind: 'unconfirmed', message: UNCONFIRMED_MESSAGE }
  }
  if (!isAxiosError(failure)) {
    const raw = failure instanceof Error ? failure.message.replace(/^createPost:\s*/, '') : ''
    return { kind: 'rejected', message: cleanMessage(raw) ?? 'The post was not accepted.' }
  }

  const status = failure.response?.status
  const serverMessage = serverMessageOf(failure.response?.data)

  if (status === undefined) {
    return {
      kind: 'unconfirmed',
      message: `The server did not answer, so the post may have gone out. ${UNCONFIRMED_MESSAGE}`,
    }
  }
  if ((status >= 200 && status < 300) || status === 504) {
    return { kind: 'unconfirmed', status, message: UNCONFIRMED_MESSAGE }
  }
  if (status === 408 || status === 429 || status >= 500) {
    return {
      kind: 'failed',
      status,
      message: serverMessage ?? `The server could not take the post (HTTP ${status}).`,
    }
  }
  return {
    kind: 'rejected',
    status,
    message: serverMessage ?? `The server refused the post (HTTP ${status}).`,
  }
}

/**
 * The app-toast text for a publish that failed AFTER the composer was off-screen (the
 * dock was closed or the controller moved to another persona before the response
 * landed), so the failure would otherwise be silent. The draft was restored by the
 * caller; an 'unconfirmed' outcome says the status is unknown rather than "failed".
 */
export function describeOffscreenFailure(handle: string, failure: PublishFailure): string {
  const who = `Post as @${handle.startsWith('@') ? handle.slice(1) : handle}`
  if (failure.kind === 'unconfirmed') {
    return `${who}: status unknown - check the feed. Draft restored.`
  }
  const code = failure.status !== undefined ? ` (HTTP ${failure.status})` : ''
  const reason = failure.message.replace(/[.!?\s]+$/, '')
  return `${who} failed${code}: ${reason}. Draft restored.`
}

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

/**
 * MOCK adapter. Publishes a post AS the active persona through the shipped
 * `createPost` pipeline with a fixed `origin: 'controller-as-persona'`. Returns the
 * full `Post` (staff-side); sanitization (NFR-004) and the single XC-004 telemetry
 * event (`post`, or `reply` for a `parentPostId`) both happen inside `createPost` -
 * this function adds neither.
 *
 * It THROWS - as the server answers 400 - for an out-of-range / non-integer
 * `engagementBaseline` ({@link ComposeRejectedError}), and (via `createPost`, MOCK
 * mode only) for an unknown media id or a missing alt. It never throws because of
 * telemetry: `createPost`'s `buildAndEmit` is caller-safe.
 *
 * (In LIVE mode the console does not call this: it publishes with
 * {@link publishAsPersonaLive} so the server is the sole telemetry emitter. If a
 * caller does reach it live, `createPost` never throws for media - the real asset ids
 * are unknown to the mock registry and the server is the gate.)
 */
export function composeAsPersona(input: ComposeAsPersonaInput): Post {
  const baselineError = validateEngagementBaseline(input.engagementBaseline)
  if (baselineError !== undefined) throw new ComposeRejectedError(baselineError)

  return createPost({
    exerciseId: input.exerciseId,
    timeZone: input.timeZone,
    scenarioTime: input.scenarioTime,
    authorPersonaId: input.authorPersonaId,
    actingHumanId: input.actingHumanId,
    text: input.text,
    ...(input.media !== undefined ? { media: input.media } : {}),
    ...(input.parentPostId !== undefined ? { parentPostId: input.parentPostId } : {}),
    ...(input.engagementBaseline !== undefined
      ? { engagementBaseline: input.engagementBaseline }
      : {}),
    // FIXED provenance - the whole point of this seam (SOC-003, R-003). A
    // controller posting AS a persona is always `controller-as-persona`.
    origin: 'controller-as-persona',
  })
}

// ---------------------------------------------------------------------------
// Live adapter
// ---------------------------------------------------------------------------

const POST_ORIGINS: readonly PostOrigin[] = [
  'participant',
  'controller-as-persona',
  'engine',
  'inject',
]

function isStaffPostView(created: CreatedPostView): created is StaffPostView {
  const staff = created as Partial<StaffPostView>
  return typeof staff.origin === 'string' && POST_ORIGINS.includes(staff.origin)
}

/**
 * Builds the console's `Post` from the server's 201 body. Field by field (never a
 * spread of the response), so a stray server-side key can not ride into the store.
 * The staff provenance (`origin`, `actingHumanId`, `exerciseId`, `createdWallClock`)
 * is read from the `StaffPostDto` when present and falls back to what was sent -
 * this is the controller's OWN write coming back, never a participant payload.
 */
export function postFromCreated(created: CreatedPostView, input: ComposeAsPersonaInput): Post {
  const staff = isStaffPostView(created) ? created : undefined
  return {
    id: created.id,
    exerciseId: staff?.exerciseId ?? input.exerciseId,
    authorPersonaId: created.authorPersonaId,
    actingHumanId: staff?.actingHumanId ?? input.actingHumanId,
    text: created.text,
    ...(created.media != null ? { media: created.media } : {}),
    ...(created.inReplyTo != null ? { inReplyTo: created.inReplyTo } : {}),
    ...(created.linkPreview != null ? { linkPreview: created.linkPreview } : {}),
    counts: created.counts,
    ...(created.viewer != null ? { viewer: created.viewer } : {}),
    createdWallClock: staff?.createdWallClock ?? wallClockNowIso(),
    scenarioTime: created.scenarioTime,
    origin: staff?.origin ?? 'controller-as-persona',
    ...(staff?.injectId != null ? { injectId: staff.injectId } : {}),
  }
}

/** The wire input for the live `publishPost` (no `exerciseId`-scoped extras; origin fixed). */
function toLiveInput(input: ComposeAsPersonaInput): CreatePostInput {
  return {
    exerciseId: input.exerciseId,
    timeZone: input.timeZone,
    scenarioTime: input.scenarioTime,
    authorPersonaId: input.authorPersonaId,
    actingHumanId: input.actingHumanId,
    text: input.text,
    origin: 'controller-as-persona',
    ...(input.media !== undefined && input.media.length > 0 ? { media: input.media } : {}),
    ...(input.parentPostId !== undefined ? { parentPostId: input.parentPostId } : {}),
    ...(input.engagementBaseline !== undefined
      ? { engagementBaseline: input.engagementBaseline }
      : {}),
  }
}

/**
 * LIVE adapter. `POST /api/posts` as the active persona and resolve with the
 * console's `Post` built from the 201 body. REJECTS (swallowing nothing) with:
 *  - {@link ComposeRejectedError} for a baseline the server would 400 (no request sent);
 *  - the axios error for any non-2xx (the composer shows the server's message);
 *  - {@link ComposeUnconfirmedError} for a 2xx whose body is not a post.
 * No frontend telemetry: the server emits the one authoritative `post` / `reply`.
 */
export async function publishAsPersonaLive(input: ComposeAsPersonaInput): Promise<Post> {
  const baselineError = validateEngagementBaseline(input.engagementBaseline)
  if (baselineError !== undefined) throw new ComposeRejectedError(baselineError)

  let created: CreatedPostView
  try {
    created = await publishPost(toLiveInput(input))
  } catch (failure) {
    // `publishPost` throws a plain Error for a 2xx body it could not read (the post
    // may exist); every other failure is an axios error and is passed through as is.
    if (isAxiosError(failure)) throw failure
    throw new ComposeUnconfirmedError()
  }
  return postFromCreated(created, input)
}
