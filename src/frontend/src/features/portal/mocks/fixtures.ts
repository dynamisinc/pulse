/**
 * features/portal/mocks/fixtures.ts
 * ---------------------------------------------------------------------------
 * Canned PC-3 portal scenarios (exercise-portal story 02, #768; PC-5
 * `mocks/`). Each scenario is a whole portal moment: the `/api/portal` and
 * `/api/portal/resources` bodies the mock adapter serves, plus the FC-3
 * module inputs a module or the kiosk board renders (top stories, press,
 * weather, alerts, the social stream). The module inputs are DATA for tests
 * and harnesses (07's subset harness, 09-12, 19, 23); the live modules read
 * them through their own channel seams.
 *
 * - `normalDay` — the Staged / quiet portal: filler only, calm weather, no
 *   alert, a slow social stream.
 * - `incidentDay` — a pinned (featured rank 1) breaking lead, an emergency
 *   alert, a busy stream (120 posts in one scenario minute, the SOC-071 /
 *   NFR-002 burst rate).
 * - `noResources` — the quiet portal with an empty shelf.
 * - `kioskLite` — the incident portal in the kiosk variant, after the lead
 *   was RETRACTED (its tombstone and the `ContentRetracted` frame included).
 * - `portalForChannels()` / `PORTAL_MODULE_SUBSETS` — every subset of the four
 *   source channels (news, social, press, weather), with the modules the
 *   server would keep for it.
 *
 * Every fixture is typed against the contract AND passes its runtime guard
 * (fixtures.test.ts). Every instant is SCENARIO time (COR-053); no fixture
 * holds an absolute URL or a hostname (FC-9.3, a tripwire test). No media is
 * attached, so dev renders never request an image that does not exist.
 * DEMO CONFIG, not product copy: "Fairhaven" is the seeded social city.
 *
 * World: both (data only).
 */

import { contentPermalink } from '@/features/channels/contract'
import type {
  AlertDto,
  ChannelContentSummaryDto,
  ChannelContentTombstoneDto,
  ChannelId,
  ContentChannelId,
  ContentKind,
  ContentRetractedDto,
  OutletRefDto,
} from '@/features/channels/contract'
import type { ParticipantPostView } from '@/features/social'
import { PORTAL_DEFAULT_MODULE_ORDER, PORTAL_MODULE_CHANNELS } from '../contract/vocabulary'
import type { PortalDto, PortalModuleDto, PortalResourceDto } from '../contract/types'

// --- outlets (the FC defaults, same ids as the channels fixtures) -------------

/** An outlet of a content channel (the only ones with permalinks). */
type ContentOutletRef = OutletRefDto & { readonly channelId: ContentChannelId }

const NEWS_OUTLET: ContentOutletRef = {
  id: '8c1d0b56-0f61-4c43-9a51-0b7d3c2e1a01', channelId: 'news', slug: 'newsline-7', name: 'Newsline 7',
  skinKey: 'newsline7',
}
const PRESS_OUTLET: ContentOutletRef = {
  id: '8c1d0b56-0f61-4c43-9a51-0b7d3c2e1a02', channelId: 'press', slug: 'wire-room', name: 'The Wire Room',
  skinKey: 'wire-room',
}
const WEATHER_OUTLET: ContentOutletRef = {
  id: '8c1d0b56-0f61-4c43-9a51-0b7d3c2e1a03', channelId: 'weather', slug: 'weather-desk', name: 'The Weather Desk',
  skinKey: 'weather-desk',
}

interface SummaryInput {
  readonly id: string
  readonly outlet: ContentOutletRef
  readonly kind: ContentKind
  readonly slug: string
  readonly headline: string
  readonly dek?: string
  readonly kicker?: string
  readonly category?: string
  readonly publishedScenarioTime: string
  readonly featured?: boolean
}

