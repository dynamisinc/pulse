/**
 * features/evaluator/services/stageContent.ts
 * ---------------------------------------------------------------------------
 * Read-only reproduction of the Pulse/Portal participant stage at a given
 * scenario moment `t` (minutes elapsed). Powers both `WorldView` (pinned to
 * "now") and the replay stage (scrubbable across the whole arc) — the same
 * five-segment Fairhaven story used in the reference mockup's `stageFor()`.
 *
 * Fidelity note (D6-006): ordering is exact; the `trend` figure is a derived
 * snapshot and must always render with an amber "≈" mark, never as fact.
 *
 * TODO(backend): replace with a query against the replay-bundle API
 * (EVL-003) once it exists — this arc-segment model is mock-only.
 */

import type { StageContent, StagePost } from '../types'

interface PortalSegment {
  kicker: string;
  headline: string;
  dek: string;
  row1: string;
  row2: string;
}

const PORTAL_SEGMENTS: PortalSegment[] = [
  { kicker: 'LOCAL', headline: 'Riverfront festival draws record Saturday crowd', dek: 'Organizers estimate 12,000 visitors along the Millbrook waterfront this weekend.', row1: 'Council to vote on transit levy Tuesday', row2: 'Fairhaven HS robotics team heads to state' },
  { kicker: 'DEVELOPING', headline: 'Residents report chlorine odor in tap water across Zones 2–4', dek: 'Calls to 311 spiked after posts describing a strong smell; the city has not yet commented.', row1: 'What we know about the Millbrook treatment plant', row2: 'Council to vote on transit levy Tuesday' },
  { kicker: 'ADVISORY', headline: 'County issues boil water advisory for Zones 2–4', dek: 'Residents told to boil tap water for one minute before use while lab tests are pending.', row1: 'Map: which zones are affected', row2: 'What we know about the Millbrook treatment plant' },
  { kicker: 'ADVISORY', headline: 'City opens water distribution site at Fairview High School', dek: 'Bottled water available from 3:30 PM; officials cite the county advisory and pending 6 PM lab results.', row1: 'Boil advisory: what you need to do', row2: 'Map: which zones are affected' },
  { kicker: 'EVENING UPDATE', headline: 'Boil advisory continues into the evening; results expected 6 AM', dek: 'Flushing operations underway at the Millbrook plant. Distribution at Fairview HS open until 9 PM.', row1: 'How the city responded, hour by hour', row2: 'Schools to decide on Monday closures by 8 PM' },
]

