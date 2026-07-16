/**
 * features/evaluator/services/mockData.ts
 * ---------------------------------------------------------------------------
 * Typed fixtures for the Evaluator Dashboard scaffold, transcribed from the
 * reference mockup's `renderVals()` (Fairhaven Water Response 26-3, a
 * 68-minute water-contamination arc — see DECISIONS.md D6).
 *
 * TODO(backend): this whole file is the seam that gets replaced. When the
 * real APIs land, `hooks/` should fetch through `core/services/api.ts` +
 * React Query instead of importing these constants directly:
 *   - storyline tiles / live stream  -> exercise-context + telemetry (XC-004)
 *   - timeline events                -> event-log query (EVL-001/002)
 *   - replay ridge/marks             -> replay-bundle query (EVL-003)
 *   - latency / coverage / sentiment -> metrics query (EVL-010...015)
 *   - annotations                    -> evaluator-annotations CRUD (EVL-020/021)
 * All participant-visible times below are scenario time only (COR-053) via
 * `scenarioTime.ts` — never wall-clock.
 */

import type {
  Annotation,
  CoverageItem,
  DialMark,
  AxisTick,
  EvidenceLevel,
  ExerciseState,
  LatencyRow,
  LiveStreamRow,
  ManifestItem,
  SentimentPoint,
  SeverityState,
  SeverityWord,
  StorylineTile,
  TimelineEvent,
} from '../types'

// ---------------------------------------------------------------------------
// Severity — word + shape + color, never color-only (NFR-001)
// ---------------------------------------------------------------------------

export const SEVERITY: Record<SeverityWord, SeverityState> = {
  CALM: { word: 'CALM', shape: '●', color: '#2e7d4f' },
  ELEVATED: { word: 'ELEVATED', shape: '▲', color: '#b26a00' },
  HOT: { word: 'HOT', shape: '■', color: '#b3261e' },
}

// ---------------------------------------------------------------------------
// Storyline board (D6-001)
// ---------------------------------------------------------------------------

interface TileSeed {
  name: string;
  severity: SeverityState;
  hero: string;
  intensity: number;
  latency: string;
  latencyIsHot: boolean;
  concerns: string;
  concernsIsHot: boolean;
  sentimentArrow: string;
  sentimentWord: string;
}

function buildTile(seed: TileSeed): StorylineTile {
  return {
    id: seed.name,
    name: seed.name,
    severity: seed.severity,
    hero: seed.hero,
    heroColor: seed.severity.word === 'CALM' ? '#4a4f55' : seed.severity.color,
    intensity: seed.intensity,
    latency: seed.latency,
    latencyIsHot: seed.latencyIsHot,
    concerns: seed.concerns,
    concernsIsHot: seed.concernsIsHot,
    sentimentArrow: seed.sentimentArrow,
    sentimentWord: seed.sentimentWord,
  }
}

const QUIET_TILE_SEEDS: TileSeed[] = [
  { name: '#WaterIssues', severity: SEVERITY.ELEVATED, hero: 'AMBER · 40 MIN', intensity: 62, latency: 'No official post — 40m', latencyIsHot: true, concerns: '3 unaddressed concerns', concernsIsHot: true, sentimentArrow: '↘', sentimentWord: 'souring' },
  { name: 'Boil Advisory', severity: SEVERITY.CALM, hero: 'CALM · 13 MIN', intensity: 34, latency: 'Wire release 14:51 · matched', latencyIsHot: false, concerns: 'No open concerns', concernsIsHot: false, sentimentArrow: '→', sentimentWord: 'steady' },
  { name: 'Millbrook Rumor', severity: SEVERITY.ELEVATED, hero: 'AMBER · 26 MIN', intensity: 48, latency: 'No counter-post — 26m', latencyIsHot: true, concerns: '1 unaddressed concern', concernsIsHot: true, sentimentArrow: '↘', sentimentWord: 'souring' },
  { name: 'School Closures', severity: SEVERITY.CALM, hero: 'CALM', intensity: 12, latency: '@FairhavenISD replied · 6m', latencyIsHot: false, concerns: 'No open concerns', concernsIsHot: false, sentimentArrow: '→', sentimentWord: 'steady' },
]