function summary(input: SummaryInput): ChannelContentSummaryDto {
  return {
    id: input.id,
    channelId: input.outlet.channelId,
    kind: input.kind,
    outlet: input.outlet,
    slug: input.slug,
    permalink: contentPermalink(input.outlet.channelId, input.outlet.slug, input.slug),
    state: 'published',
    headline: input.headline,
    dek: input.dek ?? null,
    kicker: input.kicker ?? null,
    category: input.category ?? null,
    hero: null,
    publishedScenarioTime: input.publishedScenarioTime,
    updatedScenarioTime: null,
    featured: input.featured ?? false,
  }
}

// --- the portal composition ---------------------------------------------------

/** The four source channels a subset is drawn from (social carries two modules). */
export const PORTAL_SOURCE_CHANNELS = ['news', 'social', 'press', 'weather'] as const satisfies readonly ChannelId[]
export type PortalSourceChannel = (typeof PORTAL_SOURCE_CHANNELS)[number]

/** The modules the server keeps when exactly `enabled` channels are on, in default order. */
export function modulesForChannels(enabled: readonly ChannelId[]): PortalModuleDto[] {
  return PORTAL_DEFAULT_MODULE_ORDER
    .filter(id => enabled.includes(PORTAL_MODULE_CHANNELS[id]))
    .map(id => ({ id, channelId: PORTAL_MODULE_CHANNELS[id] }) as PortalModuleDto)
}

const ALL_MODULES = modulesForChannels(PORTAL_SOURCE_CHANNELS)

const BASE_PORTAL: PortalDto = {
  masthead: { name: 'Fairhaven Today', tagline: 'Your city, every hour.', logo: null },
  layoutKey: 'anchor',
  modules: ALL_MODULES,
  skinOverrides: null,
  hasResources: true,
}

/** The default portal with exactly `enabled` source channels on (PRT-003 clean hiding). */
export function portalForChannels(enabled: readonly ChannelId[]): PortalDto {
  return { ...BASE_PORTAL, modules: modulesForChannels(enabled) }
}

/** Every subset of the four source channels (16, the empty set included), smallest first. */
export const PORTAL_MODULE_SUBSETS: readonly (readonly PortalSourceChannel[])[] = Array.from(
  { length: 1 << PORTAL_SOURCE_CHANNELS.length },
  (_, mask) => PORTAL_SOURCE_CHANNELS.filter((_, bit) => (mask & (1 << bit)) !== 0),
).sort((a, b) => a.length - b.length)

// --- resources ------------------------------------------------------------------

export const MOCK_PORTAL_RESOURCES: readonly PortalResourceDto[] = [
  {
    id: '3e9a7c10-52d4-4b1e-9f2a-6c8d0e1f2a01',
    title: 'Emergency contacts',
    summary: 'Non-emergency lines, utilities and the county information line.',
    bodyHtml: '<p>County information line: 311. Water utility outages: see the utility page.</p>',
    media: null,
  },
  {
    id: '3e9a7c10-52d4-4b1e-9f2a-6c8d0e1f2a02',
    title: 'Shelter and cooling centers',
    summary: null,
    bodyHtml: '<p>Open shelters are listed on the <a href="/press/wire-room">Wire Room</a>.</p>',
    media: null,
  },
]

// --- normal day / Staged --------------------------------------------------------

const QUIET_TOP_STORIES: readonly ChannelContentSummaryDto[] = [
  summary({
    id: '5a0c2e41-7b8d-4c9e-a0f1-2b3c4d5e6f01', outlet: NEWS_OUTLET, kind: 'article', slug: 'farmers-market-opens',
    headline: 'Riverside farmers market opens for the season', category: 'Local',
    publishedScenarioTime: '2026-12-02T08:40:00Z', featured: true,
  }),
  summary({
    id: '5a0c2e41-7b8d-4c9e-a0f1-2b3c4d5e6f02', outlet: NEWS_OUTLET, kind: 'article', slug: 'library-hours-extended',
    headline: 'Library extends weekend hours', category: 'Local',
    publishedScenarioTime: '2026-12-02T08:10:00Z', featured: true,
  }),
  summary({
    id: '5a0c2e41-7b8d-4c9e-a0f1-2b3c4d5e6f03', outlet: NEWS_OUTLET, kind: 'article', slug: 'school-board-recap',
    headline: 'School board approves new bus routes', category: 'Education',
    publishedScenarioTime: '2026-12-02T07:55:00Z', featured: true,
  }),
  summary({
    id: '5a0c2e41-7b8d-4c9e-a0f1-2b3c4d5e6f04', outlet: NEWS_OUTLET, kind: 'article', slug: 'high-school-football',
    headline: 'Eagles advance to the regional final', category: 'Sports',
    publishedScenarioTime: '2026-12-02T07:30:00Z', featured: true,
  }),
]

