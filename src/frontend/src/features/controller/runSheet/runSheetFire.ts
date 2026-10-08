/**
 * features/controller/runSheet/runSheetFire.ts
 * ---------------------------------------------------------------------------
 * The run sheet's FIRE SERVICE (demo-polish C3, story 19; CTL-010/011 lite,
 * COR-018, COR-053, XC-004). STAFF world - no React, no UI. Turns one beat into a
 * post and classifies what happened, without ever recording anything itself (the
 * store does that, `runSheetStore.ts`).
 *
 *   fireBlockReason()   can this beat be fired right now? (persona resolves, there is
 *                       something to post, a reply's parent has been fired) - the one
 *                       place the "Fire the parent first" / "unknown persona" rules live;
 *   buildPostInput()    the `CreatePostInput` for a beat: `origin:
 *                       'controller-as-persona'`, the controller's acting human
 *                       (COR-018), `scenarioTime = scenarioNow()` (COR-053), the beat's
 *                       media / baseline, and `parentPostId` for a reply;
 *   sendBeat()          sends it and returns `fired` / `failed` / `unconfirmed`.
 *
 * LIVE vs MOCK (`USE_MOCK_DATA`). Live: `publishPost` -> `POST /api/posts`, whose 201
 * body carries the new post's id (kept as `firedPostId`; the server stamps the XC-004
 * `post`/`reply` event, so the frontend emits nothing - implementation.md §1.8). Mock
 * (dev, no backend): the same `createPost` + `postStore.appendPost` pair the participant
 * composer uses, so the demo runs end to end on `npm run dev`; mock `createPost` emits
 * the telemetry event itself, as the §1.8 mock-mode rule says. Neither path puts an
 * `exerciseId` on the wire (`publishPost` drops it; scope is server-side, COR-001).
 *
 * NEVER A FALSE "FIRED", NEVER A BLIND RETRY. A post is `fired` only when the server (or
 * the mock) returned its id. `POST /api/posts` is not idempotent yet (F4 / #455) and
 * `publishPost` rejects a malformed 2xx even though the post may already exist, so a
 * failure is classified by what it PROVES:
 *   failed       a 4xx (the server looked at it and refused, so nothing was created), or
 *                a mock-mode rejection, or nothing was ever sent -> Retry is safe;
 *   unconfirmed  anything else: no response (network drop, timeout), a 5xx / 504, 408, or
 *                a 2xx the client could not read -> the post MAY be live, so the UI asks
 *                the controller to check the live world and never retries by itself.
 * (Mirrors the participant composer's `classifyPublishFailure`, with controller-facing
 * wording instead of in-fiction wording.)
 */

import { isAxiosError } from 'axios'
import { scenarioNow } from '@/core/clock'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import type { Persona } from '@/features/personas'
import { createPost } from '@/features/social/services/postService'
import { postStore } from '@/features/social/services/postStore'
import { publishPost } from '@/features/social/services/livePostActions'
import type { CreatePostInput } from '@/features/social/types/post'
import { runtimeOf, type BeatFailure, type RunSheetData } from './runSheetModel'
import type { RunSheetBeat } from './runSheetSchema'

/** What the persona read has delivered so far. */
export interface PersonaLookup {
  readonly personas: readonly Persona[]
  readonly loading: boolean
  /** The persona read failed (the list may still hold an earlier successful result). */
  readonly failed: boolean
}

/** The persona whose handle is `handle` (case-insensitive, no '@'), within this exercise. */
export function findPersonaForHandle(
  personas: readonly Persona[],
  handle: string,
  exerciseId: string,
): Persona | undefined {
  const wanted = handle.toLowerCase()
  return personas.find(persona => {
    if (persona.handle.toLowerCase() !== wanted) return false
    // Defence in depth: a persona stamped with another exercise is never used.
    const personaExerciseId: string | undefined = persona.exerciseId
    return personaExerciseId === undefined || personaExerciseId === exerciseId
  })
}

/** A beat that can be fired now: who to post as, and (for a reply) what to reply to. */
export interface FireReady {
  readonly ok: true
  readonly persona: Persona
  readonly parentPostId?: string
}

/** A beat that cannot be fired now, and the controller-facing reason. */
export interface FireBlocked {
  readonly ok: false
  readonly reason: string
}

/** The exact reason shown for a reply whose parent has not been fired (AC). */
export const FIRE_PARENT_FIRST = 'Fire the parent first'

/**
 * Decides whether `beat` can be fired right now. Checks, in order: something to post;
 * the persona handle resolves against the exercise's personas; a reply's parent.
 * (Whether the beat's own status allows a fire is the store's `beginFire`.)
 */
