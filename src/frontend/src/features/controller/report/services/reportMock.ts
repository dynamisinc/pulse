/**
 * features/controller/report/services/reportMock.ts
 * ---------------------------------------------------------------------------
 * The MOCK exercise report (demo-feedback story 29), used only when `USE_MOCK_DATA` is on (the
 * same switch the posts export uses). STAFF world, no UI.
 *
 * An axios adapter for `GET /staff/exports/report` that answers with {@link MOCK_REPORT} in the
 * frozen contract's shape, so the page, the toolbar and the noise checkbox all work with no API.
 * `includeNoise=true` adds the noise posts to the list and zeroes `omittedNoiseCount`, as the
 * real endpoint does; the metrics are identical either way. Media URLs are inline SVG data URIs
 * (no network). Tests reuse {@link MOCK_REPORT} as their fixture.
 */

import { AxiosHeaders, type AxiosAdapter } from 'axios'
import type { ExerciseReport, ReportPost } from '../types/report'

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
    likes: 14,
    replies: 2,
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
]

export const MOCK_REPORT: ExerciseReport = {
  exercise: {
    name: 'Fairhaven Boil-Water Advisory',
    timeZone: 'America/New_York',
    scenarioStart: '2026-10-15 09:00',
    scenarioEnd: '2026-10-15 11:00',
    conductedDate: '2026-10-15',
    preparedAt: '2026-10-15 14:30',
  },
  summary: {
    participants: 6,
    posts: 10,
    replies: 1,
    injectsDelivered: 3,
    medianResponseMinutes: 8,
    busiestWindow: { start: '2026-10-15 10:05', posts: 3 },
    postsEdited: 2,
    postsTakenDown: 1,
    bySource: { participant: 3, scripted: 3, engine: 2, noise: 2 },
  },
  activity: {
    binMinutes: 5,
    bins: Array.from({ length: 24 }, (_, index) => {
      const total = 9 * 60 + index * 5
      const hh = String(Math.floor(total / 60)).padStart(2, '0')
      const mm = String(total % 60).padStart(2, '0')
      return {
        start: `2026-10-15 ${hh}:${mm}`,
        participant: index % 5 === 0 ? 1 : 0,
        scripted: index % 3 === 0 ? 1 : 0,
        engine: index % 7 === 0 ? 1 : 0,
        noise: 1,
      }
    }),
    injectMarkers: [
      { ref: '4', title: 'Lookalike rumor', at: '2026-10-15 09:40', binIndex: 8 },
      { ref: '9', title: 'Mill Rd break', at: '2026-10-15 10:06', binIndex: 13 },
    ],
  },
  injectResponses: [
    {
      ref: '2',
      title: 'Boil-water advisory issued',
      deliveredAt: '2026-10-15 09:04',
      firstResponseAt: '2026-10-15 09:11',
      responseMinutes: 7,
      respondedAsHandle: '@KestrelCoEM',
    },
    {
      ref: '4',
      title: 'Lookalike says "don\'t boil"',
      deliveredAt: '2026-10-15 09:40',
      firstResponseAt: '2026-10-15 09:52',
      responseMinutes: 12,
      respondedAsHandle: '@KestrelCoEM',
    },
    {
      ref: '9',
      title: 'Second break on Mill Road',
      deliveredAt: '2026-10-15 10:06',
      firstResponseAt: null,
      responseMinutes: null,
      respondedAsHandle: null,
    },
  ],
  lookalikes: [
    {
      verified: { handle: '@FairhavenWater', displayName: 'Fairhaven Water Utility', verified: true, likes: 412, reposts: 230 },
      lookalike: { handle: '@FairhavenWaterUpd', displayName: 'Fairhaven Water Update', verified: false, likes: 288, reposts: 241 },
    },
  ],
  posts: LISTED_POSTS,
  omittedNoiseCount: 2,
}

/** The report as the endpoint would answer for `includeNoise`. */
export function mockReportFor(includeNoise: boolean): ExerciseReport {
  if (!includeNoise) return MOCK_REPORT
  const posts = [...LISTED_POSTS, ...NOISE_POSTS]
    .sort((a, b) => a.scenarioAt.localeCompare(b.scenarioAt))
  return { ...MOCK_REPORT, posts, omittedNoiseCount: 0 }
}

export const mockReportAdapter: AxiosAdapter = config =>
  Promise.resolve({
    data: mockReportFor(config.params?.includeNoise === true),
    status: 200,
    statusText: 'OK',
    headers: new AxiosHeaders({ 'content-type': 'application/json' }),
    config,
  })
