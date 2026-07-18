/**
 * features/social/services/postService.ts
 * ---------------------------------------------------------------------------
 * Post provenance & telemetry (feature: posts, story 03; SOC-003, COR-018,
 * COR-053, XC-002, XC-004, R-003). Participant world (Pulse Social skin) —
 * pure model/service module, no UI, no COBRA.
 *
 * Owns the FULL `Post` model's read/write seam:
 *
 *   - `createPost`         Sanitizes (NFR-004) + assembles a `Post` and emits
 *                          exactly one XC-004 `'post'` telemetry event. The
 *                          blessed ingest path — every new post (a
 *                          participant's compose action, a controller
 *                          operating a persona, a fired MSEL inject, the
 *                          future adaptive engine) goes through this one
 *                          function. Never throws because of telemetry
 *                          (`buildAndEmit` is caller-safe) — a dead telemetry
 *                          pipeline must never block a post from being made.
 *
 *   - `toParticipantView`  The ONLY sanctioned way to hand a `Post` to a
 *                          participant surface. Builds a fresh object literal
 *                          from participant-safe fields only — `origin`,
 *                          `actingHumanId`, `createdWallClock`, and
 *                          `injectId` are genuinely ABSENT from the result,
 *                          never merely falsy (XC-002). Never hand-pick
 *                          fields off a `Post` elsewhere; always route
 *                          through this function.
 *
 *   - `originConsoleLabel` The staff-only R-003 console vocabulary for a
 *                          post's origin (`ENGINE · AUTO` /
 *                          `SIMCELL · MANUAL` / `PARTICIPANT` / `INJ-nnn`),
 *                          with NO inference beyond the stored
 *                          enum/`injectId`. Drives the console's
 *                          always-visible origin line. Never call this from
 *                          a participant surface.
 *
 *   - `listPosts`          A handful of seeded mock posts (the Fairhaven
 *                          water-contamination arc) exercising every origin
 *                          and the SOC-052 rumor-vs-official tension: the
 *                          unverified impersonator's inject-fired post
 *                          outperforms the verified utility's official one.
 *                          Built as plain `Post` literals (mirrors
 *                          `personaService.ts`'s `SEEDED_PERSONAS`) — these
 *                          are PRE-EXISTING fixture content, not a live
 *                          ingest action, so reading them carries no
 *                          telemetry/network side effect.
 *
 * Two-worlds note: this module is participant-world data/service code, but
 * the `Post` shape it produces carries staff/telemetry-only fields
 * (`origin`, `actingHumanId`, `createdWallClock`, `injectId`). Those must
 * never reach a participant surface — `toParticipantView` is the structural
 * guarantee (XC-002).
 */

import { buildAndEmit, generateEventId } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import { personaIdForHandle } from '@/features/personas'
import { sanitizeText } from './sanitize'
import type {
  ParticipantPostView,
  Post,
  PostCounts,
  PostLinkPreview,
  PostMedia,
  PostOrigin,
} from '../types/post'

/**
 * Input to `createPost`. The caller (a compose action, a controller console,
 * a fired inject) supplies `scenarioTime`/`timeZone` from its own clock /
 * exercise context — this service stays pure and never reads either itself.
 */
export interface CreatePostInput {
  readonly exerciseId: string
  readonly timeZone: string
  readonly scenarioTime: string
  readonly authorPersonaId: string
  readonly actingHumanId: string
  readonly text: string
  readonly media?: PostMedia[]
  readonly linkPreview?: PostLinkPreview
  readonly counts?: Partial<PostCounts>
  readonly origin: PostOrigin
  readonly injectId?: string
}

/** Every post starts with zero engagement unless the caller overrides it
 * (e.g. a seeded fixture backfilling an already-established post's counts). */
const DEFAULT_COUNTS: PostCounts = { reply: 0, repost: 0, like: 0 }

function mergeCounts(overrides: Partial<PostCounts> | undefined): PostCounts {
  return { ...DEFAULT_COUNTS, ...overrides }
}

/**
 * Sanitizes + assembles a `Post` and emits exactly one XC-004 `'post'`
 * telemetry event. Never throws because of telemetry — `buildAndEmit` is
 * caller-safe, so a dead/misconfigured telemetry pipeline can never block a
 * post from being created.
 */
