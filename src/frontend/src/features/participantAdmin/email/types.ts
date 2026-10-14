/**
 * features/participantAdmin/email/types.ts
 * ---------------------------------------------------------------------------
 * The email half of the FROZEN wire contract (docs/features/easy-login/
 * implementation.md, "email (staff, story 13 only)"), field for field with
 * `src/Pulse.WebApi/Features/Identity/EasyLogin/EasyLoginDtos.cs`
 * (`RosterEmailLinksBody`, `RosterEmailResultDto`, `RosterEmailResultItemDto`,
 * `RosterEmailStatuses`).
 *
 *   POST /api/staff/roster/email-links   { participantIds?: string[] }
 *     none = every eligible participant (at most 100); 1..100 ids otherwise
 *   200 -> RosterEmailResultDto   400 -> body refused / too many
 *   401 / 403 -> no staff session / not controller|planner   503 -> email not configured
 *
 * No exercise id anywhere (COR-001). A result names an id and a fixed reason,
 * never an address, a token or a URL.
 *
 * World: STAFF. Types only.
 */

/** The per-participant outcome. */
export type RosterEmailStatus = 'sent' | 'skipped' | 'failed'

/** Why a participant was skipped (story 13 AC). `notFound` covers another exercise's id. */
export type RosterEmailSkipReason =
  | 'noEmail'
  | 'noActiveLink'
  | 'disabled'
  | 'tokenUnrecoverable'
  | 'notFound'

/**
 * Why a send failed. The contract types `reason` as a generic string; these are
 * the values the server sends today. An unknown value is shown generically.
 */
export type RosterEmailFailureReason = 'sendFailed' | 'rateLimited' | 'notAttempted' | 'timedOut'

/** One participant's result. `reason` is omitted when sent. */
export interface RosterEmailResultItemDto {
  participantId: string
  status: RosterEmailStatus
  reason?: string
}

/** The 200 body. */
export interface RosterEmailResultDto {
  results: RosterEmailResultItemDto[]
}

/** The request body: `{}` (everyone eligible) or `{ participantIds }`. */
export interface RosterEmailLinksBody {
  participantIds?: string[]
}
