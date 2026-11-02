/**
 * features/press/mocks/fixtures.ts
 * ---------------------------------------------------------------------------
 * Canned press-room fixtures (press-room story 01, #738; PC-5 `mocks/`): the
 * org newsrooms a human may release as (`GET /api/press/orgs`), and a release
 * in every state the author surfaces and the participant permalink render:
 *
 * - published    — BOTH the participant `ChannelContentDto` (kind `release`,
 *                  participant-safe payload) AND the author DTO.
 * - embargoed    — author DTO, state `scheduled`, `scheduledScenarioTime` set.
 * - returned     — author DTO with a `returnNote`.
 * - pending      — author DTO, state `pending_approval` (an approval-required org).
 * - retracted    — the FC-3 `ChannelContentTombstoneDto` (XC-010).
 *
 * Two fictional orgs: "Fulton County EM" (a full letterhead: logo, address,
 * default contact) and "Harbor Point Fire Rescue" (NEUTRAL: logo, address and
 * default contact all null, never a platform-branded letterhead). Both are
 * invented for the fixtures; no real agency is named.
 *
 * Every fixture is typed against the contract AND passes its runtime guard
 * (fixtures.test.ts). Every instant is a fixed SCENARIO-time ISO string with an
 * offset (COR-053): no `Date.now()`, no `new Date()`. Permalinks and media URLs
 * are host-relative (FC-9.3). No fixture carries an exercise id.
 *
 * World: participant (data only). No React, no MUI.
 */

import { contentPermalink } from '@/features/channels/contract'
import type {
  ChannelContentDto,
  ChannelContentTombstoneDto,
  ContentMediaDto,
  OutletRefDto,
} from '@/features/channels/contract'
import type {
  ReleaseAuthorDto,
  ReleaseOrgDto,
  ReleaseParticipantPayloadDto,
} from '../contract/types'

type PressOutletRef = OutletRefDto & { readonly channelId: 'press' }

// --- orgs -----------------------------------------------------------------------

const FULTON_PERSONA_ID = '2f6b1d90-3a4c-4e5f-8a7b-9c0d1e2f3a01'
const HARBOR_PERSONA_ID = '2f6b1d90-3a4c-4e5f-8a7b-9c0d1e2f3a02'

export const FULTON_OUTLET: PressOutletRef = {
  id: '4b7e2a10-6c3d-4f8e-9a1b-2c3d4e5f6a01',
  channelId: 'press',
  slug: 'fulton-county-em',
  name: 'Fulton County EM',
  skinKey: 'org-newsroom',
}

export const HARBOR_OUTLET: PressOutletRef = {
  id: '4b7e2a10-6c3d-4f8e-9a1b-2c3d4e5f6a02',
  channelId: 'press',
  slug: 'harbor-point-fire-rescue',
  name: 'Harbor Point Fire Rescue',
  skinKey: 'org-newsroom',
}

export const FULTON_LOGO: ContentMediaDto = {
  id: '6d9f3b20-8e5a-4a7c-b1d2-3e4f5a6b7c01',
  kind: 'image',
  role: 'hero',
  url: '/media/6d9f3b20-8e5a-4a7c-b1d2-3e4f5a6b7c01',
  posterUrl: null,
  contentType: 'image/png',
  width: 320,
  height: 96,
  durationSec: null,
  alt: 'Fulton County Emergency Management',
  caption: null,
}

export const MOCK_RELEASE_DOCUMENT_MEDIA: ContentMediaDto = {
  id: '6d9f3b20-8e5a-4a7c-b1d2-3e4f5a6b7c02',
  kind: 'document',
  role: 'attachment',
  url: '/media/6d9f3b20-8e5a-4a7c-b1d2-3e4f5a6b7c02',
  posterUrl: null,
  contentType: 'application/pdf',
  width: null,
  height: null,
  durationSec: null,
  alt: 'Shelter locations (PDF)',
  caption: null,
}

/** An org with a full letterhead: logo, address and a default press contact. */
export const MOCK_FULTON_ORG: ReleaseOrgDto = {
  personaId: FULTON_PERSONA_ID,
  outletId: FULTON_OUTLET.id,
  name: FULTON_OUTLET.name,
  handle: '@FultonCountyEM',
  pairedHandle: '@FultonCountyEM',
  letterhead: {
    logo: FULTON_LOGO,
    address: '141 Pryor Street, Fairhaven, GA 30303',
    defaultContact: {
      name: 'Dana Whitfield',
      title: 'Public Information Officer',
      phone: '404-555-0142',
      email: 'pio@fultonem.example',
    },
  },
  approvalRequired: false,
}

