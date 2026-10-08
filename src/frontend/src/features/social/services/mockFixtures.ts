/**
 * features/social/services/mockFixtures.ts
 * ---------------------------------------------------------------------------
 * The v2 MOCK CONTENT SET (demo-polish F0, implementation.md §5): the rich,
 * finished-looking Fairhaven content `npm run dev` shows with no backend, and
 * the deterministic fixtures every Wave-2/3 frontend builder develops and tests
 * against. Participant world (Pulse Social skin) — pure data module, no UI, no
 * COBRA. Everything here is authored `Post` literals (like `postService`'s
 * `SEEDED_POSTS`) — pre-existing fixture content, never a live ingest action, so
 * reading it carries no telemetry or network side effect.
 *
 * WHEN IT IS ACTIVE (important — read before you write a test):
 *   - `postStore` seeds the canonical six `listPosts()` posts PLUS these fixtures
 *     only when `DEMO_FIXTURES_ENABLED` is true: mock data on AND not under
 *     Vitest (`import.meta.env.MODE !== 'test'`). So `npm run dev` (and a
 *     `VITE_USE_MOCK_DATA=true` build) shows the rich feed, while the ~230
 *     existing suites keep asserting against the canonical six-post feed.
 *   - A test that wants the rich feed opts in explicitly:
 *       `postStore.resetForTests({ withDemoFixtures: true })`
 *     or just imports a fixture by id from here (`demoFixturePost(id)`).
 *   - `useThread`'s mock resolution ALWAYS knows the fixture threads (a thread
 *     is looked up by id, it is not a feed), so `resolveThread(DEMO_IDS.threadFocus)`
 *     works in any test without opt-in.
 *
 * COVERAGE (each bullet is one §5 item; ids are in `DEMO_IDS` below):
 *   1. 1-/2-/3-/4-image posts with width/height (the 3-image post leads with a
 *      PORTRAIT photo) — `grid1` … `grid4`.
 *   2. A video WITH `posterUrl` + `durationSec`, and one with NO poster —
 *      `videoPoster`, `videoNoPoster`.
 *   3. A thread: root -> reply -> reply-to-reply (focused; ancestry depth 2).
 *      The focused post has THREE direct replies — one visible, one with media,
 *      one taken-down TOMBSTONE — and every reply carries `inReplyTo` —
 *      `threadRoot`, `threadQuestion`, `threadFocus`, `threadReplyConfirm`,
 *      `threadReplyPhoto`, `threadReplyTakenDown`. (The older seeded
 *      `post-seed-mvega-question` thread in `useThread.ts` is untouched.)
 *   4. Viewer states: liked, reposted, both — `grid1` (liked), `countsModest`
 *      (reposted), `videoPoster` (both).
 *   5. Count boundaries 0, 9, 999, 1 000, 1 450, 12 300 — `countsZero` (0/0/0),
 *      `countsModest` (9 / 999 / 1 000), `videoPoster` (1 450 / 3 200 / 12 300).
 *   6. Avatars/banners/locations live on the persona cast (`seedCast.ts`): the
 *      verified utility and its near-identical unverified lookalike side by side
 *      (and a matching pair of posts here: `pairReal`, `pairFake`).
 *   7. Several `#WaterIssues` posts across the scenario hours 10:40-15:05 and
 *      `@dreyes_fh` (the mock viewer) mentions — `hashtag*`, `mention*`.
 *   8. Replies live in the store: `resolveFeed()` (top level) excludes them and
 *      `resolveFeed(scope, { includeReplies: true })` includes them.
 *   9. Posts authored by the mock viewer (`dreyes_fh`): `own1`, `own2`, and a
 *      reply `replyDreyes` — own posts, the Likes tab, the instant-own-post test.
 *
 * TIMES are scenario instants in the Fairhaven arc (2033-09-04, the same day as
 * the seeded six) — authored data, never a wall-clock read (COR-053).
 *
 * MEDIA files are tiny placeholders served from `public/mock-media/**`. The
 * video is a 4-second synthetic H.264 clip standing in for Tom's P3 stock clips.
 * Every image AND the videos carry real alt text (NFR-001).
 */

import { USE_MOCK_DATA } from '@/core/config/mockData'
import { personaIdForHandle } from '@/features/personas'
import type {
  Post,
  PostCounts,
  PostInReplyTo,
  PostLinkPreview,
  PostMedia,
  PostOrigin,
  PostViewerState,
} from '../types/post'

/**
 * Whether the rich fixture set seeds the store. Mock data on, and not Vitest
 * (see the module header). Evaluated once at import.
 */
