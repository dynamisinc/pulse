/* eslint-disable @stylistic/max-len -- the contract below is copied VERBATIM (trailing comments and all) */
/**
 * features/controller/runSheet/types.ts
 * ---------------------------------------------------------------------------
 * The FROZEN wire contract between the server-side inject queue (story 06,
 * `Features/Injects/InjectDtos.cs`) and this console run sheet (story 07).
 * Copied VERBATIM from `docs/features/inject-queue/implementation.md` §
 * "Demo slice — scripted posts, server-side" -> "Wire contract (frozen for
 * 06 <-> 07)". Do not add, rename or re-type a field here without changing that
 * section and the backend DTOs in the same breath: the console compiles against
 * this file and the live service (`injectService.ts`) parses the wire against it.
 *
 * STAFF world only (the machine). `InjectItemDto` carries staff-only fields
 * (`updatedAt`, `firedWallClock`, `createdByHumanId`, `error`) that must never
 * reach a participant surface (XC-002). Nothing here has an `exerciseId`: the
 * server scopes every request to the session's exercise (COR-001); a
 * cross-exercise id is indistinguishable from an unknown one.
 *
 * Helpers that are NOT part of the wire (limits, filters, draft model) live in
 * `injectRules.ts` / `injectDraft.ts` so this file stays a pure contract.
 */

export type InjectKind = 'post' | 'burst'
export type InjectStatus = 'pending' | 'held' | 'firing' | 'fired' | 'skipped' | 'failed'
export type InjectPostStatus = 'pending' | 'fired' | 'skipped' | 'failed'

export interface InjectPostWrite {
  personaId: string
  text: string                                            // 1..280 code points
  media?: { mediaId: string; alt: string }[]              // <= 4 images OR exactly 1 video; alt 1..1000
  replyTo?: { injectPostId: string } | { postId: string } // an earlier scripted post, or an existing post
  engagementBaseline?: { like?: number; repost?: number; reply?: number }   // 0..1,000,000
}
export interface InjectItemWrite {
  kind: InjectKind
  title: string                                           // 1..120
  notes?: string                                          // <= 500
  plannedMinute?: number                                  // integer >= 0; display + sort hint only
  assigneeId?: string | null                              // a staff user assigned to this exercise
  burstWindowSeconds?: number                             // burst only; 30..600; default 90
  posts: InjectPostWrite[]                                // post: exactly 1; burst: 2..20
}
export interface InjectPostDto extends InjectPostWrite {
  id: string
  sequence: number                                        // 1-based within the item
  status: InjectPostStatus
  dueOffsetSeconds?: number                               // burst pacing, from release
  firedPostId?: string
  firedScenarioTime?: string                              // ISO instant (exercise clock)
  firedWallClock?: string                                 // staff-only
  firedByHumanId?: string
  error?: string
}
export interface InjectItemDto extends Omit<InjectItemWrite, 'posts'> {
  id: string
  order: number                                           // 1-based
  status: InjectStatus
  assigneeName?: string
  posts: InjectPostDto[]
  firedCount: number
  total: number
  version: number
  createdByHumanId: string
  updatedAt: string                                       // wall-clock, staff-only
  firedByHumanId?: string                                 // who pressed Fire (first release)
  firedScenarioTime?: string
  error?: string
}
export interface InjectQueueDto {
  items: InjectItemDto[]
  pauseTier: 'running' | 'injects' | 'engine' | 'freeze'  // so the panel can show the suspended/frozen state
}
export interface InjectAssigneesDto {
  me: string                                              // the caller's staff id (same id space as assigneeId)
  assignees: { id: string; displayName: string; role: string }[]
}
