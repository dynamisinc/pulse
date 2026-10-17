/**
 * features/controller/report/services/reportMock.ts
 * ---------------------------------------------------------------------------
 * The MOCK exercise report (demo-feedback story 29), used only when `USE_MOCK_DATA` is on (the
 * same switch the posts export uses). STAFF world, no UI.
 *
 * An axios adapter for `GET /staff/exports/report` that answers with {@link MOCK_REPORT} in the
 * frozen contract's shape, so the page and the toolbar filters work with no API.
 * `sources` and `from`/`to` filter the list as the real endpoint does (noise selected zeroes
 * `omittedNoiseCount`); the metrics are identical whatever the filters are. Media URLs are
 * inline SVG data URIs
 * (no network). Tests reuse {@link MOCK_REPORT} as their fixture.
 *
 * STORY 31. The mock is a MULTI-DAY exercise (14-15 Oct; `spansMultipleDays`, `latestDay` set),
 * with injects close together (dense chart markers, some without an MSEL ref) and nested replies
 * in SERVER THREAD ORDER: a reply to a reply (depth 1 under the root), a thread whose reply falls
 * in a later half-hour than its root, and a reply to an unlisted parent (prints at its own time).
 * A `from`/`to` window narrows the exercise dates, injects and posts the way the server now does;
 * the counts and the bins are not recomputed (the dev mock is not the server).
 */

import { AxiosHeaders, type AxiosAdapter } from 'axios'
import type { ExerciseReport, ReportFilters, ReportPost, ReportSourceKey } from '../types/report'
import { DEFAULT_REPORT_FILTERS, SOURCE_ORDER, orderedSources } from './reportFilters'
import { addMinutesToStamp, dateOf, seriesOf } from './reportFormat'

/** A flat labelled picture, as a data URI, so the mock needs no network and no asset files. */
function pictureUri(label: string, from: string, to: string): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">' +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/>` +
    `<stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    '<rect width="640" height="360" fill="url(#g)"/>' +
    '<text x="320" y="190" font-family="Arial" font-size="22" fill="#ffffff" ' +
    `text-anchor="middle">${label}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function post(overrides: Partial<ReportPost> & Pick<ReportPost, 'id' | 'scenarioAt' | 'text'>): ReportPost {
  return {
    scenarioTime: overrides.scenarioAt.slice(11),
    author: { handle: '@FairhavenWater', displayName: 'Fairhaven Water Utility', verified: true, avatarUrl: null },
    source: 'scripted',
    postedBy: null,
    injectRef: null,
    replyToHandle: null,
    parentPostId: null,
    media: [],
    likes: 0,
    reposts: 0,
    replies: 0,
    pinnedForAll: false,
    takenDownAt: null,
    editCount: 0,
    lastEditedAt: null,
    threadRootId: overrides.id,
    depth: 0,
    ...overrides,
  }
}

const EM = { handle: '@KestrelCoEM', displayName: 'Kestrel County EM', verified: true, avatarUrl: null }
const MARISOL = { handle: '@mvega_fh', displayName: 'Marisol Vega', verified: false, avatarUrl: null }
const LOOKALIKE = { handle: '@FairhavenWaterUpd', displayName: 'Fairhaven Water Update', verified: false, avatarUrl: null }

const NOISE_POSTS: ReportPost[] = [
  post({
    id: 'n-1',
    scenarioAt: '2026-10-15 09:07',
    text: 'Anyone else see the line at the Elm Street fire station?',
    author: { handle: '@dreyes_fh', displayName: 'Dana Reyes', verified: false, avatarUrl: null },
    source: 'noise',
    likes: 3,
  }),
  post({
    id: 'n-2',
    scenarioAt: '2026-10-15 09:41',
    text: 'Water pressure looks fine on Birch.',
    author: { handle: '@tbrandt41', displayName: 'Tom Brandt', verified: false, avatarUrl: null },
    source: 'noise',
    likes: 1,
  }),
]