export const DEMO_FIXTURES_ENABLED: boolean = USE_MOCK_DATA && import.meta.env.MODE !== 'test'

/** The mock exercise scope (matches `personaService`/`postService`). */
const MOCK_EXERCISE_ID = 'ex-mock-0001'

/** Authoring-time stamp for the fixtures — not a wall-clock read. */
const FIXTURE_WALL_CLOCK = '2026-07-01T00:00:00.000Z'

/** The mock viewer's handle (the session persona is `persona-dreyes_fh`). */
export const MOCK_VIEWER_HANDLE = 'dreyes_fh'

/** The fixtures' ids, grouped by the §5 item they cover. Treat every id as opaque. */
export const DEMO_IDS = {
  grid1: 'post-fx-grid1',
  grid2: 'post-fx-grid2',
  grid3: 'post-fx-grid3',
  grid4: 'post-fx-grid4',
  videoPoster: 'post-fx-video-poster',
  videoNoPoster: 'post-fx-video-noposter',
  countsZero: 'post-fx-counts-zero',
  countsModest: 'post-fx-counts-modest',
  pairReal: 'post-fx-pair-real',
  pairFake: 'post-fx-pair-fake',
  hashtagReminder: 'post-fx-hashtag-reminder',
  hashtagMvega: 'post-fx-hashtag-mvega',
  hashtagKward: 'post-fx-hashtag-kward',
  mentionFulco: 'post-fx-mention-fulco',
  own1: 'post-fx-own-1',
  own2: 'post-fx-own-2',
  replyDreyes: 'post-fx-reply-dreyes',
  replyFulco: 'post-fx-reply-fulco',
  threadRoot: 'post-fx-thread-root',
  threadQuestion: 'post-fx-thread-question',
  threadFocus: 'post-fx-thread-focus',
  threadReplyConfirm: 'post-fx-thread-reply-confirm',
  threadReplyPhoto: 'post-fx-thread-reply-photo',
  threadReplyTakenDown: 'post-fx-thread-reply-takendown',
} as const

// -----------------------------------------------------------------------------
// Media
// -----------------------------------------------------------------------------

const MEDIA_BASE = '/mock-media'

interface PhotoSpec {
  readonly file: string
  readonly width: number
  readonly height: number
  readonly alt: string
}

/** The six placeholder photos (SVG "photos"; one is portrait). */
const PHOTOS = {
  flood: {
    file: 'flood-main-street',
    width: 1600,
    height: 900,
    alt: 'Floodwater pooling across the intersection of Main Street and Elm Street',
  },
  plant: {
    file: 'water-plant',
    width: 1200,
    height: 800,
    alt: 'The Fairhaven water treatment plant under a clear sky',
  },
  sign: {
    file: 'boil-advisory-sign',
    width: 1200,
    height: 800,
    alt: 'A yellow roadside sign announcing the boil-water advisory',
  },
  distribution: {
    file: 'bottled-water-distribution',
    width: 1600,
    height: 1067,
    alt: 'Volunteers handing out cases of bottled water',
  },
  reservoir: {
    file: 'reservoir-aerial',
    width: 1600,
    height: 900,
    alt: 'Aerial view of the Eastside reservoir',
  },
  drain: {
    file: 'storm-drain-portrait',
    width: 800,
    height: 1200,
    alt: 'A storm drain with water rushing into it',
  },
} as const satisfies Record<string, PhotoSpec>

type PhotoKey = keyof typeof PHOTOS

function photo(key: PhotoKey): PostMedia {
  const spec: PhotoSpec = PHOTOS[key]
  return {
    id: `mock-media-fx-${key}`,
    kind: 'image',
    url: `${MEDIA_BASE}/photos/${spec.file}.svg`,
    alt: spec.alt,
    width: spec.width,
    height: spec.height,
  }
}

const VIDEO_ALT =
  'A short sample clip: a Fairhaven Water crew explains what the boil-water advisory means'

/** A video WITH a poster and a duration (the normal case). */
const VIDEO_WITH_POSTER: PostMedia = {
  id: 'mock-media-fx-video',
  kind: 'video',
  url: `${MEDIA_BASE}/video/water-update.mp4`,
  posterUrl: `${MEDIA_BASE}/video/water-update.poster.svg`,
  alt: VIDEO_ALT,
  width: 640,
  height: 360,
  durationSec: 4,
}