export function createPost(input: CreatePostInput): Post {
  const text = sanitizeText(input.text)
  const createdWallClock = wallClockNowIso()
  const id = `post-${generateEventId()}`

  const post: Post = {
    id,
    exerciseId: input.exerciseId,
    authorPersonaId: input.authorPersonaId,
    actingHumanId: input.actingHumanId,
    text,
    media: input.media,
    linkPreview: input.linkPreview,
    counts: mergeCounts(input.counts),
    createdWallClock,
    scenarioTime: input.scenarioTime,
    origin: input.origin,
    injectId: input.injectId,
  }

  // XC-004: actor.kind is always 'persona' - even an engine- or inject-origin
  // post is attributed to the persona account it was posted AS; `origin` (on
  // the envelope, not the actor) is what carries the provenance distinction.
  // `actingHumanId` is always set on the actor (COR-018), satisfying the
  // schema's conditional 'controller-as-persona' requirement unconditionally.
  buildAndEmit({
    exerciseId: input.exerciseId,
    eventType: 'post',
    channel: 'social',
    actor: {
      kind: 'persona',
      personaId: input.authorPersonaId,
      actingHumanId: input.actingHumanId,
    },
    origin: input.origin,
    injectId: input.injectId,
    wallClockTime: createdWallClock,
    scenarioTime: input.scenarioTime,
    timeZone: input.timeZone,
    target: { entityType: 'post', entityId: id },
  })

  return post
}

/**
 * Narrows a `Post` down to the ONLY shape a participant surface may receive.
 * `origin`, `actingHumanId`, `createdWallClock`, and `injectId` are
 * genuinely ABSENT from the result (XC-002) — this builds a fresh object
 * literal from the participant-safe fields only; it never spreads `post`.
 */
export function toParticipantView(post: Post): ParticipantPostView {
  return {
    id: post.id,
    authorPersonaId: post.authorPersonaId,
    text: post.text,
    counts: post.counts,
    scenarioTime: post.scenarioTime,
    ...(post.media !== undefined ? { media: post.media } : {}),
    ...(post.linkPreview !== undefined ? { linkPreview: post.linkPreview } : {}),
  }
}

/**
 * The staff-only R-003 console vocabulary for a post's origin — drives the
 * console's always-visible origin line with NO inference beyond the stored
 * enum/`injectId`. Never call this from a participant surface.
 */
export function originConsoleLabel(post: Post): string {
  switch (post.origin) {
    case 'engine':
      return 'ENGINE · AUTO'
    case 'controller-as-persona':
      return 'SIMCELL · MANUAL'
    case 'participant':
      return 'PARTICIPANT'
    case 'inject':
      return post.injectId ? `INJ-${post.injectId}` : 'INJ-unknown'
    default: {
      // Exhaustiveness guard: a future 5th PostOrigin value fails the build
      // here rather than silently falling through unmapped.
      const exhaustiveCheck: never = post.origin
      return exhaustiveCheck
    }
  }
}

// -----------------------------------------------------------------------------
// Seeded mock posts (Fairhaven water-contamination arc)
// -----------------------------------------------------------------------------

/** Matches `personaService.ts`'s mock exercise id so seeded posts and seeded
 * personas resolve to the same exercise scope. */
const MOCK_EXERCISE_ID = 'ex-mock-0001'

/**
 * Fixed authoring-time stamp for the seed fixtures below. These are
 * pre-existing mock content, not a live ingest event, so a deterministic
 * constant stands in for a real `wallClockNowIso()` read (mirrors
 * `seedCast.ts`'s `SEED_EPOCH_MS` precedent: authored fixture data, never a
 * wall-clock read).
 */
const SEED_WALL_CLOCK = '2026-07-01T00:00:00.000Z'

/**
 * The seeded mock posts. Deliberately varied origins (participant,
 * controller-as-persona, engine, and an inject carrying injectId '042') and
 * the SOC-052 rumor-vs-official tension: the unverified impersonator's
 * inject-fired post (`persona-fairhavenwaterupd`) outperforms the verified
 * utility's official advisory (`persona-fairhavenwater`).
 */