const LISTED_POSTS: ReportPost[] = [
  post({
    id: 'p-0',
    scenarioAt: '2026-10-14 16:20',
    text: 'Fairhaven Water Utility is monitoring a pressure drop on the Eastside main. No action is needed yet.',
    injectRef: 'Pressure drop',
    likes: 21,
    reposts: 4,
  }),
  post({
    id: 'p-1',
    scenarioAt: '2026-10-15 09:04',
    text: 'PRECAUTIONARY BOIL WATER ADVISORY for Fairhaven Eastside, Zones 2, 3 and 4. Bring tap water to a rolling boil for 1 minute before drinking or cooking. #WaterIssues',
    injectRef: '2',
    likes: 184,
    reposts: 96,
    replies: 11,
  }),
  post({
    id: 'p-2',
    scenarioAt: '2026-10-15 09:11',
    text: 'Free bottled water is available now at Elm Street Fire Station and Fairhaven High School until 8 PM. Bring ID showing an Eastside address. #WaterIssues',
    author: EM,
    source: 'participant',
    postedBy: 'R. Okafor',
    media: [
      {
        kind: 'image',
        url: pictureUri('Bottled water pallets', '#7e8c99', '#3d79a8'),
        alt: 'Stacks of shrink-wrapped cases of bottled water on pallets inside an open fire station bay, with a folding table set up in front.',
        durationSec: null,
        width: 640,
        height: 360,
      },
    ],
    likes: 92,
    reposts: 41,
    replies: 6,
  }),
  post({
    id: 'p-3',
    scenarioAt: '2026-10-15 09:14',
    text: "Is formula OK if I use bottled water? I'm on Birch, which zone is that?",
    author: MARISOL,
    replyToHandle: '@KestrelCoEM',
    parentPostId: 'p-2',
    threadRootId: 'p-2',
    depth: 1,
    likes: 14,
    replies: 2,
  }),
  // A reply to a reply: depth 1 under the root, never a second indent level.
  post({
    id: 'p-3b',
    scenarioAt: '2026-10-15 09:20',
    text: 'Birch is Zone 3. Formula made with bottled or boiled water is fine.',
    author: EM,
    source: 'participant',
    postedBy: 'R. Okafor',
    replyToHandle: '@mvega_fh',
    parentPostId: 'p-3',
    threadRootId: 'p-2',
    depth: 1,
    likes: 9,
  }),
  post({
    id: 'p-4',
    scenarioAt: '2026-10-15 09:40',
    text: 'URGENT: Do NOT boil your water. Boiling concentrates the contaminants. Use only bottled water until further notice. #WaterIssues',
    author: LOOKALIKE,
    injectRef: '4',
    likes: 203,
    reposts: 158,
    replies: 37,
  }),
  // The thread stays in its ROOT's 09:30 group even though this reply is at 10:02.
  post({
    id: 'p-4r',
    scenarioAt: '2026-10-15 10:02',
    text: 'Please ignore this account. It is not affiliated with Fairhaven Water.',
    author: EM,
    source: 'participant',
    postedBy: 'R. Okafor',
    replyToHandle: '@FairhavenWaterUpd',
    parentPostId: 'p-4',
    threadRootId: 'p-4',
    depth: 1,
    likes: 31,
  }),
  post({
    id: 'p-5',
    scenarioAt: '2026-10-15 09:52',
    text: '@FairhavenWaterUpd is NOT the water utility. Boiling for 1 minute is safe and effective. Follow @FairhavenWater (verified) for official updates.',
    author: EM,
    source: 'participant',
    postedBy: 'R. Okafor',
    likes: 167,
    reposts: 112,
    replies: 9,
    editCount: 2,
    lastEditedAt: '2026-10-15 09:55',
  }),
  post({
    id: 'p-6',
    scenarioAt: '2026-10-15 10:06',
    text: 'BREAKING: Crews report a second water main break on Mill Road. Traffic diverted at Mill and 4th. Our crew is on scene.',
    author: { handle: '@MetroDesk9', displayName: 'Metro Desk 9', verified: true, avatarUrl: null },
    injectRef: '9',
    media: [
      {
        kind: 'video',
        url: pictureUri('Mill Road footage', '#8e9aa3', '#343b40'),
        alt: 'News footage of water gushing up through cracked pavement and flowing down a residential street toward a storm drain.',
        durationSec: 15,
        width: 640,
        height: 360,
      },
    ],
    likes: 241,
    reposts: 130,
    replies: 22,
  }),
  post({
    id: 'p-7',
    scenarioAt: '2026-10-15 10:09',
    text: 'Crews at the scene. Pressure is being restored zone by zone.',
    author: { handle: '@MetroDesk9', displayName: 'Metro Desk 9', verified: true, avatarUrl: null },
    source: 'engine',
    media: [
      {
        kind: 'video',
        url: null,
        alt: 'A utility truck with flashing amber lights parks beside the excavation.',
        durationSec: 62,
        width: null,
        height: null,
      },
    ],
    likes: 12,
  }),
  post({
    id: 'p-8',
    scenarioAt: '2026-10-15 10:14',
    text: 'Mill Road break affects Zone 1 as well. Advisory now covers all of Fairhaven.',
    source: 'participant',
    postedBy: 'D. Chen',
    likes: 58,
    reposts: 33,
    replies: 5,
    editCount: 1,
    lastEditedAt: '2026-10-15 10:16',
    takenDownAt: '2026-10-15 10:21',
  }),
  // A reply whose parent (a noise post) is not listed: prints at its own time, not indented.
  post({
    id: 'p-9',
    scenarioAt: '2026-10-15 10:30',
    text: 'Pressure is back on Birch, thank you.',
    author: MARISOL,
    source: 'participant',
    replyToHandle: '@tbrandt41',
    parentPostId: 'n-2',
    likes: 2,
  }),
]

