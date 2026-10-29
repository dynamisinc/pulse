/**
 * features/channels/mocks/fixtures.ts
 * ---------------------------------------------------------------------------
 * Canned FC-3 data for the channels mock seam (channels-foundation story 02,
 * #698): one outlet per content channel, a published article, a retracted
 * release, a revised weather product, and two alerts. Every fixture is typed
 * against the contract AND must pass its runtime guard (fixtures.test.ts), so
 * the mock can never serve a shape the live endpoint would be rejected for.
 *
 * DEMO CONFIG, not product copy (the `brandTokens.ts` status): the outlet
 * names are the FC defaults (Newsline 7, The Wire Room, The Weather Desk);
 * the story text is neutral filler. Ids are fixed so tests and Wave-2+
 * stories can address them. Every instant is SCENARIO time (COR-053); every
 * URL is host-relative (FC-9.3). No media is attached, so dev renders never
 * request an image that does not exist.
 *
 * World: both (data only).
 */

import { contentPermalink } from '../contract/permalink'
import type {
  AlertDto,
  ChannelContentDto,
  ChannelContentStaffDto,
  ChannelContentTombstoneDto,
  OutletDto,
  OutletRefDto,
} from '../contract/types'

const newsOutlet: OutletDto = {
  id: '8c1d0b56-0f61-4c43-9a51-0b7d3c2e1a01',
  channelId: 'news',
  slug: 'newsline-7',
  name: 'Newsline 7',
  tagline: 'Local news, first.',
  parentOutletId: null,
  pairedPersonaId: null,
  logo: null,
  categories: ['Local', 'Weather'],
  skinKey: 'newsline7',
  skinOverrides: null,
  homeRoute: '/news/newsline-7',
}

const pressOutlet: OutletDto = {
  id: '8c1d0b56-0f61-4c43-9a51-0b7d3c2e1a02',
  channelId: 'press',
  slug: 'wire-room',
  name: 'The Wire Room',
  tagline: null,
  parentOutletId: null,
  pairedPersonaId: null,
  logo: null,
  categories: [],
  skinKey: 'wire-room',
  skinOverrides: null,
  homeRoute: '/press/wire-room',
}

const weatherOutlet: OutletDto = {
  id: '8c1d0b56-0f61-4c43-9a51-0b7d3c2e1a03',
  channelId: 'weather',
  slug: 'weather-desk',
  name: 'The Weather Desk',
  tagline: null,
  parentOutletId: null,
  pairedPersonaId: null,
  logo: null,
  categories: [],
  skinKey: 'weather-desk',
  skinOverrides: null,
  homeRoute: '/weather/weather-desk',
}

/** One outlet per content channel. */
export const MOCK_OUTLETS: readonly OutletDto[] = [newsOutlet, pressOutlet, weatherOutlet]

function refOf(outlet: OutletDto): OutletRefDto {
  return {
    id: outlet.id,
    channelId: outlet.channelId,
    slug: outlet.slug,
    name: outlet.name,
    skinKey: outlet.skinKey,
  }
}

/** A published news article, never revised. */
export const MOCK_PUBLISHED_ARTICLE: ChannelContentDto = {
  id: 'f5b1a3c2-6d7e-4f80-9a1b-2c3d4e5f6a01',
  channelId: 'news',
  kind: 'article',
  outlet: refOf(newsOutlet),
  slug: 'emergency-call-delays',
  permalink: contentPermalink('news', 'newsline-7', 'emergency-call-delays'),
  state: 'published',
  headline: 'Emergency call wait times climb as storm moves in',
  dek: 'Dispatch centers report longer holds during the evening peak.',
  kicker: null,
  category: 'Local',
  hero: null,
  publishedScenarioTime: '2026-12-02T14:05:00Z',
  updatedScenarioTime: null,
  featured: true,
  byline: { name: 'Staff', personaId: null },
  bodyHtml: '<p>Dispatch centers across the county reported longer hold times this afternoon.</p>',
  media: [],
  revisions: [],
  pairedPostId: null,
  alertId: null,
  payload: {},
}

/** A weather product revised once (`update`): the Updated stamp has moved. */
export const MOCK_REVISED_WEATHER_PRODUCT: ChannelContentDto = {
  id: 'f5b1a3c2-6d7e-4f80-9a1b-2c3d4e5f6a03',
  channelId: 'weather',
  kind: 'weather_product',
  outlet: refOf(weatherOutlet),
  slug: 'tornado-warning-1',
  permalink: contentPermalink('weather', 'weather-desk', 'tornado-warning-1'),
  state: 'published',
  headline: 'Tornado Warning for the northern county',
  dek: 'Take shelter now in an interior room on the lowest floor.',
  kicker: null,
  category: null,
  hero: null,
  publishedScenarioTime: '2026-12-02T14:20:00Z',
  updatedScenarioTime: '2026-12-02T14:32:00Z',
  featured: false,
  byline: null,
  bodyHtml: '<p>A tornado warning is in effect until 3:15 PM.</p>',
  media: [],
  revisions: [
    { number: 2, kind: 'update', scenarioTime: '2026-12-02T14:32:00Z', note: 'Warning extended to 3:15 PM.' },
  ],
  pairedPostId: null,
  alertId: 'a7c2e9d4-1b3f-4a5c-8d6e-7f8091a2b301',
  payload: {},
}

