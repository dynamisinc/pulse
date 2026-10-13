/**
 * features/participantAdmin/dayWord/types.ts
 * ---------------------------------------------------------------------------
 * The DAY-WORD half of the frozen easy-login wire contract
 * (docs/features/easy-login/implementation.md, "Frozen wire contract" ->
 * "Types" -> "day word (staff)"), copied here on purpose so story 11 does not
 * import from story 10's files (the roster half lives in `../types.ts`, owned by
 * story 10). A change to these shapes is an orchestrator decision made in
 * implementation.md first.
 *
 * Mirrors `src/Pulse.WebApi/Features/Identity/EasyLogin/EasyLoginDtos.cs`
 * (backend story 01) and the routes in backend story 05:
 *
 *   GET    /api/staff/day-word               -> 200 DayWordStatusDto
 *   PUT    /api/staff/day-word   DayWordPutBody  -> 200 DayWordSetResultDto | 400
 *   DELETE /api/staff/day-word?date=yyyy-MM-dd   -> 204 (idempotent) | 400
 *
 * Wire conventions (frozen): camelCase JSON; an absent optional field is
 * OMITTED, never `null`; instants are ISO-8601; `date` is `yyyy-MM-dd`. No
 * request carries an `exerciseId` - the server scopes everything (COR-001).
 *
 * WORLD: staff (COBRA). Pure types + constants - no UI.
 */

/** `GET /api/staff/day-word`. NEVER carries a word (only a hash is stored, EL-9). */
export interface DayWordStatusDto {
  /** IANA name of the exercise time zone, e.g. `America/New_York`. */
  timeZone: string
  /** `yyyy-MM-dd` in that zone: the real wall-clock date, never scenario time (EL-9). */
  today: string
  /** The next local rollover, as an instant. */
  todayEndsAt: string
  todaySet: boolean
  setAt?: string
  setByName?: string
  /** Times today's word was replaced after it was first set. */
  replacedCount: number
  /** Words pre-set for later dates - the dates only, never the words. */
  upcoming: DayWordUpcomingDto[]
}

export interface DayWordUpcomingDto {
  date: string
  setAt: string
}

/** `PUT /api/staff/day-word` body. */
export interface DayWordPutBody {
  /** Omit and the server generates one. */
  word?: string
  /** Today (the default) up to 14 days ahead; never the past. */
  date?: string
}

/** `PUT /api/staff/day-word` 200 body. */
export interface DayWordSetResultDto {
  date: string
  /** SECRET. Plaintext, returned this once and never stored or re-readable. */
  word: string
  generated: boolean
  /** True = this replaced a word already set for that date (a rotation). */
  replaced: boolean
  setAt: string
  /** The rollover instant that ends that date. */
  validUntil: string
}

/** The shortest accepted word, counted AFTER normalisation (backend story 05). */
export const DAY_WORD_MIN_LENGTH = 6

/** The longest accepted word, counted AFTER normalisation (backend story 05). */
export const DAY_WORD_MAX_LENGTH = 64

/** How many days past today a word may be pre-set (backend story 05). */
export const DAY_WORD_MAX_DAYS_AHEAD = 14
