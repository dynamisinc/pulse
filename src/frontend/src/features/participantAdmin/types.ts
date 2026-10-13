/**
 * features/participantAdmin/types.ts
 * ---------------------------------------------------------------------------
 * The ROSTER half of the FROZEN easy-login wire contract (feature: easy-login,
 * story 10; decisions EL-1..EL-14 in docs/features/easy-login/implementation.md).
 *
 *   src/frontend/src/features/participantAdmin/**
 *       ⇄  src/Pulse.WebApi/Features/Identity/EasyLogin/EasyLoginDtos.cs
 *
 * These are the shapes of `GET/POST /api/staff/roster…`. They are copied from
 * the contract verbatim (field names, optionality, literal unions). A change is
 * an orchestrator decision made in `implementation.md` FIRST; never "fix" a type
 * here to make a screen compile.
 *
 * Deliberately NOT here: the card, day-word and email shapes. Those belong to
 * stories 12, 11 and 13, which own their own folders
 * (`cards/`, `dayWord/`, `email/`) so this story stays disjoint from them.
 *
 * Conventions the server promises (and `rosterService` relies on):
 *  - JSON is camelCase; an absent optional field is OMITTED, never `null`;
 *  - instants are ISO-8601 (`"O"` round trip);
 *  - NO request carries an exercise id — the server scopes everything
 *    (COR-001). A cross-exercise participant id is indistinguishable from an
 *    unknown one (404).
 *
 * SECRETS: `RosterLinkDto.joinUrl` is a bearer credential. It exists only in
 * React Query data and is handed to the clipboard; it is never rendered as DOM
 * text, put in a toast, a log, a `title` or a URL (story 10, "Secrets").
 *
 * World: STAFF. Pure types — no UI.
 */

/** Whether a participant's personal link is usable. */
export type RosterLinkStatus = 'active' | 'revoked' | 'none'

/** The persona a participant posts as. */
export interface RosterPersonaDto {
  id: string
  /** Persona handle, stored WITHOUT the leading '@'. Public, in-fiction. */
  handle: string
  displayName: string
  kind: 'human' | 'org'
  /** True = the citizen persona the roster made for this person (EL-4). */
  autoCreated: boolean
}

/** A participant's personal-link state. */
export interface RosterLinkDto {
  status: RosterLinkStatus
  issuedAt?: string
  revokedAt?: string
  lastUsedAt?: string
  useCount: number
  /** SECRET. Only when `status === 'active'` and the stored token is recoverable. */
  joinUrl?: string
  /** Active, but the stored token cannot be decrypted (key ring lost, EL-5). */
  needsReissue?: boolean
}

/** One participant row in `GET /api/staff/roster`. */
export interface RosterEntryDto {
  /** The ACCOUNT id; the only id any roster action ever sends. */
  id: string
  /** `Account.DisplayName`. */
  name: string
  agency?: string
  /** Free-text job label. NOT an `ExerciseRole` (EL-1). */
  role?: string
  /** Staff-only (XC-002): never on any participant projection. */
  email?: string
  /** `Account.Username` — what the participant types. Not the persona handle (EL-1). */
  signInName: string
  exerciseRole: 'participant' | 'pio'
  /** Omitted when the account has no persona. */
  persona?: RosterPersonaDto
  link: RosterLinkDto
  access: 'enabled' | 'disabled'
  /** Sessions not revoked and still usable (access or refresh window open). */
  liveSessions: number
  /** `Account.LastLoginAt`. */
  lastSignInAt?: string
  createdAt: string
}

/** `GET /api/staff/roster` body. */
export interface RosterListDto {
  participants: RosterEntryDto[]
  /** False when `Authentication:FrontendBaseUrl` is unset (EL-6): no join URLs exist. */
  joinLinksAvailable: boolean
  /** `emailLinks` is false until story 13 is configured. */
  capabilities: { emailLinks: boolean }
}

/** `POST /api/staff/roster` body (add one participant). */
export interface RosterRowWrite {
  /** Required, 1..256, sanitized by the server. */
  name: string
  /** <= 128. */
  agency?: string
  /** <= 128. */
  role?: string
  /** <= 254, simple address check. */
  email?: string
  /** An ORG persona in this exercise; a leading '@' is tolerated. */
  personaHandle?: string
  /** `^[a-z0-9][a-z0-9._-]{2,31}$` after trim + lower-case. */
  signInName?: string
}

/** What a CSV row turned into. */
export type RosterRowStatus = 'created' | 'updated' | 'unchanged' | 'failed'

/** One row of an import (or dry-run) report. */
export interface RosterImportRowDto {
  /** 1-based data row; the header is not counted. */
  rowNumber: number
  name: string
  /** The name the row resolved to (derived or given), when known. */
  signInName?: string
  status: RosterRowStatus
  /** The persona the row ended up bound to. */
  personaHandle?: string
  /** An auto citizen persona was created for this row. */
  personaCreated: boolean
  /** Reason when failed; what changed when updated. */
  message?: string
}

/** `POST /api/staff/roster/import?dryRun=…` body. */
export interface RosterImportResultDto {
  dryRun: boolean
  totalRows: number
  createdCount: number
  updatedCount: number
  unchangedCount: number
  failedCount: number
  rows: RosterImportRowDto[]
}

/** Body of the four per-participant actions (reissue, revoke, disable, enable). */
export interface RosterActionResultDto {
  participantId: string
  link: RosterLinkDto
  access: 'enabled' | 'disabled'
  sessionsEnded: number
}

/** The four per-participant mutations the roster offers (`/{id}/link/reissue` …). */
export type RosterActionKind = 'reissue' | 'revoke' | 'disable' | 'enable'
