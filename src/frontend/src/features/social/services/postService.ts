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
 *                          exactly one XC-004 `'post'` telemetry event (a
 *                          `'reply'` event when `parentPostId` is set, §1.8). The
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
 * CONTRACT v2 (demo-polish F0, implementation.md §1.5/§5): `createPost` is also
 * the MOCK analog of the v2 `POST /api/posts`. It resolves each
 * `CreatePostMedia.mediaId` through the mock media registry (`@/core/media`) to
 * build the full `PostMedia`, mirroring the server's 400s for an unknown media id
 * and a missing alt; records `parentPostId` (the store links it to its parent —
 * see `postStore.appendPost`); and honours `engagementBaseline` for NON-
 * participant origins only (the server ignores it for participants). The LIVE
 * path is `livePostActions.publishPost`.
 *
 * Two-worlds note: this module is participant-world data/service code, but
 * the `Post` shape it produces carries staff/telemetry-only fields
 * (`origin`, `actingHumanId`, `createdWallClock`, `injectId`). Those must
 * never reach a participant surface — `toParticipantView` is the structural
 * guarantee (XC-002).
 */

import { buildAndEmit, generateEventId } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import { getMockMediaAsset } from '@/core/media/mockMediaRegistry'
import { personaIdForHandle } from '@/features/personas'
import { sanitizeText } from './sanitize'
import type {
  CreatePostInput,
  CreatePostMedia,
  EngagementBaseline,
  ParticipantPostView,
  Post,
  PostCounts,
  PostMedia,
} from '../types/post'

// `CreatePostInput` now lives with the other contract-v2 types (`types/post.ts`);
// it stays importable from here so existing `./postService` imports keep working.
export type { CreatePostInput } from '../types/post'

/** Every post starts with zero engagement unless the caller overrides it
 * (e.g. a seeded fixture backfilling an already-established post's counts). */
const DEFAULT_COUNTS: PostCounts = { reply: 0, repost: 0, like: 0 }

/** Server-side bound on a seeded baseline number (implementation.md §1.5.2). */
const MAX_BASELINE = 1_000_000

/** Clamps one baseline number to a whole number in 0..1,000,000, or drops it. */
function baselineValue(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.min(MAX_BASELINE, Math.max(0, Math.trunc(value)))
}

/**
 * The engagement counts of a new post. `input.counts` overrides the zero
 * default (a seeded fixture backfilling an established post). The STAFF
 * `engagementBaseline` then overrides it for non-participant origins only — the
 * server ignores a participant's baseline, so the mock does too.
 */
function mergeCounts(
  overrides: Partial<PostCounts> | undefined,
  baseline: EngagementBaseline | undefined,
  origin: CreatePostInput['origin'],
): PostCounts {
  const merged: PostCounts = { ...DEFAULT_COUNTS, ...overrides }
  if (baseline === undefined || origin === 'participant') return merged
  return {
    ...merged,
    reply: baselineValue(baseline.reply) ?? merged.reply,
    repost: baselineValue(baseline.repost) ?? merged.repost,
    like: baselineValue(baseline.like) ?? merged.like,
  }
}

/**
 * MOCK analog of the server's media resolution: turns each `CreatePostMedia`
 * (an id the actor uploaded + alt text) into the full `PostMedia` a post
 * carries. Mirrors the server's 400s — an id the mock registry does not know,
 * or alt text that is empty after sanitization (NFR-001/NFR-004), throws
 * instead of quietly dropping the attachment, so a builder's missing-alt bug
 * shows up on `npm run dev` and not only against UAT.
 */
function resolveMedia(items: readonly CreatePostMedia[] | undefined): PostMedia[] | undefined {
  if (items === undefined || items.length === 0) return undefined

  return items.map(item => {
    const asset = getMockMediaAsset(item.mediaId)
    if (asset === undefined) {
      throw new Error('createPost: that media attachment is not available.')
    }
    const alt = sanitizeText(item.alt).trim()
    if (alt.length === 0) {
      throw new Error('createPost: every media attachment needs a description (alt text).')
    }
    const posterUrl =
      item.posterMediaId !== undefined
        ? getMockMediaAsset(item.posterMediaId)?.url ?? asset.posterUrl
        : asset.posterUrl

    return {
      id: asset.id,
      kind: asset.kind,
      url: asset.url,
      alt,
      ...(posterUrl !== undefined ? { posterUrl } : {}),
      ...(asset.width !== undefined ? { width: asset.width } : {}),
      ...(asset.height !== undefined ? { height: asset.height } : {}),
      ...(asset.durationSec !== undefined ? { durationSec: asset.durationSec } : {}),
    }
  })
}

/**
 * Sanitizes + assembles a `Post` and emits exactly one XC-004 `'post'`
 * telemetry event. Never throws because of telemetry — `buildAndEmit` is
 * caller-safe, so a dead/misconfigured telemetry pipeline can never block a
 * post from being created. (It DOES throw for an invalid media attachment —
 * see {@link resolveMedia}.)
 */