const QUIET_PRESS: readonly ChannelContentSummaryDto[] = [
  summary({
    id: '5a0c2e41-7b8d-4c9e-a0f1-2b3c4d5e6f11', outlet: PRESS_OUTLET, kind: 'release', slug: 'road-resurfacing',
    headline: 'Public Works schedules Main Street resurfacing', publishedScenarioTime: '2026-12-02T08:30:00Z',
  }),
  summary({
    id: '5a0c2e41-7b8d-4c9e-a0f1-2b3c4d5e6f12', outlet: PRESS_OUTLET, kind: 'release', slug: 'leaf-collection',
    headline: 'Curbside leaf collection begins Monday', publishedScenarioTime: '2026-12-02T07:45:00Z',
  }),
]

const CALM_WEATHER: readonly ChannelContentSummaryDto[] = [
  summary({
    id: '5a0c2e41-7b8d-4c9e-a0f1-2b3c4d5e6f21', outlet: WEATHER_OUTLET, kind: 'forecast', slug: 'forecast-dec-2',
    headline: 'Partly cloudy, high of 54', dek: 'Light winds, no precipitation expected.',
    publishedScenarioTime: '2026-12-02T06:00:00Z',
  }),
]

function post(
  id: string, handle: string, text: string, scenarioTime: string, like = 0,
): ParticipantPostView {
  return {
    id,
    authorPersonaId: `persona-${handle.toLowerCase()}`,
    text,
    counts: { reply: 0, repost: 0, like },
    scenarioTime,
  }
}

const CALM_STREAM: readonly ParticipantPostView[] = [
  post('7d1e3f50-0a1b-4c2d-8e3f-4a5b6c7d8e01', 'mvega_fh', 'Market is packed already this morning', '2026-12-02T08:52:00Z', 4),
  post('7d1e3f50-0a1b-4c2d-8e3f-4a5b6c7d8e02', 'kwardFH', 'Anyone know if the library cafe is open?', '2026-12-02T08:31:00Z', 1),
  post('7d1e3f50-0a1b-4c2d-8e3f-4a5b6c7d8e03', 'Newsline7', 'Go Eagles! Regional final this Friday.', '2026-12-02T07:35:00Z', 12),
]

// --- incident day -----------------------------------------------------------------

/** The breaking lead: featured, newest, rank 1 (the pinned lead). */
export const MOCK_INCIDENT_LEAD: ChannelContentSummaryDto = summary({
  id: '5a0c2e41-7b8d-4c9e-a0f1-2b3c4d5e6f31', outlet: NEWS_OUTLET, kind: 'article', slug: 'tornado-touches-down',
  headline: 'Tornado touches down north of Fairhaven', kicker: 'BREAKING',
  dek: 'Damage reported along Route 9; crews are responding.', category: 'Local',
  publishedScenarioTime: '2026-12-02T14:22:00Z', featured: true,
})