/** The same clip with NO poster (the player's fallback path). */
const VIDEO_WITHOUT_POSTER: PostMedia = {
  id: 'mock-media-fx-video-noposter',
  kind: 'video',
  url: `${MEDIA_BASE}/video/water-update.mp4`,
  alt: VIDEO_ALT,
  width: 640,
  height: 360,
  durationSec: 4,
}

// -----------------------------------------------------------------------------
// Builders
// -----------------------------------------------------------------------------

/** Who authored a fixture, with the account-level facts the builders need. */
interface Author {
  readonly handle: string
  readonly origin: PostOrigin
}

const FULCO: Author = { handle: 'FulcoEM', origin: 'controller-as-persona' }
const FAIRHAVEN_WATER: Author = { handle: 'FairhavenWater', origin: 'controller-as-persona' }
const WATER_LOOKALIKE: Author = { handle: 'FairhavenWaterUpd', origin: 'controller-as-persona' }
const NEWSLINE: Author = { handle: 'Newsline7', origin: 'engine' }
const SCOOP: Author = { handle: 'TheScoopHQ', origin: 'controller-as-persona' }
const MVEGA: Author = { handle: 'mvega_fh', origin: 'participant' }
const KWARD: Author = { handle: 'kwardFH', origin: 'participant' }
const TBRANDT: Author = { handle: 'tbrandt41', origin: 'participant' }
const DREYES: Author = { handle: MOCK_VIEWER_HANDLE, origin: 'participant' }

interface FixtureSpec {
  readonly id: string
  readonly author: Author
  /** Time of day on 2033-09-04 (UTC), `HH:MM`. */
  readonly at: string
  readonly text: string
  readonly counts: PostCounts
  readonly media?: PostMedia[]
  readonly linkPreview?: PostLinkPreview
  readonly viewer?: PostViewerState
  /** Makes this a reply: the parent post id and the PARENT author's handle. */
  readonly replyTo?: PostInReplyTo
}

function actingHumanFor(author: Author): string {
  return author.origin === 'participant'
    ? `human-participant-${author.handle.toLowerCase()}`
    : author.origin === 'engine'
      ? 'system-engine'
      : 'human-simcell-fixtures'
}

function fixture(spec: FixtureSpec): Post {
  return {
    id: spec.id,
    exerciseId: MOCK_EXERCISE_ID,
    authorPersonaId: personaIdForHandle(spec.author.handle),
    actingHumanId: actingHumanFor(spec.author),
    text: spec.text,
    counts: spec.counts,
    createdWallClock: FIXTURE_WALL_CLOCK,
    scenarioTime: `2033-09-04T${spec.at}:00Z`,
    origin: spec.author.origin,
    ...(spec.media !== undefined ? { media: spec.media } : {}),
    ...(spec.linkPreview !== undefined ? { linkPreview: spec.linkPreview } : {}),
    ...(spec.viewer !== undefined ? { viewer: spec.viewer } : {}),
    ...(spec.replyTo !== undefined ? { inReplyTo: spec.replyTo } : {}),
  }
}

function counts(reply: number, repost: number, like: number): PostCounts {
  return { reply, repost, like }
}

// -----------------------------------------------------------------------------
// The fixtures
// -----------------------------------------------------------------------------

const THREAD_ROOT_REPLY_TO: PostInReplyTo = { postId: DEMO_IDS.threadRoot, authorHandle: 'FulcoEM' }
const THREAD_QUESTION_REPLY_TO: PostInReplyTo = {
  postId: DEMO_IDS.threadQuestion,
  authorHandle: 'mvega_fh',
}
const THREAD_FOCUS_REPLY_TO: PostInReplyTo = { postId: DEMO_IDS.threadFocus, authorHandle: 'FulcoEM' }