const POSTS_BY_SEGMENT: StagePost[][] = [
  [
    { name: 'Marisol Vega', handle: '@mvega_fh', avatarBg: '#7a5aa0', avatarText: 'MV', verified: false, text: 'Farmers market haul: honey, peaches, and way too much bread. Worth it. 🥖', replies: 2, reposts: 0, likes: 14, age: '1h', origin: 'ENGINE · AUTO · FIRED 13:20' },
    { name: 'Newsline 7', handle: '@Newsline7', avatarBg: '#123a63', avatarText: 'N7', verified: true, text: 'Record crowds at the riverfront festival this weekend — our drone footage at 6.', replies: 4, reposts: 9, likes: 51, age: '2h', origin: 'SIMCELL-2 · MANUAL · FIRED 12:41' },
  ],
  [
    { name: 'Marisol Vega', handle: '@mvega_fh', avatarBg: '#7a5aa0', avatarText: 'MV', verified: false, text: 'Anyone else’s tap water smell like straight bleach?? Zone 3 here. #WaterIssues', replies: 31, reposts: 18, likes: 96, age: '10m', origin: 'ENGINE · AUTO · FIRED 14:24' },
    { name: 'Tom Brandt', handle: '@tbrandt41', avatarBg: '#8a5300', avatarText: 'TB', verified: false, text: 'Heard from a plant worker it’s a toxic spill cover-up. Share this before it gets deleted. #Millbrook', replies: 12, reposts: 44, likes: 87, age: '2m', origin: 'ENGINE · AUTO · FIRED 14:38' },
  ],
  [
    { name: 'Newsline 7', handle: '@Newsline7', avatarBg: '#123a63', avatarText: 'N7', verified: true, text: 'BREAKING: County issues boil water advisory for Zones 2–4. Boil tap water 1 minute before use.', replies: 58, reposts: 203, likes: 340, age: '3m', origin: 'INJ-042 · FIRED 14:51' },
    { name: 'Tom Brandt', handle: '@tbrandt41', avatarBg: '#8a5300', avatarText: 'TB', verified: false, text: 'Still nothing from the city. What are they hiding? #WaterIssues #Millbrook', replies: 26, reposts: 71, likes: 154, age: '8m', origin: 'ENGINE · AUTO · FIRED 14:46' },
  ],
  [
    { name: 'Fulton County EM', handle: '@FulcoEM', avatarBg: '#1e3a5f', avatarText: 'EM', verified: true, text: 'BOIL WATER ADVISORY — Zones 2–4: boil tap water 1 minute before drinking or cooking. Water distribution opens 3:30 PM at Fairview HS. Lab results expected 6 PM.', replies: 41, reposts: 388, likes: 512, age: '1m', origin: 'PARTICIPANT · D. REYES · POSTED 15:07' },
    { name: 'Marisol Vega', handle: '@mvega_fh', avatarBg: '#7a5aa0', avatarText: 'MV', verified: false, text: 'FINALLY an official answer. Heading to Fairview HS for water. #WaterIssues', replies: 6, reposts: 22, likes: 74, age: 'now', origin: 'ENGINE · AUTO · FIRED 15:09' },
  ],
  [
    { name: 'Fairhaven Water Utility', handle: '@FairhavenWater', avatarBg: '#2e6b2e', avatarText: 'FW', verified: true, text: 'Flushing operations at Millbrook plant are underway. Advisory remains in effect overnight; results expected 6 AM.', replies: 12, reposts: 96, likes: 201, age: '10m', origin: 'PARTICIPANT · K. WARD · POSTED 19:18' },
    { name: 'Newsline 7', handle: '@Newsline7', avatarBg: '#123a63', avatarText: 'N7', verified: true, text: 'At 10: how Fairhaven’s water response unfolded, hour by hour. Advisory holds until morning.', replies: 9, reposts: 34, likes: 118, age: '4m', origin: 'SIMCELL-2 · MANUAL · FIRED 19:24' },
  ],
]

const TREND_BY_SEGMENT = ['not trending', '#3 · rising', '#1', '#1', '#2 · falling']

/** Which of the 5 story segments scenario-minute `t` falls into. */
export function segmentIndexForT(t: number): number {
  if (t < 14) return 0
  if (t < 31) return 1
  if (t < 47) return 2
  if (t < 52) return 3
  return 4
}

/** Builds the read-only participant-stage snapshot for scenario minute `t`. */
export function getStageContent(t: number): StageContent {
  const seg = segmentIndexForT(t)
  const portal = PORTAL_SEGMENTS[seg]
  const rounded = Math.round(t)
  const dateline = t >= 52
    ? `Saturday · 7:${String(rounded - 52).padStart(2, '0')} PM`
    : `Saturday · 2:${String((20 + rounded) % 60).padStart(2, '0')} PM`

  return {
    segmentIndex: seg,
    alert: seg >= 2,
    alertMessage: `Boil Water Advisory — Zones 2–4. Boil tap water for 1 minute before use. · ${seg === 4 ? '19:12' : '14:51'}`,
    dateline,
    kicker: portal.kicker,
    headline: portal.headline,
    dek: portal.dek,
    row1: portal.row1,
    row2: portal.row2,
    posts: POSTS_BY_SEGMENT[seg],
    trend: TREND_BY_SEGMENT[seg],
  }
}