const INCIDENT_TOP_STORIES: readonly ChannelContentSummaryDto[] = [
  MOCK_INCIDENT_LEAD,
  summary({
    id: '5a0c2e41-7b8d-4c9e-a0f1-2b3c4d5e6f32', outlet: NEWS_OUTLET, kind: 'article', slug: 'power-outages-climb',
    headline: 'Power outages climb past 8,000 customers', category: 'Local',
    publishedScenarioTime: '2026-12-02T14:18:00Z', featured: true,
  }),
  summary({
    id: '5a0c2e41-7b8d-4c9e-a0f1-2b3c4d5e6f33', outlet: NEWS_OUTLET, kind: 'article', slug: 'schools-shelter-in-place',
    headline: 'Schools shelter in place as storm passes', category: 'Education',
    publishedScenarioTime: '2026-12-02T14:12:00Z', featured: true,
  }),
  ...QUIET_TOP_STORIES.slice(0, 1),
]

const INCIDENT_PRESS: readonly ChannelContentSummaryDto[] = [
  summary({
    id: '5a0c2e41-7b8d-4c9e-a0f1-2b3c4d5e6f41', outlet: PRESS_OUTLET, kind: 'release', slug: 'eoc-activated',
    headline: 'County activates the Emergency Operations Center', publishedScenarioTime: '2026-12-02T14:25:00Z',
  }),
  summary({
    id: '5a0c2e41-7b8d-4c9e-a0f1-2b3c4d5e6f42', outlet: PRESS_OUTLET, kind: 'release', slug: 'shelters-open',
    headline: 'Two emergency shelters open', publishedScenarioTime: '2026-12-02T14:20:00Z',
  }),
  ...QUIET_PRESS,
]

const WARNING_WEATHER: readonly ChannelContentSummaryDto[] = [
  summary({
    id: '5a0c2e41-7b8d-4c9e-a0f1-2b3c4d5e6f51', outlet: WEATHER_OUTLET, kind: 'weather_product', slug: 'tornado-warning-1',
    headline: 'Tornado Warning for the northern county', dek: 'Take shelter now in an interior room.',
    publishedScenarioTime: '2026-12-02T14:20:00Z',
  }),
]

export const MOCK_EMERGENCY_ALERT: AlertDto = {
  id: 'a7c2e9d4-1b3f-4a5c-8d6e-7f8091a2b311',
  severity: 'emergency',
  message: 'Tornado Warning for the northern county until 3:15 PM. Take shelter now.',
  scenarioTime: '2026-12-02T14:20:00Z',
  href: '/weather/weather-desk/tornado-warning-1',
  sourceChannel: 'weather',
  contentId: '5a0c2e41-7b8d-4c9e-a0f1-2b3c4d5e6f51',
  expiresScenarioTime: '2026-12-02T15:15:00Z',
}

/** The burst rate feeds must stay legible at (SOC-071, NFR-002): posts per scenario minute. */
export const BUSY_STREAM_POSTS_PER_MINUTE = 120

const BUSY_HANDLES = ['mvega_fh', 'kwardFH', 'FulcoEM', 'Newsline7', 'FairhavenWater'] as const
const BUSY_LINES = [
  'Sirens going off on the north side right now',
  'Is Route 9 closed? Seeing a lot of trucks',
  'Power just went out on Elm',
  'Anyone have shelter info??',
  'Trees down by the high school',
] as const

/** 120 posts, newest first, one every half scenario second from 14:23:00 to 14:23:59.5. */
const BUSY_STREAM: readonly ParticipantPostView[] = Array.from(
  { length: BUSY_STREAM_POSTS_PER_MINUTE },
  (_, i) => {
    const n = BUSY_STREAM_POSTS_PER_MINUTE - 1 - i
    const instant = new Date(Date.parse('2026-12-02T14:23:00.000Z') + n * 500).toISOString()
    const id = `7d1e3f50-0a1b-4c2d-8e3f-${(0x100 + n).toString(16).padStart(12, '0')}`
    const handle = BUSY_HANDLES[n % BUSY_HANDLES.length] ?? BUSY_HANDLES[0]
    const line = BUSY_LINES[n % BUSY_LINES.length] ?? BUSY_LINES[0]
    return post(id, handle, line, instant, n % 7)
  },
)

// --- scenarios ---------------------------------------------------------------------

export const PORTAL_SCENARIO_KEYS = ['normalDay', 'incidentDay', 'noResources', 'kioskLite'] as const
export type PortalScenarioKey = (typeof PORTAL_SCENARIO_KEYS)[number]