/** An org with NO letterhead configured: neutral, every field null, approval required. */
export const MOCK_HARBOR_ORG: ReleaseOrgDto = {
  personaId: HARBOR_PERSONA_ID,
  outletId: HARBOR_OUTLET.id,
  name: HARBOR_OUTLET.name,
  handle: '@HarborPointFR',
  pairedHandle: null,
  letterhead: { logo: null, address: null, defaultContact: null },
  approvalRequired: true,
}

// --- releases -------------------------------------------------------------------

const PUBLISHED_ID = '9a1c4e30-2b5d-4c6e-8f7a-0b1c2d3e4f01'
const PUBLISHED_SLUG = 'shelters-open-north-county'
const PUBLISHED_AT = '2026-12-02T14:25:00-06:00'

const PUBLISHED_CONTACT = {
  name: 'Dana Whitfield',
  title: 'Public Information Officer',
  phone: '404-555-0142',
  email: 'pio@fultonem.example',
} as const

const PUBLISHED_DOCUMENT = {
  mediaId: MOCK_RELEASE_DOCUMENT_MEDIA.id,
  fileName: 'shelter-locations.pdf',
  sizeBytes: 184320,
} as const

const PUBLISHED_BODY_HTML =
  '<p>Fulton County Emergency Management has opened two shelters for residents displaced by ' +
  'tonight\'s storm. Residents should bring medications and identification.</p>'

/** The participant-safe payload of the published release: exactly the four participant keys. */
export const MOCK_PUBLISHED_PARTICIPANT_PAYLOAD: ReleaseParticipantPayloadDto = {
  org: { name: FULTON_OUTLET.name, outletId: FULTON_OUTLET.id },
  contact: PUBLISHED_CONTACT,
  dateline: 'FAIRHAVEN, Ga.',
  document: PUBLISHED_DOCUMENT,
}

/** The participant permalink read of the published release (FC-3 content of kind `release`). */
export const MOCK_PUBLISHED_RELEASE_CONTENT: ChannelContentDto = {
  id: PUBLISHED_ID,
  channelId: 'press',
  kind: 'release',
  outlet: FULTON_OUTLET,
  slug: PUBLISHED_SLUG,
  permalink: contentPermalink('press', FULTON_OUTLET.slug, PUBLISHED_SLUG),
  state: 'published',
  headline: 'County opens two emergency shelters',
  dek: 'Shelters at Riverside High and the Eastside Recreation Center are open now.',
  kicker: null,
  category: null,
  hero: null,
  publishedScenarioTime: PUBLISHED_AT,
  updatedScenarioTime: null,
  featured: false,
  byline: null,
  bodyHtml: PUBLISHED_BODY_HTML,
  media: [MOCK_RELEASE_DOCUMENT_MEDIA],
  revisions: [],
  pairedPostId: null,
  alertId: null,
  // Spread: an interface has no implicit index signature, so it is not a `JsonObject` as-is.
  payload: { ...MOCK_PUBLISHED_PARTICIPANT_PAYLOAD },
}

/** The author view of the same published release. */
export const MOCK_PUBLISHED_RELEASE_AUTHOR: ReleaseAuthorDto = {
  id: PUBLISHED_ID,
  orgPersonaId: FULTON_PERSONA_ID,
  state: 'published',
  headline: MOCK_PUBLISHED_RELEASE_CONTENT.headline,
  bodyHtml: PUBLISHED_BODY_HTML,
  payload: {
    orgPersonaId: FULTON_PERSONA_ID,
    inputPath: 'both',
    contact: PUBLISHED_CONTACT,
    dateline: 'FAIRHAVEN, Ga.',
    document: PUBLISHED_DOCUMENT,
    boilerplate: 'About Fulton County EM: the county agency that plans for and responds to emergencies.',
    crossPost: { text: null },
  },
  media: [MOCK_RELEASE_DOCUMENT_MEDIA],
  scheduledScenarioTime: null,
  updatedScenarioTime: PUBLISHED_AT,
  lastEditedBy: { displayName: 'Dana Whitfield' },
  returnNote: null,
  permalink: MOCK_PUBLISHED_RELEASE_CONTENT.permalink,
  version: 3,
  revisions: [],
}

/** Embargoed: `scheduled` for a later scenario time. */
export const MOCK_EMBARGOED_RELEASE_AUTHOR: ReleaseAuthorDto = {
  id: '9a1c4e30-2b5d-4c6e-8f7a-0b1c2d3e4f02',
  orgPersonaId: FULTON_PERSONA_ID,
  state: 'scheduled',
  headline: 'Boil-water advisory to lift Wednesday morning',
  bodyHtml: '<p>The advisory for the Eastside service area will be lifted once testing is complete.</p>',
  payload: {
    orgPersonaId: FULTON_PERSONA_ID,
    inputPath: 'rich',
    contact: PUBLISHED_CONTACT,
    dateline: 'FAIRHAVEN, Ga.',
    document: null,
    boilerplate: null,
    crossPost: { text: 'Boil-water advisory update from Fulton County EM.' },
  },
  media: [],
  scheduledScenarioTime: '2026-12-03T06:00:00-06:00',
  updatedScenarioTime: '2026-12-02T16:10:00-06:00',
  lastEditedBy: { displayName: 'Dana Whitfield' },
  returnNote: null,
  permalink: '/press/fulton-county-em/boil-water-advisory-lifts',
  version: 2,
  revisions: [],
}