const STORM_TILE_SEEDS: TileSeed[] = [
  { name: '#WaterIssues', severity: SEVERITY.HOT, hero: 'RED · 46 MIN', intensity: 88, latency: 'First official post · 43m latency', latencyIsHot: false, concerns: '7 unaddressed concerns', concernsIsHot: true, sentimentArrow: '↘', sentimentWord: 'souring fast' },
  { name: 'Boil Advisory', severity: SEVERITY.ELEVATED, hero: 'AMBER · 8 MIN', intensity: 58, latency: 'Wire release 14:51 · matched', latencyIsHot: false, concerns: '2 unaddressed concerns', concernsIsHot: true, sentimentArrow: '↘', sentimentWord: 'souring' },
  { name: 'Millbrook Rumor', severity: SEVERITY.HOT, hero: 'RED · 12 MIN', intensity: 74, latency: 'No counter-post — 32m', latencyIsHot: true, concerns: '4 unaddressed concerns', concernsIsHot: true, sentimentArrow: '↘', sentimentWord: 'souring' },
  { name: 'School Closures', severity: SEVERITY.CALM, hero: 'CALM', intensity: 22, latency: '@FairhavenISD replied · 6m', latencyIsHot: false, concerns: 'No open concerns', concernsIsHot: false, sentimentArrow: '→', sentimentWord: 'steady' },
]

export function getStorylineTiles(exerciseState: ExerciseState): StorylineTile[] {
  const seeds = exerciseState === 'live-storm' ? STORM_TILE_SEEDS : QUIET_TILE_SEEDS
  return seeds.map(buildTile)
}

// ---------------------------------------------------------------------------
// Live stream (D6-003/008)
// ---------------------------------------------------------------------------

interface StreamSeed {
  time: string;
  kind: LiveStreamRow['kind'];
  name: string;
  sub: string;
  avatarBg: string;
  avatarText: string;
  verified: boolean;
  text: string;
  origin: string;
  nameColor?: string;
  background?: string;
}

function buildStreamRow(seed: StreamSeed, index: number): LiveStreamRow {
  return {
    id: `stream-${index}-${seed.time}`,
    time: seed.time,
    kind: seed.kind,
    name: seed.name,
    sub: seed.sub,
    avatarBg: seed.avatarBg,
    avatarText: seed.avatarText,
    avatarShape: seed.kind === 'post' ? 'circle' : 'rounded',
    verified: seed.verified,
    text: seed.text,
    origin: seed.origin,
    nameColor: seed.nameColor,
    background: seed.background,
  }
}

const BASE_STREAM_SEEDS: StreamSeed[] = [
  { time: '15:03', kind: 'post', name: 'Marisol Vega', sub: '@mvega_fh · Pulse', avatarBg: '#7a5aa0', avatarText: 'MV', verified: false, text: 'Water at Lincoln Elementary smells like bleach too. Third school today. #WaterIssues', origin: 'ENGINE · AUTO · FIRED 15:03' },
  { time: '15:01', kind: 'post', name: 'Tom Brandt', sub: '@tbrandt41 · Pulse', avatarBg: '#8a5300', avatarText: 'TB', verified: false, text: 'Heard from a plant worker it’s a toxic spill cover-up. Share before it gets deleted. #Millbrook', origin: 'ENGINE · AUTO · FIRED 15:01' },
  { time: '14:57', kind: 'off-platform', name: 'Off-platform response', sub: 'logged by SimCell-1', avatarBg: '#5b4a7a', avatarText: '☎', verified: false, text: 'EOC phone briefing to Newsline 7 — statement summary attached. Counts toward response latency (CTL-026).', origin: 'SIMCELL-1 · MARKER · LOGGED 14:57', background: '#f7f4fc' },
  { time: '14:55', kind: 'post', name: 'Newsline 7', sub: '@Newsline7 · Pulse', avatarBg: '#123a63', avatarText: 'N7', verified: true, text: 'City yet to comment on reports of chlorine odor in Zones 2–4. We’ve requested a statement.', origin: 'SIMCELL-2 · MANUAL · FIRED 14:55' },
  { time: '14:51', kind: 'inject', name: 'Inject fired', sub: 'MSEL · Boil Water Advisory', avatarBg: '#1e3a5f', avatarText: 'INJ', verified: false, text: 'INJ-042 — County boil water advisory issued. Shell alert bar raised to ADVISORY across all channels.', origin: 'INJ-042 · FIRED 14:51', background: '#f4f7fa' },
  { time: '14:42', kind: 'dial', name: 'Controller dial', sub: 'staff-only — participants never see this', avatarBg: '#b26a00', avatarText: '◆', verified: false, text: 'Intensity dial on #WaterIssues raised 45 → 70. Scenario design input — not participant behavior.', origin: 'CONTROLLER · DIAL · 14:42', nameColor: '#8a5300', background: '#fffaf0' },
]