/** One portal moment: what the portal routes serve and what the modules render. */
export interface PortalScenario {
  readonly key: PortalScenarioKey
  /** `kiosk` renders the same fixtures in the kiosk-lite variant (`/portal?display=1`). */
  readonly variant: 'standard' | 'kiosk'
  /** `GET /api/portal`. */
  readonly portal: PortalDto
  /** `GET /api/portal/resources`, in shelf order. */
  readonly resources: readonly PortalResourceDto[]
  /** The featured news list, lead first (`useContentList` with `featured: true`). */
  readonly topStories: readonly ChannelContentSummaryDto[]
  /** The latest press releases, newest first. */
  readonly pressLatest: readonly ChannelContentSummaryDto[]
  /** The latest weather products, newest first. */
  readonly weather: readonly ChannelContentSummaryDto[]
  /** The active alerts (`AlertsChangedDto.alerts`). */
  readonly alerts: readonly AlertDto[]
  /** The public social stream, newest first. */
  readonly socialPosts: readonly ParticipantPostView[]
  /** Items retracted in this moment: the permalink read's tombstone ... */
  readonly retracted: readonly ChannelContentTombstoneDto[]
  /** ... and the `ContentRetracted` frame a live view received. */
  readonly retractedFrames: readonly ContentRetractedDto[]
}

const NORMAL_DAY: PortalScenario = {
  key: 'normalDay',
  variant: 'standard',
  portal: BASE_PORTAL,
  resources: MOCK_PORTAL_RESOURCES,
  topStories: QUIET_TOP_STORIES,
  pressLatest: QUIET_PRESS,
  weather: CALM_WEATHER,
  alerts: [],
  socialPosts: CALM_STREAM,
  retracted: [],
  retractedFrames: [],
}

const INCIDENT_DAY: PortalScenario = {
  key: 'incidentDay',
  variant: 'standard',
  portal: BASE_PORTAL,
  resources: MOCK_PORTAL_RESOURCES,
  topStories: INCIDENT_TOP_STORIES,
  pressLatest: INCIDENT_PRESS,
  weather: WARNING_WEATHER,
  alerts: [MOCK_EMERGENCY_ALERT],
  socialPosts: BUSY_STREAM,
  retracted: [],
  retractedFrames: [],
}

const LEAD_RETRACTED_AT = '2026-12-02T14:31:00Z'

const KIOSK_LITE: PortalScenario = {
  ...INCIDENT_DAY,
  key: 'kioskLite',
  variant: 'kiosk',
  topStories: INCIDENT_TOP_STORIES.filter(s => s.id !== MOCK_INCIDENT_LEAD.id),
  retracted: [
    {
      id: MOCK_INCIDENT_LEAD.id,
      channelId: MOCK_INCIDENT_LEAD.channelId,
      kind: MOCK_INCIDENT_LEAD.kind,
      outlet: MOCK_INCIDENT_LEAD.outlet,
      slug: MOCK_INCIDENT_LEAD.slug,
      permalink: MOCK_INCIDENT_LEAD.permalink,
      state: 'retracted',
      retractedScenarioTime: LEAD_RETRACTED_AT,
    },
  ],
  retractedFrames: [
    {
      id: MOCK_INCIDENT_LEAD.id,
      channelId: MOCK_INCIDENT_LEAD.channelId,
      permalink: MOCK_INCIDENT_LEAD.permalink,
      retractedScenarioTime: LEAD_RETRACTED_AT,
    },
  ],
}

/** Every scenario, by key. */
export const PORTAL_SCENARIOS: Readonly<Record<PortalScenarioKey, PortalScenario>> = {
  normalDay: NORMAL_DAY,
  incidentDay: INCIDENT_DAY,
  noResources: { ...NORMAL_DAY, key: 'noResources', portal: { ...BASE_PORTAL, hasResources: false }, resources: [] },
  kioskLite: KIOSK_LITE,
}
