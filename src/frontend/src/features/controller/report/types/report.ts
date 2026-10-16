/**
 * features/controller/report/types/report.ts
 * ---------------------------------------------------------------------------
 * The FROZEN response contract of `GET /api/staff/exports/report?includeNoise=` (demo-feedback
 * story 29, docs/features/demo-feedback/29-printable-exercise-report.md "Contract"). Copied
 * from the story; the backend builds the same shape. Do not widen it here: change the story first.
 *
 * Every time is an exercise-zone SCENARIO time already formatted by the server:
 * "yyyy-MM-dd HH:mm" (`*At`, `start`) or "HH:mm" (`*Time`). The client never converts zones.
 * Handles arrive with their "@" prefix. STAFF world only: provenance (origin, posted by,
 * inject ref) never reaches a participant.
 */

export interface ReportAccount {
  handle: string
  displayName: string
  verified: boolean
  likes: number
  reposts: number
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
}

export interface ReportActivityBin {
  start: string
  participant: number
  scripted: number
  engine: number
  noise: number
}

export interface ReportInjectMarker {
  ref: string
  title: string
  at: string
  binIndex: number
}

export interface ReportInjectResponse {
  ref: string
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
  lookalikes: { verified: ReportAccount; lookalike: ReportAccount }[]
  posts: ReportPost[]
  /** 0 when includeNoise=true. */
  omittedNoiseCount: number
}