/** Returned: an approver sent it back with a note (an approval-required org). */
export const MOCK_RETURNED_RELEASE_AUTHOR: ReleaseAuthorDto = {
  id: '9a1c4e30-2b5d-4c6e-8f7a-0b1c2d3e4f03',
  orgPersonaId: HARBOR_PERSONA_ID,
  state: 'returned',
  headline: 'Fire crews respond to warehouse blaze on Dock Road',
  bodyHtml: '<p>Crews from three stations are on scene. No injuries have been reported.</p>',
  payload: {
    orgPersonaId: HARBOR_PERSONA_ID,
    inputPath: 'rich',
    contact: null,
    dateline: null,
    document: null,
    boilerplate: null,
    crossPost: null,
  },
  media: [],
  scheduledScenarioTime: null,
  updatedScenarioTime: '2026-12-02T15:05:00-06:00',
  lastEditedBy: { displayName: 'Marcus Reyes' },
  returnNote: {
    text: 'Add the press contact and confirm the injury count before this goes out.',
    byDisplayName: 'Chief Alana Pierce',
    scenarioTime: '2026-12-02T15:12:00-06:00',
  },
  permalink: null,
  version: 4,
  revisions: [],
}

/** Pending approval: submitted by an author of an approval-required org. */
export const MOCK_PENDING_RELEASE_AUTHOR: ReleaseAuthorDto = {
  id: '9a1c4e30-2b5d-4c6e-8f7a-0b1c2d3e4f04',
  orgPersonaId: HARBOR_PERSONA_ID,
  state: 'pending_approval',
  headline: 'Harbor Point Fire Rescue urges residents to avoid Dock Road',
  bodyHtml: '<p>Dock Road is closed between Pier 4 and Harbor Avenue while crews work.</p>',
  payload: {
    orgPersonaId: HARBOR_PERSONA_ID,
    inputPath: 'rich',
    contact: { name: 'Marcus Reyes', title: null, phone: '404-555-0177', email: null },
    dateline: 'HARBOR POINT, Ga.',
    document: null,
    boilerplate: null,
    crossPost: null,
  },
  media: [],
  scheduledScenarioTime: null,
  updatedScenarioTime: '2026-12-02T15:40:00-06:00',
  lastEditedBy: { displayName: 'Marcus Reyes' },
  returnNote: null,
  permalink: null,
  version: 1,
  revisions: [],
}

/** The retracted release's permalink read (XC-010): no headline, no body. */
export const MOCK_RETRACTED_RELEASE_TOMBSTONE: ChannelContentTombstoneDto = {
  id: '9a1c4e30-2b5d-4c6e-8f7a-0b1c2d3e4f05',
  channelId: 'press',
  kind: 'release',
  outlet: FULTON_OUTLET,
  slug: 'road-closure-route-9',
  permalink: contentPermalink('press', FULTON_OUTLET.slug, 'road-closure-route-9'),
  state: 'retracted',
  retractedScenarioTime: '2026-12-02T17:30:00-06:00',
}

// --- scenarios ------------------------------------------------------------------

export const PRESS_SCENARIO_KEYS = ['activeNewsrooms', 'noOrgs'] as const
export type PressScenarioKey = (typeof PRESS_SCENARIO_KEYS)[number]

/** One press moment: what the author routes serve. */
export interface PressScenario {
  readonly key: PressScenarioKey
  /** `GET /api/press/orgs`. */
  readonly orgs: readonly ReleaseOrgDto[]
  /** `GET /api/press/releases`, newest edit first; `/{id}` serves one. */
  readonly releases: readonly ReleaseAuthorDto[]
}

/** Every scenario, by key. */
export const PRESS_SCENARIOS: Readonly<Record<PressScenarioKey, PressScenario>> = {
  activeNewsrooms: {
    key: 'activeNewsrooms',
    orgs: [MOCK_FULTON_ORG, MOCK_HARBOR_ORG],
    releases: [
      MOCK_PENDING_RELEASE_AUTHOR,
      MOCK_EMBARGOED_RELEASE_AUTHOR,
      MOCK_RETURNED_RELEASE_AUTHOR,
      MOCK_PUBLISHED_RELEASE_AUTHOR,
    ],
  },
  noOrgs: { key: 'noOrgs', orgs: [], releases: [] },
}