/** A retracted press release: the tombstone carries no headline and no body. */
export const MOCK_RETRACTED_RELEASE: ChannelContentTombstoneDto = {
  id: 'f5b1a3c2-6d7e-4f80-9a1b-2c3d4e5f6a02',
  channelId: 'press',
  kind: 'release',
  outlet: refOf(pressOutlet),
  slug: 'shelter-locations-update',
  permalink: contentPermalink('press', 'wire-room', 'shelter-locations-update'),
  state: 'retracted',
  retractedScenarioTime: '2026-12-02T14:40:00Z',
}

/** The two published items, newest first. */
export const MOCK_PUBLISHED_CONTENT: readonly ChannelContentDto[] = [
  MOCK_REVISED_WEATHER_PRODUCT,
  MOCK_PUBLISHED_ARTICLE,
]

/** Two active alerts: an emergency pointing at the weather product, and a system advisory. */
export const MOCK_ALERTS: readonly AlertDto[] = [
  {
    id: 'a7c2e9d4-1b3f-4a5c-8d6e-7f8091a2b301',
    severity: 'emergency',
    message: 'Tornado Warning for the northern county until 3:15 PM',
    scenarioTime: '2026-12-02T14:20:00Z',
    href: MOCK_REVISED_WEATHER_PRODUCT.permalink,
    sourceChannel: 'weather',
    contentId: MOCK_REVISED_WEATHER_PRODUCT.id,
    expiresScenarioTime: '2026-12-02T15:15:00Z',
  },
  {
    id: 'a7c2e9d4-1b3f-4a5c-8d6e-7f8091a2b302',
    severity: 'advisory',
    message: 'Boil-water advisory in effect for the east district',
    scenarioTime: '2026-12-02T13:50:00Z',
    href: null,
    sourceChannel: null,
    contentId: null,
    expiresScenarioTime: null,
  },
]

const MOCK_ACTING_HUMAN_ID = 'mock-controller'

function staffOf(
  item: ChannelContentDto,
  overrides: Partial<ChannelContentStaffDto> = {},
): ChannelContentStaffDto {
  return {
    ...item,
    status: 'published',
    origin: 'controller',
    actingHumanId: MOCK_ACTING_HUMAN_ID,
    scheduledScenarioTime: null,
    publishedWallClock: '2026-10-29T15:05:00Z',
    background: false,
    featuredRank: item.featured ? 1 : null,
    injectId: null,
    externalSource: null,
    externalRef: null,
    revisionCount: item.revisions.length + 1,
    revisionLog: [
      { number: 1, kind: 'edit', scenarioTime: item.publishedScenarioTime, note: null },
      ...item.revisions,
    ],
    version: item.revisions.length + 1,
    ...overrides,
  }
}

/**
 * Staff views of the same three items (staff world only; preview-as-participant
 * uses the participant fixtures).
 */
export const MOCK_STAFF_CONTENT: readonly ChannelContentStaffDto[] = [
  staffOf(MOCK_REVISED_WEATHER_PRODUCT),
  staffOf(MOCK_PUBLISHED_ARTICLE),
  {
    id: MOCK_RETRACTED_RELEASE.id,
    channelId: MOCK_RETRACTED_RELEASE.channelId,
    kind: MOCK_RETRACTED_RELEASE.kind,
    outlet: MOCK_RETRACTED_RELEASE.outlet,
    slug: MOCK_RETRACTED_RELEASE.slug,
    permalink: MOCK_RETRACTED_RELEASE.permalink,
    state: 'retracted',
    headline: 'Shelter locations update',
    dek: null,
    kicker: null,
    category: null,
    hero: null,
    publishedScenarioTime: '2026-12-02T14:10:00Z',
    updatedScenarioTime: null,
    featured: false,
    byline: null,
    bodyHtml: '<p>Shelters are open at the listed locations.</p>',
    media: [],
    revisions: [],
    pairedPostId: null,
    alertId: null,
    payload: {},
    status: 'retracted',
    origin: 'participant',
    actingHumanId: 'mock-participant',
    scheduledScenarioTime: null,
    publishedWallClock: '2026-10-29T15:10:00Z',
    background: false,
    featuredRank: null,
    injectId: null,
    externalSource: null,
    externalRef: null,
    revisionCount: 1,
    revisionLog: [{ number: 1, kind: 'edit', scenarioTime: '2026-12-02T14:08:00Z', note: null }],
    version: 2,
  },
]