const EXERCISE_START = '2026-10-14 16:00'

/** The bin (30 scenario minutes from `EXERCISE_START`) an inject's time falls in. */
function binIndexOf(stamp: string): number {
  const minutes = (day: string, time: string) =>
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)),
      Number(time.slice(0, 2)), Number(time.slice(3, 5))) / 60000
  const at = minutes(stamp.slice(0, 10), stamp.slice(11))
  const start = minutes(EXERCISE_START.slice(0, 10), EXERCISE_START.slice(11))
  return Math.floor((at - start) / 30)
}

/** Key injects: several close together (dense chart markers); some have no MSEL number. */
const INJECTS: ReadonlyArray<{
  ref: string | null
  title: string
  at: string
  responseAt: string | null
  responseMinutes: number | null
}> = [
  { ref: null, title: 'Pressure drop', at: '2026-10-14 16:20', responseAt: null, responseMinutes: null },
  { ref: '2', title: 'Boil-water advisory issued', at: '2026-10-15 09:04', responseAt: '2026-10-15 09:11', responseMinutes: 7 },
  { ref: null, title: 'Impersonator: brown water', at: '2026-10-15 09:12', responseAt: '2026-10-15 09:20', responseMinutes: 8 },
  { ref: '3', title: 'Hospital asks about dialysis', at: '2026-10-15 09:25', responseAt: null, responseMinutes: null },
  { ref: '4', title: 'Lookalike says "don\'t boil"', at: '2026-10-15 09:40', responseAt: '2026-10-15 09:52', responseMinutes: 12 },
  { ref: '6', title: 'School closure rumor', at: '2026-10-15 09:48', responseAt: null, responseMinutes: null },
  { ref: '9', title: 'Second break on Mill Road', at: '2026-10-15 10:06', responseAt: null, responseMinutes: null },
]

export const MOCK_REPORT: ExerciseReport = {
  exercise: {
    name: 'Fairhaven Boil-Water Advisory',
    timeZone: 'America/New_York',
    scenarioStart: '2026-10-14 16:20',
    scenarioEnd: '2026-10-15 10:30',
    conductedDate: '2026-10-14',
    preparedAt: '2026-10-15 14:30',
    latestDay: { from: '2026-10-15 00:00', to: '2026-10-15 23:59' },
    spansMultipleDays: true,
  },
  summary: {
    participants: 6,
    posts: 14,
    replies: 4,
    injectsDelivered: 7,
    medianResponseMinutes: 8,
    busiestWindow: { start: '2026-10-15 10:05', posts: 3 },
    postsEdited: 2,
    postsTakenDown: 1,
    bySource: { participant: 6, scripted: 4, engine: 1, noise: 2 },
  },
  activity: {
    binMinutes: 30,
    bins: Array.from({ length: 38 }, (_, index) => ({
      start: addMinutesToStamp(EXERCISE_START, index * 30),
      participant: index % 5 === 0 ? 1 : 0,
      scripted: index % 3 === 0 ? 1 : 0,
      engine: index % 7 === 0 ? 1 : 0,
      noise: 1,
    })),
    injectMarkers: INJECTS.map(inject => ({
      ref: inject.ref,
      title: inject.title,
      at: inject.at,
      binIndex: binIndexOf(inject.at),
    })),
  },
  injectResponses: INJECTS.map(inject => ({
    ref: inject.ref,
    title: inject.title,
    deliveredAt: inject.at,
    firstResponseAt: inject.responseAt,
    responseMinutes: inject.responseMinutes,
    respondedAsHandle: inject.responseAt === null ? null : '@KestrelCoEM',
  })),
  lookalikes: [
    // Story 32: the lookalike led on reposts, but not by 1.5x overall, so no verdict prints.
    {
      verified: { handle: '@FairhavenWater', displayName: 'Fairhaven Water Utility', verified: true, likes: 412, reposts: 230, posts: 4 },
      lookalike: { handle: '@FairhavenWaterUpd', displayName: 'Fairhaven Water Update', verified: false, likes: 288, reposts: 241, posts: 2 },
      outdrew: false,
    },
    // ... while this one clears 10 and 1.5x: "@KestrelCoEM_Alerts was reposted and liked more ...".
    {
      verified: { handle: '@KestrelCoEM', displayName: 'Kestrel County EM', verified: true, likes: 6, reposts: 2, posts: 3 },
      lookalike: { handle: '@KestrelCoEM_Alerts', displayName: 'Kestrel EM Alerts', verified: false, likes: 9, reposts: 14, posts: 1 },
      outdrew: true,
    },
  ],
  posts: LISTED_POSTS,
  omittedNoiseCount: 2,
  postRecord: {
    matching: LISTED_POSTS.length,
    limit: 5000,
    withheld: false,
    sources: ['participant', 'scripted', 'engine'],
    from: null,
    to: null,
  },
}