const STORM_LEAD_STREAM_SEEDS: StreamSeed[] = [
  { time: '15:10', kind: 'post', name: 'Keisha Ward', sub: '@kwardFH · Pulse', avatarBg: '#2e6b2e', avatarText: 'KW', verified: false, text: 'Lines at Fairview HS already around the block. Is there a second site?? #WaterIssues', origin: 'ENGINE · AUTO · FIRED 15:10' },
  { time: '15:09', kind: 'post', name: 'The Scoop', sub: '@TheScoopHQ · Pulse', avatarBg: '#8f150c', avatarText: 'TS', verified: false, text: 'EXCLUSIVE: Is Fairhaven’s water poisoning your kids? What officials won’t say. #Millbrook', origin: 'ENGINE · AUTO · FIRED 15:09' },
]

export function getLiveStream(exerciseState: ExerciseState): LiveStreamRow[] {
  const seeds = exerciseState === 'live-storm'
    ? [...STORM_LEAD_STREAM_SEEDS, ...BASE_STREAM_SEEDS]
    : BASE_STREAM_SEEDS
  return seeds.map(buildStreamRow)
}

// ---------------------------------------------------------------------------
// Timeline explorer (D6-004)
// ---------------------------------------------------------------------------

interface EventSeed {
  t: number;
  channel: TimelineEvent['channel'];
  actor: string;
  humanAttribution: string | null;
  origin: string;
  text: string;
  storyline: string;
  isDial?: boolean;
  isOffPlatform?: boolean;
  isSystem?: boolean;
}

const EVENT_SEEDS: EventSeed[] = [
  { t: 4, channel: 'PULSE', actor: 'Marisol Vega @mvega_fh', humanAttribution: null, origin: 'ENGINE · AUTO', text: 'Anyone else’s tap water smell like straight bleach?? Zone 3 here. #WaterIssues', storyline: '#WaterIssues' },
  { t: 9, channel: 'PULSE', actor: 'Platform', humanAttribution: null, origin: 'SYSTEM', text: '#WaterIssues enters trending (≈ #3) — derived state, snapshot-approximate.', storyline: '#WaterIssues', isSystem: true },
  { t: 14, channel: 'PORTAL', actor: 'Newsline 7', humanAttribution: null, origin: 'INJ-041', text: 'Story: Residents report chlorine odor in tap water across Zones 2–4.', storyline: '#WaterIssues' },
  { t: 15, channel: 'PULSE', actor: 'Newsline 7 @Newsline7', humanAttribution: null, origin: 'ENGINE · AUTO', text: 'DM to @FulcoEM: requesting a statement on the water odor reports.', storyline: '#WaterIssues' },
  { t: 18, channel: 'PULSE', actor: 'Tom Brandt @tbrandt41', humanAttribution: null, origin: 'ENGINE · AUTO', text: 'Heard from a plant worker it’s a toxic spill cover-up. Share before deleted. #Millbrook', storyline: 'Millbrook Rumor' },
  { t: 22, channel: 'STAFF', actor: 'Controller dial', humanAttribution: null, origin: 'CONTROLLER · DIAL', text: 'Intensity #WaterIssues raised 45 → 70 — scenario design input (staff-only layer).', storyline: '#WaterIssues', isDial: true },
  { t: 31, channel: 'WIRE', actor: 'Fulton County EM', humanAttribution: 'D. Reyes', origin: 'INJ-042', text: 'BOIL WATER ADVISORY issued for Zones 2–4. Shell alert bar → ADVISORY.', storyline: 'Boil Advisory' },
  { t: 33, channel: 'PORTAL', actor: 'Fairhaven Today', humanAttribution: null, origin: 'ENGINE · AUTO', text: 'Lead story: County issues boil water advisory for Zones 2–4.', storyline: 'Boil Advisory' },
  { t: 37, channel: 'OFF-PLATFORM', actor: 'EOC → Newsline 7', humanAttribution: 'D. Reyes', origin: 'SIMCELL-1 · MARKER', text: 'Phone briefing to Newsline 7 — logged as off-platform response (CTL-026).', storyline: '#WaterIssues', isOffPlatform: true },
  { t: 43, channel: 'PULSE', actor: 'Marisol Vega @mvega_fh', humanAttribution: null, origin: 'ENGINE · AUTO', text: 'Water at Lincoln Elementary smells like bleach too. Third school today. #WaterIssues', storyline: '#WaterIssues' },
  { t: 47, channel: 'PULSE', actor: 'Fulton County EM @FulcoEM', humanAttribution: 'D. Reyes', origin: 'PARTICIPANT', text: 'BOIL WATER ADVISORY — Zones 2–4… distribution opens 3:30 PM at Fairview HS.', storyline: '#WaterIssues' },
  { t: 49, channel: 'WIRE', actor: 'Fulton County EM', humanAttribution: 'D. Reyes', origin: 'PARTICIPANT', text: 'Press release: Water distribution site opens at Fairview High School.', storyline: 'Boil Advisory' },
  { t: 52, channel: 'STAFF', actor: 'Scenario time jump', humanAttribution: null, origin: 'CONTROLLER', text: 'Clock advanced +4 hr → 19:12 (evening news cycle). Discontinuity marked on the replay track.', storyline: 'All', isDial: true },
  { t: 58, channel: 'PORTAL', actor: 'Fairhaven Today', humanAttribution: null, origin: 'ENGINE · AUTO', text: 'Evening recap: Boil advisory continues into the evening; results expected 6 AM.', storyline: 'Boil Advisory' },
  { t: 63, channel: 'PULSE', actor: 'Fairhaven Water Utility @FairhavenWater', humanAttribution: 'K. Ward', origin: 'PARTICIPANT', text: 'Flushing operations underway at Millbrook plant. Advisory remains overnight.', storyline: '#WaterIssues' },
]