export function fireBlockReason(
  data: RunSheetData,
  beat: RunSheetBeat,
  lookup: PersonaLookup,
  exerciseId: string,
): FireReady | FireBlocked {
  if (beat.text.trim().length === 0 && (beat.media === undefined || beat.media.length === 0)) {
    return { ok: false, reason: 'Nothing to post: add text or media to this beat.' }
  }

  const persona = findPersonaForHandle(lookup.personas, beat.persona.handle, exerciseId)
  if (persona === undefined) {
    if (lookup.loading) {
      return { ok: false, reason: 'Personas are still loading. Try again in a moment.' }
    }
    if (lookup.failed && lookup.personas.length === 0) {
      return {
        ok: false,
        reason: `Personas could not be loaded, so @${beat.persona.handle} cannot be checked. `
          + 'Reload the console and try again.',
      }
    }
    return {
      ok: false,
      reason: `Unknown persona @${beat.persona.handle}: no persona with that handle exists in `
        + 'this exercise. Edit the beat to choose one.',
    }
  }

  const replyTo = beat.replyTo
  if (replyTo === undefined) return { ok: true, persona }
  if ('postId' in replyTo) return { ok: true, persona, parentPostId: replyTo.postId }

  const parent = data.beats.find(candidate => candidate.id === replyTo.beatId)
  if (parent === undefined) {
    return { ok: false, reason: 'The beat this replies to is no longer in the sheet. Edit "reply to".' }
  }
  const parentRecord = runtimeOf(data, parent.id)
  if (parentRecord.status === 'fired' && parentRecord.firedPostId !== undefined) {
    return { ok: true, persona, parentPostId: parentRecord.firedPostId }
  }
  const why =
    parentRecord.inFlight === true
      ? `"${parent.title}" is firing now`
      : parentRecord.status === 'skipped'
        ? `"${parent.title}" was skipped: undo the skip, or change "reply to"`
        : parentRecord.failure?.kind === 'unconfirmed'
          ? `"${parent.title}" may already be live but its post is unknown: check the live world`
          : parentRecord.status === 'failed'
            ? `"${parent.title}" did not go out: retry it first`
            : undefined
  return { ok: false, reason: why === undefined ? FIRE_PARENT_FIRST : `${FIRE_PARENT_FIRST} (${why})` }
}

/** The input to post one beat as its persona. `exerciseId` stamps only; it is never sent. */
export function buildPostInput(
  beat: RunSheetBeat,
  ctx: {
    readonly exerciseId: string
    readonly timeZone: string
    readonly actingHumanId: string
    readonly persona: Persona
    readonly parentPostId?: string
  },
): CreatePostInput {
  const baseline = beat.engagementBaseline
  return {
    exerciseId: ctx.exerciseId,
    timeZone: ctx.timeZone,
    scenarioTime: scenarioNow().toISOString(),
    authorPersonaId: ctx.persona.id,
    actingHumanId: ctx.actingHumanId,
    text: beat.text,
    origin: 'controller-as-persona',
    ...(beat.media !== undefined && beat.media.length > 0
      ? { media: beat.media.map(item => ({ mediaId: item.mediaId, alt: item.alt })) }
      : {}),
    ...(ctx.parentPostId !== undefined ? { parentPostId: ctx.parentPostId } : {}),
    ...(baseline !== undefined ? { engagementBaseline: { ...baseline } } : {}),
  }
}

/** The outcome of sending one beat. */
export type SendBeatResult =
  | { readonly kind: 'fired'; readonly postId: string; readonly scenarioTime: string }
  | ({ readonly kind: BeatFailure['kind'] } & { readonly message: string })

const CHECK_LIVE_WORLD = 'The post may already be live: check the Live world before firing it again.'

/** The plain-text part of a server 4xx body (`"..."` or `{ "error": "..." }`), bounded. */
function serverText(data: unknown): string | undefined {
  const text =
    typeof data === 'string'
      ? data
      : typeof data === 'object' && data !== null && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : undefined
  const trimmed = text?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed.slice(0, 300)
}

/**
 * Classifies a rejected `publishPost` (see the module header): a 4xx other than 408 is a
 * refusal that created nothing (`failed`); everything else is `unconfirmed`.
 */
export function classifyLiveFailure(error: unknown): BeatFailure {
  if (isAxiosError(error)) {
    const status = error.response?.status
    if (status !== undefined && status >= 400 && status < 500 && status !== 408) {
      if (status === 429) {
        return { kind: 'failed', message: 'Too many posts right now (HTTP 429). Wait a moment, then retry.' }
      }
      const detail = serverText(error.response?.data)
      return {
        kind: 'failed',
        message: `The server refused this post (HTTP ${status})${detail === undefined ? '' : `: ${detail}`}. `
          + 'Nothing was posted.',
      }
    }
    if (status === undefined) {
      return {
        kind: 'unconfirmed',
        message: `No response from the server (network error or timeout). ${CHECK_LIVE_WORLD}`,
      }
    }
    return {
      kind: 'unconfirmed',
      message: `The server answered HTTP ${status} without confirming the post. ${CHECK_LIVE_WORLD}`,
    }
  }
  return {
    kind: 'unconfirmed',
    message: `The server replied, but its reply could not be read. ${CHECK_LIVE_WORLD}`,
  }
}

/** A mock-mode rejection (unknown media id, missing alt) mirrors a server 400: nothing created. */
function classifyMockFailure(error: unknown): BeatFailure {
  const reason = error instanceof Error ? error.message.replace(/^createPost:\s*/, '') : 'unknown error'
  return { kind: 'failed', message: `Not posted: ${reason}` }
}

/** A well-formed ISO instant, else the instant we sent. */
function instantOr(candidate: string | undefined, fallback: string): string {
  return candidate !== undefined && !Number.isNaN(Date.parse(candidate)) ? candidate : fallback
}

/**
 * Sends one beat and reports the outcome. NEVER rejects: every failure is classified.
 * Writes nothing to the sheet; the caller records the result.
 */
export async function sendBeat(input: CreatePostInput): Promise<SendBeatResult> {
  if (USE_MOCK_DATA) {
    try {
      const post = createPost(input)
      postStore.appendPost(post)
      return { kind: 'fired', postId: post.id, scenarioTime: post.scenarioTime }
    } catch (error: unknown) {
      return classifyMockFailure(error)
    }
  }
  try {
    const created = await publishPost(input)
    return {
      kind: 'fired',
      postId: created.id,
      scenarioTime: instantOr(created.scenarioTime, input.scenarioTime),
    }
  } catch (error: unknown) {
    return classifyLiveFailure(error)
  }
}