export function createPost(input: CreatePostInput): Post {
  const text = sanitizeText(input.text)
  const media = resolveMedia(input.media)
  const createdWallClock = wallClockNowIso()
  const id = `post-${generateEventId()}`

  const post: Post = {
    id,
    exerciseId: input.exerciseId,
    authorPersonaId: input.authorPersonaId,
    actingHumanId: input.actingHumanId,
    text,
    media,
    linkPreview: input.linkPreview,
    counts: mergeCounts(input.counts, input.engagementBaseline, input.origin),
    createdWallClock,
    scenarioTime: input.scenarioTime,
    origin: input.origin,
    injectId: input.injectId,
    // A reply records its parent; `postStore.appendPost` links it (resolves the
    // parent's author handle into `inReplyTo` and bumps the parent's reply count).
    ...(input.parentPostId !== undefined ? { parentPostId: input.parentPostId } : {}),
  }

  // XC-004: actor.kind is always 'persona' - even an engine- or inject-origin
  // post is attributed to the persona account it was posted AS; `origin` (on
  // the envelope, not the actor) is what carries the provenance distinction.
  // `actingHumanId` is always set on the actor (COR-018), satisfying the
  // schema's conditional 'controller-as-persona' requirement unconditionally.
  buildAndEmit({
    exerciseId: input.exerciseId,
    eventType: input.parentPostId !== undefined ? 'reply' : 'post',
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
    ...(input.parentPostId !== undefined ? { payload: { parentPostId: input.parentPostId } } : {}),
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
    // Contract v2 members. Each is rebuilt from its documented, participant-safe
    // keys (never passed through wholesale), so a wire object that happened to
    // carry an extra server-side key can not smuggle it onto a participant view.
    ...(post.media !== undefined ? { media: post.media.map(narrowMedia) } : {}),
    ...(post.inReplyTo !== undefined
      ? { inReplyTo: { postId: post.inReplyTo.postId, authorHandle: post.inReplyTo.authorHandle } }
      : {}),
    ...(post.linkPreview !== undefined ? { linkPreview: post.linkPreview } : {}),
    ...(post.viewer !== undefined
      ? { viewer: { liked: post.viewer.liked, reposted: post.viewer.reposted } }
      : {}),
  }
}

/** Rebuilds one media item from its contract keys only (XC-002 defence in depth). */
function narrowMedia(item: PostMedia): PostMedia {
  return {
    id: item.id,
    kind: item.kind,
    url: item.url,
    alt: item.alt,
    ...(item.posterUrl !== undefined ? { posterUrl: item.posterUrl } : {}),
    ...(item.width !== undefined ? { width: item.width } : {}),
    ...(item.height !== undefined ? { height: item.height } : {}),
    ...(item.durationSec !== undefined ? { durationSec: item.durationSec } : {}),
  }
}

/** True when `value` is a plain object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

function isWellFormedMedia(item: unknown): boolean {
  if (!isRecord(item)) return false
  return (
    typeof item.id === 'string' && item.id.length > 0 &&
    (item.kind === 'image' || item.kind === 'video') &&
    typeof item.url === 'string' && item.url.length > 0 &&
    typeof item.alt === 'string' &&
    (item.posterUrl === undefined || typeof item.posterUrl === 'string') &&
    isOptionalNumber(item.width) &&
    isOptionalNumber(item.height) &&
    isOptionalNumber(item.durationSec)
  )
}

/**
 * Runtime guard for the OPTIONAL contract-v2 members of a wire post — `media`,
 * `inReplyTo`, `viewer` (implementation.md §1.5.3). Each is accepted when absent
 * (every pre-v2 body and fixture) but must be well-formed when present, so a
 * malformed attachment fails CLOSED at the read seam instead of throwing deep in
 * the render tree (`PostMediaSlot` reads `url`/`alt`/`kind` unguarded).
 *
 * Shared by `feedService.isPost` and `useThread`'s guards, so the feed and the
 * thread can never disagree about what a valid v2 post is.
 */
export function hasWellFormedV2Members(value: object): boolean {
  const p = value as Record<string, unknown>
  const { media, inReplyTo, viewer } = p
  return (
    (media === undefined || (Array.isArray(media) && media.every(isWellFormedMedia))) &&
    (inReplyTo === undefined ||
      (isRecord(inReplyTo) &&
        typeof inReplyTo.postId === 'string' && inReplyTo.postId.length > 0 &&
        typeof inReplyTo.authorHandle === 'string')) &&
    (viewer === undefined ||
      (isRecord(viewer) &&
        typeof viewer.liked === 'boolean' &&
        typeof viewer.reposted === 'boolean'))
  )
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
      {
        id: 'mock-media-seed-newsline7-plant',
        kind: 'image',
        url: '/mock-media/photos/water-plant.svg',
        alt: 'Newsline 7 crew reporting outside the Fairhaven water plant',
        width: 1200,
        height: 800,
      },
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