export const TIMELINE_EVENTS: TimelineEvent[] = EVENT_SEEDS.map((seed, index) => ({
  id: `evt-${index}-${seed.t}`,
  t: seed.t,
  channel: seed.channel,
  actor: seed.actor,
  humanAttribution: seed.humanAttribution,
  origin: seed.origin,
  text: seed.text,
  storyline: seed.storyline,
  isDial: seed.isDial ?? false,
  isOffPlatform: seed.isOffPlatform ?? false,
  isSystem: seed.isSystem ?? false,
}))

// ---------------------------------------------------------------------------
// Metrics — latency (D6-009)
// ---------------------------------------------------------------------------

export function evidenceChipPalette(
  level: EvidenceLevel,
): { border: string; background: string; text: string } {
  return level === 'PERSON-LEVEL'
    ? { border: '#1e3a5f', background: '#eef3f9', text: '#1e3a5f' }
    : { border: '#c4c4c4', background: '#f2f4f6', text: '#4a4f55' }
}

export const LATENCY_ROWS: LatencyRow[] = [
  { id: 'lat-1', prompt: 'First public contamination concern', promptTime: '14:24 · @mvega_fh post', response: '@FulcoEM advisory post (D. Reyes)', responseIsMissing: false, isOffPlatform: false, latencyLabel: '43 MIN', barWidthPct: 100, barColor: '#b3261e', evidenceLevel: 'PERSON-LEVEL', evidenceTooltip: 'Attributable to D. Reyes behind the shared org account (COR-018, EVL-012)' },
  { id: 'lat-2', prompt: 'Newsline 7 statement request', promptTime: '14:35 · DM to @FulcoEM', response: 'EOC phone briefing (D. Reyes)', responseIsMissing: false, isOffPlatform: true, latencyLabel: '23 MIN', barWidthPct: 53, barColor: '#b26a00', evidenceLevel: 'PERSON-LEVEL', evidenceTooltip: 'Attributable to D. Reyes behind the shared org account (COR-018, EVL-012)' },
  { id: 'lat-3', prompt: 'Boil advisory issued (INJ-042)', promptTime: '14:51 · county advisory', response: '@FulcoEM amplification + press release', responseIsMissing: false, isOffPlatform: false, latencyLabel: '16 MIN', barWidthPct: 37, barColor: '#b26a00', evidenceLevel: 'PERSON-LEVEL', evidenceTooltip: 'Attributable to D. Reyes behind the shared org account (COR-018, EVL-012)' },
  { id: 'lat-4', prompt: '"Toxic spill" rumor', promptTime: '14:38 · @tbrandt41 post', response: 'No counter-messaging observed', responseIsMissing: true, isOffPlatform: false, latencyLabel: '—', barWidthPct: 0, barColor: '#b3261e', evidenceLevel: 'SESSION-LEVEL', evidenceTooltip: 'Aggregated — no individual identified (EVL-012)' },
]

// ---------------------------------------------------------------------------
// Metrics — coverage (D6-010, mutable via annotation/coverage actions)
// ---------------------------------------------------------------------------

