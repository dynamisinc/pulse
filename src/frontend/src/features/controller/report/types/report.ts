/**
 * features/controller/report/types/report.ts
 * ---------------------------------------------------------------------------
 * The FROZEN response contract of `GET /api/staff/exports/report` (demo-feedback
 * story 29 + the story 30 `postRecord`/filters,
 * docs/features/demo-feedback/29-printable-exercise-report.md "Contract"). Copied
 * from the story; the backend builds the same shape. Do not widen it here: change the story first.
 *
 * Every time is an exercise-zone SCENARIO time already formatted by the server:
 * "yyyy-MM-dd HH:mm" (`*At`, `start`) or "HH:mm" (`*Time`). The client never converts zones.
 * Handles arrive with their "@" prefix. STAFF world only: provenance (origin, posted by,
 * inject ref) never reaches a participant.
 *
 * STORY 31 (DF-45/DF-47) AMENDS the contract: `from`/`to` now scope EVERY section (so
 * `exercise.scenarioStart/End/conductedDate` are the in-window min/max); `exercise.latestDay`
 * and `exercise.spansMultipleDays` are new; `injectResponses[].ref` and marker `ref` are the MSEL
 * number only (null when there is none; `title` is always the title); each post carries
 * `threadRootId` + `depth` (0 root, 1 listed descendant) and `posts` arrives in thread order
 * (each root by time, then its listed descendants by time).
 */

export interface ReportAccount {
  handle: string
  displayName: string
  verified: boolean
  likes: number
  reposts: number
  /**
   * Story 32: the account's posts inside the report's window (all sources). Absent only from an
   * older server (the frontend and API deploy separately), so the page renders without it.
   */
  posts?: number
}

/**
 * A verified account beside its lookalike. `outdrew` (story 32, DF-48): the lookalike's likes +
 * reposts are at least 10 and at least 1.5x the verified account's; only then is a verdict printed.
 */
export interface ReportLookalikePair {
  verified: ReportAccount
  lookalike: ReportAccount
  outdrew: boolean
  /**
   * Story 33 (DF-49): true when a controller named this pair (the lookalike's "Imitates" setting),
   * false when it was found by handle prefix. Absent only from an older server, so the page
   * renders without it (read as a handle match).
   */
  named?: boolean
}

/** `Post.Origin` mapped: `inject` becomes `scripted`. */
export type ReportSource = 'participant' | 'controller-as-persona' | 'scripted' | 'engine' | 'noise'

export interface ReportMedia {
  kind: 'image' | 'video'
  /** The image URL, or the video's POSTER URL (null for a poster-less video). */
  url: string | null
  alt: string
  durationSec: number | null
  width: number | null
  height: number | null
}

export interface ReportPost {
  id: string
  scenarioAt: string
  scenarioTime: string
  author: { handle: string; displayName: string; verified: boolean; avatarUrl: string | null }
  source: ReportSource
  postedBy: string | null
  injectRef: string | null
  replyToHandle: string | null
  parentPostId: string | null
  text: string
  media: ReportMedia[]
  likes: number
  reposts: number
  replies: number
  pinnedForAll: boolean
  takenDownAt: string | null
  /** Times the author edited the post; 0 when never edited (null only from an older server). */
  editCount: number | null
  /** The last edit's scenario time, "yyyy-MM-dd HH:mm"; null when never edited. */
  lastEditedAt: string | null
  /** Story 31: the top-most ancestor inside the listed set, else this post's own id. */
  threadRootId: string
  /** Story 31: 0 for a root, 1 for any listed descendant (never more). */
  depth: number
}

export interface ReportActivityBin {
  start: string
  participant: number
  scripted: number
  engine: number
  noise: number
}

export interface ReportInjectMarker {
  /** The MSEL number only; null when the inject has none (story 31). */
  ref: string | null
  title: string
  at: string
  binIndex: number
}

export interface ReportInjectResponse {
  /** The MSEL number only; null when the inject has none (story 31). */
  ref: string | null
  title: string
  deliveredAt: string
  firstResponseAt: string | null
  responseMinutes: number | null
  respondedAsHandle: string | null
}

export interface ReportSummary {
  participants: number
  posts: number
  replies: number
  injectsDelivered: number
  medianResponseMinutes: number | null
  busiestWindow: { start: string; posts: number } | null
  /** Null until editing lands. */
  postsEdited: number | null
  postsTakenDown: number
  bySource: { participant: number; scripted: number; engine: number; noise: number }
}

export interface ExerciseReport {
  exercise: {
    name: string
    timeZone: string
    scenarioStart: string | null
    scenarioEnd: string | null
    /** "yyyy-MM-dd" of scenarioStart. */
    conductedDate: string | null
    /** "yyyy-MM-dd HH:mm" in the exercise zone. */
    preparedAt: string
    /** Story 31: the latest post scenario day, 00:00 to 23:59 ("yyyy-MM-dd HH:mm"), or null. */
    latestDay: { from: string; to: string } | null
    /** Story 31: printed times fall on more than one exercise-zone date (drives date display). */
    spansMultipleDays: boolean
  }
  summary: ReportSummary
  activity: {
    /**
     * Bin width in scenario minutes. 5 for short exercises; the server widens it for long spans
     * (5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, then whole days) so there are at most 300 bins.
     */
    binMinutes: number
    bins: ReportActivityBin[]
    injectMarkers: ReportInjectMarker[]
  }
  injectResponses: ReportInjectResponse[]
  lookalikes: ReportLookalikePair[]
  posts: ReportPost[]
  /** Noise posts left out by the source filter; 0 when `noise` is selected. */
  omittedNoiseCount: number
  /** Story 30: what the post record matched, and whether it was withheld for size. */
  postRecord: ReportPostRecord
}

/** The sources the record can be filtered by (`participant` includes controller-as-persona). */
export type ReportSourceKey = 'participant' | 'scripted' | 'engine' | 'noise'

/** Story 30 (DF-43/DF-44): the post record's filter echo. `withheld` => `posts` is []. */
export interface ReportPostRecord {
  matching: number
  limit: number
  withheld: boolean
  sources: ReportSourceKey[]
  from: string | null
  to: string | null
}

/** The record filters; `from`/`to` are exercise-zone "yyyy-MM-dd HH:mm" or null. */
export interface ReportFilters {
  sources: ReportSourceKey[]
  from: string | null
  to: string | null
}