/** VISIBLE top-level fixture posts. */
const TOP_LEVEL: readonly Post[] = [
  fixture({
    id: DEMO_IDS.hashtagReminder,
    author: FAIRHAVEN_WATER,
    at: '10:40',
    text:
      'Reminder: the boil-water advisory covers Zones 2-4. Boil tap water for at least one ' +
      'minute before drinking or cooking. #WaterIssues',
    counts: counts(4, 23, 61),
  }),
  fixture({
    id: DEMO_IDS.hashtagMvega,
    author: MVEGA,
    at: '11:05',
    text:
      'Boiled two gallons for the kids this morning. Anyone else keeping a cooled pitcher in ' +
      'the fridge? #WaterIssues',
    counts: counts(2, 1, 17),
  }),
  fixture({
    id: DEMO_IDS.grid1,
    author: FULCO,
    at: '11:30',
    text:
      'Crews are working on the main at Elm Street this morning. Expect lane closures through ' +
      'the afternoon. #WaterIssues',
    counts: counts(11, 38, 124),
    media: [photo('flood')],
    viewer: { liked: true, reposted: false },
  }),
  fixture({
    id: DEMO_IDS.grid2,
    author: NEWSLINE,
    at: '11:55',
    text:
      'Two views of the Eastside reservoir and treatment plant ahead of this afternoon’s ' +
      'briefing. #WaterIssues',
    counts: counts(23, 71, 188),
    media: [photo('reservoir'), photo('plant')],
  }),
  fixture({
    id: DEMO_IDS.threadRoot,
    author: FULCO,
    at: '12:05',
    text:
      'Bottled water pickup: Elm Street Fire Station, 3 PM today. Limit 2 cases per household. ' +
      'Bring ID. #WaterIssues',
    counts: counts(3, 62, 188),
    media: [photo('sign')],
  }),
  fixture({
    id: DEMO_IDS.hashtagKward,
    author: KWARD,
    at: '12:20',
    text:
      'Checking on elderly neighbors who cannot carry water. If you are nearby and able, knock ' +
      'on a door today. #WaterIssues',
    counts: counts(6, 44, 132),
  }),
  fixture({
    id: DEMO_IDS.pairReal,
    author: FAIRHAVEN_WATER,
    at: '12:40',
    text:
      'Bottled water distribution sites open at 3 PM: Elm Street Fire Station and Fairhaven ' +
      'High School. Free, 2 cases per household. #WaterIssues',
    counts: counts(31, 96, 214),
  }),
  // The SOC-052 lookalike: same cadence, nothing flags it, but the details are wrong.
  fixture({
    id: DEMO_IDS.pairFake,
    author: WATER_LOOKALIKE,
    at: '12:46',
    text:
      'Water distribution sites OPEN NOW: Elm Street Fire Station and Fairhaven High. Bring ' +
      'cash — $5 per case. #WaterIssues',
    counts: counts(58, 140, 301),
  }),
  fixture({
    id: DEMO_IDS.grid3,
    author: KWARD,
    at: '13:00',
    text: 'Neighbors helping neighbors on the east side. Look at that line move. #WaterIssues',
    counts: counts(8, 29, 97),
    // Leads with the PORTRAIT photo.
    media: [photo('drain'), photo('flood'), photo('distribution')],
  }),
  fixture({
    id: DEMO_IDS.grid4,
    author: FAIRHAVEN_WATER,
    at: '13:25',
    text:
      'Your quick guide: what the signs look like, where the distribution points are and how ' +
      'the reservoir is holding. #WaterIssues',
    counts: counts(14, 52, 143),
    media: [photo('sign'), photo('distribution'), photo('reservoir'), photo('plant')],
  }),
  fixture({
    id: DEMO_IDS.videoPoster,
    author: NEWSLINE,
    at: '13:45',
    text: 'WATCH: what the boil-water advisory means for your household. #WaterIssues',
    // 1 450 replies / 3 200 reposts / 12 300 likes: the compact-count boundaries.
    counts: counts(1450, 3200, 12300),
    media: [VIDEO_WITH_POSTER],
    viewer: { liked: true, reposted: true },
  }),
  fixture({
    id: DEMO_IDS.videoNoPoster,
    author: SCOOP,
    at: '14:00',
    text: 'The clip they do not want you to see 👀',
    counts: counts(120, 340, 580),
    media: [VIDEO_WITHOUT_POSTER],
  }),
  // Mentions the mock viewer.
  fixture({
    id: DEMO_IDS.mentionFulco,
    author: FULCO,
    at: '14:10',
    text:
      `@${MOCK_VIEWER_HANDLE} the Zone 3 distribution site opens at 3 PM. Bring a photo ID. ` +
      '#WaterIssues',
    counts: counts(1, 3, 15),
  }),
  // Count zero (0/0/0) and a mention of the mock viewer.
  fixture({
    id: DEMO_IDS.countsZero,
    author: KWARD,
    at: '14:30',
    text: `@${MOCK_VIEWER_HANDLE} did you manage to get water yet? Happy to share what I have.`,
    counts: counts(0, 0, 0),
  }),
  // 9 replies / 999 reposts / 1 000 likes: the boundaries just under and at 1K.
  fixture({
    id: DEMO_IDS.countsModest,
    author: TBRANDT,
    at: '14:40',
    text:
      'Mixed messages all day. Which account is the real water utility?? #WaterIssues',
    counts: counts(9, 999, 1000),
    viewer: { liked: false, reposted: true },
  }),
  // Authored by the mock viewer.
  fixture({
    id: DEMO_IDS.own1,
    author: DREYES,
    at: '14:50',
    text: 'Standing in line at Elm Street for water. About 20 minutes so far. #WaterIssues',
    counts: counts(2, 0, 8),
  }),
  fixture({
    id: DEMO_IDS.own2,
    author: DREYES,
    at: '15:05',
    text: 'Does anyone know if the pharmacy on Main Street is open? Need formula. #WaterIssues',
    counts: counts(3, 0, 4),
  }),
]