export const INITIAL_COVERAGE_ITEMS: CoverageItem[] = [
  { id: 'c1', text: '"Toxic spill" rumor never countered on Pulse', sub: 'Rumor seeded 14:38 (ENGINE) reached ≈2.1k accounts; no official correction posted', status: 'unconfirmed' },
  { id: 'c2', text: 'Advisory never re-shared to the school-closure audience', sub: '#FairhavenSchools thread active 14:40–15:10 with zero official presence', status: 'unconfirmed' },
  { id: 'c3', text: 'Initial zone map error went uncorrected for 22 min', sub: 'Zones "2–5" in first draft vs "2–4" in advisory; confirmed by E1 at 15:31', status: 'confirmed', confirmedBy: 'E1' },
  { id: 'c4', text: 'Distribution site announced before news broke it', sub: '@FulcoEM posted Fairview HS site 11 min ahead of Newsline 7', status: 'addressed' },
]

// ---------------------------------------------------------------------------
// Metrics — sentiment trajectory (D6-008, absent pre-e8 per D6-011)
// ---------------------------------------------------------------------------

const SENTIMENT_RAW_POINTS: Array<[number, number]> = [
  [0, -5], [8, -10], [14, -16], [22, -20], [28, -38], [34, -48], [42, -52],
  [47, -54], [50, -44], [52, -40], [55, -46], [60, -34], [65, -26], [68, -22],
]

export const SENTIMENT_POINTS: SentimentPoint[] = SENTIMENT_RAW_POINTS.map(([t, v]) => ({ t, v }))

export const DIAL_MARKS: DialMark[] = [
  { t: 22, v: -20, label: '◆ dial 45→70' },
  { t: 55, v: -46, label: '◆ evening dial' },
]

export const AXIS_TICKS: AxisTick[] = [
  { t: 0, label: '14:20' },
  { t: 22, label: '14:42' },
  { t: 47, label: '15:07' },
  { t: 52, label: '⟫ 19:12' },
  { t: 68, label: '19:28' },
]

// ---------------------------------------------------------------------------
// Replay track (D6-005)
// ---------------------------------------------------------------------------

export const RIDGE_HEIGHTS_PCT: number[] = [
  8, 6, 7, 10, 22, 30, 26, 34, 42, 55, 48, 62, 70, 66, 78, 85, 92, 88, 74, 68,
  60, 52, 46, 40, 35, 50, 58, 44, 38, 30, 26, 20, 14, 10,
]

export interface StaffLaneMarkSeed {
  t: number;
  glyph: string;
  color: string;
  tooltip: string;
}

export const STAFF_LANE_MARK_SEEDS: StaffLaneMarkSeed[] = [
  { t: 14, glyph: '▸', color: '#1e3a5f', tooltip: 'INJ-041 fired — Newsline 7 odor story · 14:34' },
  { t: 22, glyph: '◆', color: '#b26a00', tooltip: 'Controller dial: #WaterIssues intensity 45 → 70 · 14:42' },
  { t: 31, glyph: '▸', color: '#1e3a5f', tooltip: 'INJ-042 fired — Boil Water Advisory · 14:51' },
  { t: 55, glyph: '◆', color: '#b26a00', tooltip: 'Controller dial: evening sentiment pressure · 19:15' },
]

// ---------------------------------------------------------------------------
// Annotations (D6-003, EVL-020/021 — mutable, seeded here)
// ---------------------------------------------------------------------------

export const INITIAL_ANNOTATIONS: Annotation[] = [
  { id: 'anno-1', time: '14:46', category: 'IMPROVEMENT', note: 'PIO team unaware #WaterIssues trending — no social monitor assigned in the JIC.', anchor: '#WaterIssues board tile · 14:46', pushed: true },
  { id: 'anno-2', time: '14:57', category: 'STRENGTH', note: 'EOC briefed Newsline 7 by phone within 23 min of the media query.', anchor: 'Off-platform marker · 14:57', pushed: false },
  { id: 'anno-3', time: '15:07', category: 'STRENGTH', note: 'First official post cites the advisory verbatim — clear language, no jargon.', anchor: '@FulcoEM post · 15:07', pushed: false },
]

// ---------------------------------------------------------------------------
// AAR export manifest (D6-012)
// ---------------------------------------------------------------------------

export const MANIFEST_BASE: Omit<ManifestItem, 'detail'>[] = [
  { id: 'timeline-log', name: 'Timeline log' },
  { id: 'replay-bundle', name: 'Replay bundle' },
  { id: 'annotations', name: 'Annotations' },
  { id: 'metrics', name: 'Metrics' },
  { id: 'scenario-design-record', name: 'Scenario design record' },
]