const SEEDED_POSTS: readonly Post[] = [
  {
    id: 'post-seed-fw-advisory',
    exerciseId: MOCK_EXERCISE_ID,
    authorPersonaId: personaIdForHandle('FairhavenWater'),
    actingHumanId: 'human-simcell-utility',
    text:
      'Boil water advisory remains in effect for Zones 2-4 while we complete additional ' +
      'testing. Do not use tap water for drinking or cooking until further notice. Updates ' +
      'as soon as results are confirmed.',
    counts: { reply: 18, repost: 42, like: 76 },
    createdWallClock: SEED_WALL_CLOCK,
    scenarioTime: '2033-09-04T13:15:00Z',
    origin: 'controller-as-persona',
  },
  {
    id: 'post-seed-fwupd-rumor',
    exerciseId: MOCK_EXERCISE_ID,
    authorPersonaId: personaIdForHandle('FairhavenWaterUpd'),
    actingHumanId: 'human-simcell-rumor',
    text:
      '🚨 BREAKING: sources say contamination is FAR WORSE than officials are admitting. ' +
      'Share this before they take it down!!',
    counts: { reply: 340, repost: 812, like: 1450, share: 120 },
    createdWallClock: SEED_WALL_CLOCK,
    scenarioTime: '2033-09-04T13:32:00Z',
    origin: 'inject',
    injectId: '042',
  },
  {
    id: 'post-seed-fulco-coordination',
    exerciseId: MOCK_EXERCISE_ID,
    authorPersonaId: personaIdForHandle('FulcoEM'),
    actingHumanId: 'system-engine',
    text:
      'Fulton County EM is coordinating with Fairhaven Water on the boil-water advisory. ' +
      'Shelters are NOT needed at this time. Follow @FairhavenWater for updates.',
    counts: { reply: 9, repost: 31, like: 54 },
    createdWallClock: SEED_WALL_CLOCK,
    scenarioTime: '2033-09-04T13:40:00Z',
    origin: 'engine',
  },
  {
    id: 'post-seed-newsline7-breaking',
    exerciseId: MOCK_EXERCISE_ID,
    authorPersonaId: personaIdForHandle('Newsline7'),
    actingHumanId: 'system-engine',
    text:
      'BREAKING: boil-water advisory issued for parts of Fairhaven after elevated turbidity ' +
      'readings. Newsline 7 is on the scene — updates as we get them.',
    media: [
      { kind: 'image', alt: 'Newsline 7 crew reporting outside the Fairhaven water plant' },
    ],
    linkPreview: {
      title: 'Boil-water advisory issued for parts of Fairhaven',
      domain: 'newsline7.news',
      imageLabel: 'Newsline 7 broadcast graphic',
    },
    counts: { reply: 64, repost: 150, like: 290 },
    createdWallClock: SEED_WALL_CLOCK,
    scenarioTime: '2033-09-04T13:50:00Z',
    origin: 'engine',
  },
  {
    id: 'post-seed-mvega-question',
    exerciseId: MOCK_EXERCISE_ID,
    authorPersonaId: personaIdForHandle('mvega_fh'),
    actingHumanId: 'human-participant-mvega',
    text: 'is the water actually safe?? my kids drank tap water this morning omg',
    counts: { reply: 5, repost: 2, like: 9 },
    createdWallClock: SEED_WALL_CLOCK,
    scenarioTime: '2033-09-04T14:05:00Z',
    origin: 'participant',
  },
  {
    id: 'post-seed-kward-correction',
    exerciseId: MOCK_EXERCISE_ID,
    authorPersonaId: personaIdForHandle('kwardFH'),
    actingHumanId: 'human-participant-kward',
    text:
      'Please stop sharing posts from @FairhavenWaterUpd — that is NOT the official ' +
      'utility account. Get your updates from @FairhavenWater and @FulcoEM.',
    counts: { reply: 22, repost: 88, like: 210 },
    createdWallClock: SEED_WALL_CLOCK,
    scenarioTime: '2033-09-04T14:20:00Z',
    origin: 'participant',
  },
]

/**
 * Returns the seeded mock posts (the Fairhaven water-contamination arc) — a
 * fresh shallow copy each call so callers can't mutate the canonical set.
 */
export function listPosts(): Post[] {
  return [...SEEDED_POSTS]
}
