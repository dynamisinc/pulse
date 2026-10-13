# Story: Roster provisioning: CSV, add one, list, personas

**Feature:** Easy participant login  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-011, COR-017 (part: roster and diagnosis view), COR-018 (org-persona binding at provisioning)  ·  **Design decisions:** none (EL-1 to EL-4, EL-13, EL-17)  ·  **Issue:** #467
**Stack:** backend  ·  **Review:** Tier-1 (staff-only writes; isolation and content security checked at Gate 1)  ·  **Priority:** Must  ·  **Wave:** 1  ·  **Effort:** L

## Context

Staff need to get 100 people into an exercise in a minute, with a persona each, so that every participant can
post (today's staff CSV import creates accounts with **no persona**, so there is no composer; see
`identity-auth-roles/10`). This story is the roster API: a CSV upload, a one-at-a-time add, and the list the
console renders. It is staff-world only (COR-011: no self-registration; this endpoint is not reachable
anonymously or by a participant session).

A row creates a participant `Account` (no password), a sign-in name, and a persona: an org handle binds that
existing org persona, anything else gets an auto-created citizen persona (EL-4). Re-uploading the file is
safe (EL-3). Every new participant gets a personal link through `IParticipantLinkIssuer` (story 03 supplies
the real one). The CSV columns, the derivation rules and the wire shapes are frozen in
[`implementation.md`](implementation.md#frozen-wire-contract).

## Acceptance Criteria

- [ ] **Given** a CSV whose header has `name` (or `displayName`) and any of `agency`, `role`, `email`,
      `personaHandle`, `signInName`, **when** it is posted to `POST /api/staff/roster/import`, **then** it is
      parsed (UTF-8, a BOM tolerated, unknown columns ignored, blank lines skipped, legacy aliases `displayName`
      and `username` accepted) and answered `200 RosterImportResultDto` with one row result per data row. A
      missing/empty file, a file over 1 MB, a non-CSV upload, a missing `name` column, or more than 5000 rows is
      a `400` with a readable reason and nothing written.
- [ ] **Given** valid rows, **when** imported, **then** each creates one `Account` (participant-world role, no
      credential, `Agency`/`JobRole`/`Email` stored sanitized), a sign-in name (the CSV value if valid and free,
      otherwise derived per the frozen rules: `Jane Smith` is `jsmith`, a clash gives `jsmith2`, a clash against an
      earlier row in the same file counts), and a persona. All created rows commit in **one** `SaveChanges`; a
      failed row is reported with its reason and writes nothing. With `?dryRun=true` the **same report** comes back
      and **nothing is written** (no account, persona, link or event).
- [ ] **Given** a `personaHandle`, **then** the row binds that persona if it exists **in this exercise** and is
      `Kind = org`, and the account's `ExerciseRole` is `pio`. An unknown handle, a handle that only exists in
      another exercise, and a non-org persona **all fail the row with the same message**. **Given** no
      `personaHandle`, **then** a citizen persona is created from the name (`Kind = human`, `PersonaType = citizen`,
      `Verified = false`, `AudienceBand = nano` with `AudienceMagnitude` from `PersonaCastSeeder.DeriveAudienceMagnitude`,
      **`Castable = false`**, no bio) with a derived unique handle (`jane_smith`, then `_2`), `PersonaAutoCreated = true`,
      `ExerciseRole = participant`, and the row reports `personaCreated: true`. Two rows may name the same org
      handle: each keeps its own account and acting human (COR-018).
- [ ] **Idempotent re-upload.** **Given** the same file posted again, **then** every row is `unchanged`: zero
      accounts, personas, links or `roster.imported` rows are created. Rows are matched by identity key
      (`signInName` > `email` > `name + agency`, case-insensitive). **Given** a changed agency, role, email, display
      name (matched by sign-in name or email) or org-persona binding, **then** the row is `updated` and says what
      changed. A blank cell never clears a stored value, and a blank `personaHandle` keeps the current persona. Two
      rows in one file with the same key fail the later one with a message naming the earlier row.
- [ ] **Given** `POST /api/staff/roster` with a `RosterRowWrite`, **then** it creates one participant the same way
      and answers `201 RosterEntryDto`; a key that already exists answers `409`; an invalid field answers `400`.
- [ ] **Given** `GET /api/staff/roster`, **then** it lists **every account in the exercise** (including ones the
      legacy import or the bootstrap created, which show no agency and `link.status: 'none'`) as `RosterEntryDto`:
      persona (omitted when none), link state, `access`, `liveSessions` (this account's sessions in this exercise that are
      not revoked and whose access or refresh window is still open, so a locked phone still counts), `lastSignInAt`, plus `joinLinksAvailable` and `capabilities.emailLinks`. Ordered by name. The
      response is `Cache-Control: no-store`.
- [ ] **Given** a newly created participant, **then** `IParticipantLinkIssuer.EnsureActiveAsync` is called so they
      have an active link before the response returns; an existing active link is never rotated by a re-upload.

### Cross-cutting
- [ ] **Isolation (XC-001/COR-001):** account, persona and link rows are stamped from `IExerciseContext`, never
      from the request, and every lookup runs through the central filter. A staff user of exercise A cannot
      list, match, update or bind anything in B; a persona handle from B behaves exactly like an unknown handle
      (same row message). Extends the standing isolation suite with a roster case.
- [ ] **Telemetry (XC-004):** a non-dry-run import emits one `roster.imported` event (counts only), and each
      newly issued link emits `participant.link.issued`. Staff actor with role and acting human; no name, email or
      token in any payload.
- [ ] **Content security (NFR-004):** name, agency, role and the persona-handle cell are stripped of markup with
      `PostSanitizer` (a row that is only markup fails); lengths are bounded (name 256, agency 128, role 128, email
      254, handle 256); the email is checked with a simple address pattern; MIME/size are validated at the boundary
      like `/api/staff/accounts/import`. `email` appears on **no** participant-facing projection (XC-002): only
      `RosterEntryDto`, which is staff-only.
- [ ] **Authorization (EL-13):** every route is behind `EngineCockpitStaffAuthorizationFilter` then
      `RosterStaffRoleFilter`: 401 with no staff session, 403 for an evaluator or an unassigned user, and a
      participant or read-only session never reaches the handler.

## Out of Scope

Link issuing, revoking and the join endpoint (03). Cards and QR (04). Disable/enable (03). Editing or deleting
a participant one at a time (re-upload corrects; a single-edit form stays on `identity-auth-roles/08`).
Changing the legacy `/api/staff/accounts*` endpoints. Setting passwords (the new paths have none). Moving or
renaming an auto-created persona when a name changes. Emailing (13).

## Technical Notes

Backend. New folder `Features/Identity/Roster/`: `RosterEndpoints` (`AddRoster()` / `MapRosterEndpoints()`),
`RosterService` (import and add share one `ApplyRow` so dry-run and real run cannot diverge), `RosterCsvParser`,
`SignInNameDeriver`, `PersonaHandleDeriver`, `CitizenPersonaFactory`, `RosterQueryService`. Make
`AccountCsvParser.SplitLines`/`ParseLine` and `AccountEndpoints.IsCsvUpload` `internal` (visibility only, no
behaviour change, existing tests untouched). Read exercise facts only through `ExerciseFactsReader`. Persona
lookups use the normal filtered `_dbContext.Personas` (a staff request has a resolved scope; do **not** copy
`OpsPersonaResolver`'s `IgnoreQueryFilters`). Duplicate-handle races surface as a DB unique-index violation:
catch it and report the row as failed rather than a 500. The `(ExerciseId, Username)` unique index is
case-insensitive, so de-duplicate case-insensitively in memory first. Route registration order: the literal
`/api/staff/roster/import` and `/cards` must not be shadowed by `{id:guid}` routes (those belong to story 03).
See `implementation.md` (story 02, gotchas 3, 4, 5).

## Dependencies

Story 01 (entities, DTOs, kernel, `RosterStaffRoleFilter`, `ExerciseFactsReader`, `IParticipantLinkIssuer`).
Story 03 supplies the real issuer; until then the null default makes new rows report no link, so run the
seam commit with both. Consumed by stories 10, 13, 14.

## Tests

`Pulse.WebApi.Tests/Features/Identity/Roster/`: `RosterCsvParserTests` (header aliases, BOM, quoting, caps),
`SignInNameDeriverTests` (the frozen examples, collisions, short names), `PersonaHandleDeriverTests`,
`RosterServiceTests` (create, update, unchanged, dry-run writes nothing, partial apply, persona rules,
`Castable = false`, ExerciseRole, duplicate-in-file), `RosterEndpointsHttpTests` (200/201/400/409/401/403,
`no-store`), `RosterIsolationTests` (`[RequiresDockerFact]`: cross-exercise persona handle, list, update),
`RosterContentSecurityTests` (stored script in name/agency/role, oversize, wrong MIME).
