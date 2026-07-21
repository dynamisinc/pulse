/**
 * features/planner/types.ts
 * ---------------------------------------------------------------------------
 * Public domain types for the staff-console planner surface (feature:
 * identity-auth-roles, story 02 — named participant accounts; COR-011).
 *
 * These mirror the FROZEN backend `AccountImportResultDto` /
 * `AccountImportRowResultDto` shapes the account slice returns from
 * `POST /api/staff/accounts/import` (see
 * `src/Pulse.WebApi/Features/Identity/Accounts/AccountDtos.cs`). They are the
 * client-side contract the import panel + its service/hook render against; the
 * transport wire body is validated at the service boundary
 * (`services/accountImportService.ts`) before it is ever surfaced as one of
 * these, so a live backend swap fails closed on a malformed body rather than
 * casting garbage into this shape.
 *
 * World: STAFF (COBRA). This surface is exempt from the participant
 * scenario-time rule (COR-053) — the import result carries no
 * participant-visible timestamps, and nothing here renders in-fiction.
 */

/** A single imported CSV row's outcome (`created` or `failed`). */
export type AccountImportRowStatus = 'created' | 'failed'

/**
 * One row's import outcome — the 1-based data-row index (header not counted),
 * the (server-sanitized) handle it referred to, its status, and — for a failed
 * row only — a human-readable failure reason.
 */
export interface AccountImportRowResult {
  readonly rowNumber: number
  readonly username: string
  readonly status: AccountImportRowStatus
  readonly message?: string
}

/**
 * The bulk-import result: aggregate counts plus a per-row outcome list (in file
 * order), so the panel can render exactly which rows landed and why the rest
 * did not.
 */
export interface AccountImportResult {
  readonly totalRows: number
  readonly createdCount: number
  readonly failedCount: number
  readonly rows: readonly AccountImportRowResult[]
}