/** VISIBLE reply fixtures (each carries `inReplyTo`). Excluded from the top-level feed. */
const REPLIES: readonly Post[] = [
  fixture({
    id: DEMO_IDS.threadQuestion,
    author: MVEGA,
    at: '12:12',
    text: 'Is there a separate line for families with infants? We need formula water.',
    counts: counts(1, 0, 6),
    replyTo: THREAD_ROOT_REPLY_TO,
  }),
  // The FOCUSED post of the demo thread: a reply to a reply (ancestors: root, question).
  fixture({
    id: DEMO_IDS.threadFocus,
    author: FULCO,
    at: '12:20',
    text:
      'Yes — families with infants go straight to the table at the side door. Bring ID or a ' +
      'birth certificate for the child.',
    counts: counts(3, 4, 31),
    replyTo: THREAD_QUESTION_REPLY_TO,
  }),
  fixture({
    id: DEMO_IDS.threadReplyConfirm,
    author: KWARD,
    at: '12:26',
    text: 'Confirmed — I was just there. The infant table had no line at all.',
    counts: counts(0, 1, 12),
    replyTo: THREAD_FOCUS_REPLY_TO,
  }),
  // The reply WITH media.
  fixture({
    id: DEMO_IDS.threadReplyPhoto,
    author: TBRANDT,
    at: '12:38',
    text: 'Line at 12:35, about a ten minute wait.',
    counts: counts(1, 0, 5),
    media: [photo('distribution')],
    replyTo: THREAD_FOCUS_REPLY_TO,
  }),
  // A reply by the mock viewer to one of the canonical six.
  fixture({
    id: DEMO_IDS.replyDreyes,
    author: DREYES,
    at: '14:55',
    text: 'Thank you for the clear update. Does Zone 3 include the east side?',
    counts: counts(0, 0, 2),
    replyTo: { postId: 'post-seed-newsline7-breaking', authorHandle: 'Newsline7' },
  }),
  fixture({
    id: DEMO_IDS.replyFulco,
    author: FULCO,
    at: '14:35',
    text: 'Please use the county page for distribution sites rather than reposts. Thank you.',
    counts: counts(2, 9, 47),
    replyTo: { postId: 'post-seed-kward-correction', authorHandle: 'kwardFH' },
  }),
]

/**
 * TAKEN-DOWN reply fixtures. They are soft-deleted: the feed never includes them
 * and the thread returns them as TOMBSTONES (`status: 'taken-down'`, no text, no
 * media, zero counts — implementation.md §1.5.3). The full text below exists only
 * so the fixture is a real `Post`; no read path ever surfaces it.
 */
const TAKEN_DOWN_REPLIES: readonly Post[] = [
  fixture({
    id: DEMO_IDS.threadReplyTakenDown,
    author: WATER_LOOKALIKE,
    at: '12:31',
    text: 'Do not believe them. The free water comes from the same contaminated supply!!',
    counts: counts(9, 33, 71),
    replyTo: THREAD_FOCUS_REPLY_TO,
  }),
]

// -----------------------------------------------------------------------------
// Accessors
// -----------------------------------------------------------------------------

/**
 * Every VISIBLE fixture post — top-level and replies — as a fresh array (callers
 * cannot mutate the canonical set). This is what `postStore` adds to the seeded
 * six when `DEMO_FIXTURES_ENABLED`.
 */
export function listDemoFixturePosts(): Post[] {
  return [...TOP_LEVEL, ...REPLIES]
}

/** The soft-deleted reply fixtures (thread tombstones only; never in the feed). */
export function listDemoTakenDownPosts(): Post[] {
  return [...TAKEN_DOWN_REPLIES]
}

/** One fixture (visible or taken-down) by id, or `undefined`. */
export function demoFixturePost(id: string): Post | undefined {
  return [...TOP_LEVEL, ...REPLIES, ...TAKEN_DOWN_REPLIES].find(post => post.id === id)
}
