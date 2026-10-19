/**
 * features/participantAdmin/cards/types.ts
 * ---------------------------------------------------------------------------
 * The CARDS half of the frozen easy-login wire contract (docs/features/easy-login/
 * implementation.md, "Frozen wire contract" -> "cards (staff)"), for the printable
 * card sheet (story 12). Mirrors `RosterCardDto` / `RosterCardsDto` in
 * `src/Pulse.WebApi/Features/Identity/EasyLogin/EasyLoginDtos.cs`.
 *
 * Deliberately its own file (not the roster's `participantAdmin/types.ts`, which the
 * roster-screen story owns) so the two stories never touch the same file.
 *
 * Wire rules that matter here: JSON is camelCase; an absent optional field is OMITTED
 * (never `null`); no request carries an exercise id (the server scopes everything,
 * COR-001).
 *
 * SECRETS. `joinUrl` is a bearer credential (anyone holding it can sign in as that
 * person), and `qrSvgDataUri` encodes exactly that URL. Both live only in React Query
 * data and in the preview/print DOM: never in a toast, a log, a title or a URL.
 *
 * World: STAFF (types only; the printed card itself is a neutral logistics artifact).
 */

/**
 * One person's printable card. Only people with an enabled account and an active,
 * recoverable link get one.
 */
export interface RosterCardDto {
  participantId: string
  name: string
  agency?: string
  /** Free-text job label ("EOC Liaison"). NOT an ExerciseRole. */
  role?: string
  /** `Account.Username`: what the person types with today's word. */
  signInName: string
  /** SECRET. `{FrontendBaseUrl}/join/{token}`. */
  joinUrl: string
  /** SECRET. `data:image/svg+xml;base64,...` encoding exactly `joinUrl`. */
  qrSvgDataUri: string
}

/** Why a requested (or eligible) person did not get a card. */
export type RosterCardSkipReason =
  'notFound' | 'noActiveLink' | 'disabled' | 'tokenUnrecoverable'

/** A person left off the sheet. The server never names them here: only the id and the reason. */
export interface RosterCardSkippedDto {
  participantId: string
  reason: RosterCardSkipReason
}

/**
 * `POST /api/staff/roster/cards` request body (EL-20). EXACTLY ONE of the two shapes:
 * `{ participantIds }` (1 to 500 ids) or `{ all: true }`. Anything else is a 400 (both,
 * neither, an empty array, more than 500 ids, an unknown property). "Everyone" is only ever
 * the explicit `{ all: true }`, never an empty array and never an absent field.
 */
export type RosterCardsRequest =
  | { participantIds: string[] }
  | { all: true }

/** `POST /api/staff/roster/cards` 200 body. */
export interface RosterCardsDto {
  /**
   * The PARTICIPANT-facing exercise name, or null when none is set (story 09). Cards print the
   * brand only on null: no placeholder, never the internal name.
   */
  exerciseName: string | null
  cards: RosterCardDto[]
  skipped: RosterCardSkippedDto[]
}
