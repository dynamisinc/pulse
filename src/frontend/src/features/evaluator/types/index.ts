/**
 * features/evaluator/types
 * ---------------------------------------------------------------------------
 * Shared TypeScript contracts for the Evaluator Dashboard (D6).
 *
 * These types mirror the reference DOM's `renderVals()` data model in
 * `design/handoffs/evaluator-dashboard/Evaluator Dashboard.dc.html` (lines
 * ~335-640), reshaped from ad-hoc `{{mustache}}` view-model props into real
 * TypeScript. They are the seam every hook/service/component builds against,
 * so swapping mock data for React Query + a live telemetry stream later
 * touches `services/` and `hooks/`, never the components.
 *
 * Two-worlds note: this whole feature is STAFF surface (COBRA). Nothing here
 * renders to participants directly — `StageContent`/`StagePost` describe a
 * *read-only reproduction* of the participant world for evaluators to look
 * at (D6-002), not the participant app itself.
 */

// ---------------------------------------------------------------------------
// Runtime / exercise state (replaces the mockup's `exState` + `projector` props)
// ---------------------------------------------------------------------------

/**
 * Exercise lifecycle phase driving the dashboard's defaults.
 * TODO(E1): source from the real exercise-context/lifecycle API instead of
 * the dev-only toggle strip once it exists (COR-032/050).
 */
export type ExerciseState = 'live-quiet' | 'live-storm' | 'hotwash' | 'pre-e8'

export type EvaluatorView = 'live' | 'timeline' | 'replay' | 'metrics'

export type ReplayMode = 'eval' | 'hotwash'

export type WorldChannel = 'portal' | 'pulse'

export type PlaybackSpeed = 1 | 4 | 16

export type AnnotationCategory = 'STRENGTH' | 'IMPROVEMENT' | 'OBSERVATION'

export type CoverageStatus = 'unconfirmed' | 'confirmed' | 'addressed'

export type TimelineChannel = 'PULSE' | 'PORTAL' | 'WIRE' | 'STAFF' | 'OFF-PLATFORM'

export type TimelineChannelFilter = 'All' | Exclude<TimelineChannel, 'STAFF'>

export type TimelineOriginFilter =
  | 'All'
  | 'ENGINE'
  | 'INJ'
  | 'SIMCELL'
  | 'PARTICIPANT'
  | 'CONTROLLER'

export type TimelineRangeFilter = 'All' | 'First 30m' | 'After advisory'

export interface TimelineFilters {
  channel: TimelineChannelFilter;
  origin: TimelineOriginFilter;
  storyline: string; // 'All' | a storyline name
  range: TimelineRangeFilter;
  actorQuery: string;
}

// ---------------------------------------------------------------------------
// Severity — word + shape + color, never color-only (NFR-001)
// ---------------------------------------------------------------------------

export type SeverityWord = 'CALM' | 'ELEVATED' | 'HOT'

export interface SeverityState {
  word: SeverityWord;
  /** Literal design-spec glyph (● / ▲ / ■) — a typographic shape, not an icon. */
  shape: string;
  color: string;
}

// ---------------------------------------------------------------------------
// Storyline board (D6-001)
// ---------------------------------------------------------------------------

export interface StorylineTile {
  id: string;
  name: string;
  severity: SeverityState;
  /** Hero = state x time-in-state, e.g. "AMBER · 40 MIN" or "CALM". */
  hero: string;
  heroColor: string;
  /** 0-100. Only meaningful when the adaptive engine is on. */
  intensity: number;
  latency: string;
  latencyIsHot: boolean;
  concerns: string;
  concernsIsHot: boolean;
  sentimentArrow: string;
  sentimentWord: string;
}

// ---------------------------------------------------------------------------
// Live stream (D6-003/008)
// ---------------------------------------------------------------------------

export type StreamRowKind = 'post' | 'off-platform' | 'inject' | 'dial'

export interface LiveStreamRow {
  id: string;
  time: string;
  kind: StreamRowKind;
  name: string;
  sub: string;
  avatarBg: string;
  avatarText: string;
  avatarShape: 'circle' | 'rounded';
  verified: boolean;
  text: string;
  origin: string;
  nameColor?: string;
  background?: string;
}

// ---------------------------------------------------------------------------
// World view / replay stage (read-only participant reproduction)
// ---------------------------------------------------------------------------

export interface StagePost {
  name: string;
  handle: string;
  avatarBg: string;
  avatarText: string;
  verified: boolean;
  text: string;
  replies: number;
  reposts: number;
  likes: number;
  age: string;
  origin: string;
}

export interface StageContent {
  segmentIndex: number;
  alert: boolean;
  alertMessage: string;
  dateline: string;
  kicker: string;
  headline: string;
  dek: string;
  row1: string;
  row2: string;
  posts: StagePost[];
  /** Trending rank — a derived/snapshot value, always rendered with an amber ~= mark. */
  trend: string;
}

// ---------------------------------------------------------------------------
// Timeline explorer (D6-004)
// ---------------------------------------------------------------------------

export interface TimelineEvent {
  id: string;
  /** Minutes elapsed since scenario start (0-68 across this arc). */
  t: number;
  channel: TimelineChannel;
  actor: string;
  /** Per-human attribution behind a shared org account (COR-018). */
  humanAttribution: string | null;
  origin: string;
  text: string;
  storyline: string;
  isDial: boolean;
  isOffPlatform: boolean;
  isSystem: boolean;
}

// ---------------------------------------------------------------------------
// Replay (D6-005/006/007)
// ---------------------------------------------------------------------------

export interface RidgePoint {
  heightPct: number;
}

export interface StaffLaneMark {
  id: string;
  t: number;
  leftPct: number;
  /** ▸ inject fired, ◆ controller dial — never mixed into the activity ridge. */
  glyph: string;
  color: string;
  tooltip: string;
}

export interface BookmarkMark {
  id: string;
  t: number;
  leftPct: number;
  tooltip: string;
}

// ---------------------------------------------------------------------------
// Metrics (D6-008/009/010/011)
// ---------------------------------------------------------------------------

export type EvidenceLevel = 'PERSON-LEVEL' | 'SESSION-LEVEL'

export interface LatencyRow {
  id: string;
  prompt: string;
  promptTime: string;
  response: string;
  responseIsMissing: boolean;
  isOffPlatform: boolean;
  latencyLabel: string;
  barWidthPct: number;
  barColor: string;
  evidenceLevel: EvidenceLevel;
  evidenceTooltip: string;
}

export interface CoverageItem {
  id: string;
  text: string;
  sub: string;
  status: CoverageStatus;
  /** Set once an evaluator confirms it — attributable per COR-018. */
  confirmedBy?: string;
}

export interface SentimentPoint {
  t: number;
  v: number;
}

export interface DialMark {
  t: number;
  v: number;
  label: string;
}

export interface AxisTick {
  t: number;
  label: string;
}

// ---------------------------------------------------------------------------
// Annotations (D6-003, EVL-020/021)
// ---------------------------------------------------------------------------

export interface Annotation {
  id: string;
  /** Scenario-time string (COR-053) the annotation was captured at. */
  time: string;
  category: AnnotationCategory;
  note: string;
  anchor: string;
  pushed: boolean;
}

// ---------------------------------------------------------------------------
// AAR export (D6-012, EVL-030/031)
// ---------------------------------------------------------------------------

export interface ManifestItem {
  id: string;
  name: string;
  detail: string;
}