/**
 * The server's thread order for the listed posts: each root (a post whose parent is not listed)
 * by scenario time, followed by its listed descendants by scenario time, with `threadRootId` /
 * `depth` re-derived for THIS list (a reply to an unlisted parent becomes a root).
 */
function threaded(posts: readonly ReportPost[]): ReportPost[] {
  const byId = new Map(posts.map(item => [item.id, item]))
  const rootOf = (item: ReportPost): ReportPost => {
    let current = item
    for (;;) {
      const parent = current.parentPostId === null ? undefined : byId.get(current.parentPostId)
      if (parent === undefined) return current
      current = parent
    }
  }
  const byTime = (a: ReportPost, b: ReportPost) => a.scenarioAt.localeCompare(b.scenarioAt)
  const withRoots = posts.map(item => {
    const root = rootOf(item)
    return { ...item, threadRootId: root.id, depth: root.id === item.id ? 0 : 1 }
  })
  return withRoots
    .filter(item => item.depth === 0)
    .sort(byTime)
    .flatMap(root => [
      root,
      ...withRoots
        .filter(item => item.depth === 1 && item.threadRootId === root.id)
        .sort(byTime),
    ])
}

/** The report as the endpoint would answer for `filters` (sources, inclusive scenario window). */
export function mockReportFor(filters: ReportFilters = DEFAULT_REPORT_FILTERS): ExerciseReport {
  const sources = orderedSources(filters.sources)
  const inWindow = (stamp: string) =>
    (filters.from === null || stamp >= filters.from) && (filters.to === null || stamp <= filters.to)
  const windowed = [...LISTED_POSTS, ...NOISE_POSTS].filter(item => inWindow(item.scenarioAt))
  const posts = threaded(windowed.filter(item => sources.includes(seriesOf(item.source))))
  const stamps = windowed.map(item => item.scenarioAt).sort()
  const first = stamps[0] ?? null
  const last = stamps[stamps.length - 1] ?? null
  const isWindowed = filters.from !== null || filters.to !== null
  return {
    ...MOCK_REPORT,
    exercise: isWindowed
      ? {
        ...MOCK_REPORT.exercise,
        scenarioStart: first,
        scenarioEnd: last,
        conductedDate: first === null ? null : dateOf(first),
        spansMultipleDays: first !== null && last !== null && dateOf(first) !== dateOf(last),
      }
      : MOCK_REPORT.exercise,
    activity: {
      ...MOCK_REPORT.activity,
      injectMarkers: MOCK_REPORT.activity.injectMarkers.filter(marker => inWindow(marker.at)),
    },
    injectResponses: MOCK_REPORT.injectResponses.filter(row => inWindow(row.deliveredAt)),
    posts,
    omittedNoiseCount: sources.includes('noise') ? 0 : MOCK_REPORT.omittedNoiseCount,
    postRecord: {
      matching: posts.length,
      limit: 5000,
      withheld: false,
      sources,
      from: filters.from,
      to: filters.to,
    },
  }
}

/** Reads the wire params (`sources`, `from`, `to`) back into filters; unknown sources dropped. */
export function filtersFromParams(params: unknown): ReportFilters {
  const record = typeof params === 'object' && params !== null ? params as Record<string, unknown> : {}
  const raw = typeof record.sources === 'string' ? record.sources.split(',') : []
  const sources = SOURCE_ORDER.filter((key: ReportSourceKey) => raw.includes(key))
  return {
    sources: sources.length > 0 ? sources : DEFAULT_REPORT_FILTERS.sources,
    from: typeof record.from === 'string' ? record.from : null,
    to: typeof record.to === 'string' ? record.to : null,
  }
}

export const mockReportAdapter: AxiosAdapter = config =>
  Promise.resolve({
    data: mockReportFor(filtersFromParams(config.params)),
    status: 200,
    statusText: 'OK',
    headers: new AxiosHeaders({ 'content-type': 'application/json' }),
    config,
  })
