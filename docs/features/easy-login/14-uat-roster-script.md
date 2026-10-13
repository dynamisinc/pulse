# Story: UAT tester provisioning script

**Feature:** Easy participant login  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-011 (staff-provisioned only)  ·  **Design decisions:** none (EL-2, EL-13)  ·  **Issue:** #479
**Stack:** script (PowerShell 7)  ·  **Review:** Tier-1  ·  **Priority:** Could  ·  **Wave:** 2  ·  **Effort:** S

## Context

Four or five colleagues stress-test Pulse before the demo, and someone has to give each of them a login. Today that
is `scripts/uat/New-DemoParticipant.ps1`: one participant at a time, a password you type twice, through the
secret-gated ops route. With the roster API there is a better way for testers: a CSV in, a table of sign-in names
out, and their personal links in a local file, with no password to invent or relay.

This is optional and cheap. It **calls the public roster API as a staff user**, so it exercises the same path as the
console (and the same authorization), rather than the ops bootstrap route. It needs the backend seam deployed (stories
02, 03, 05 live on UAT).

## Acceptance Criteria

- [ ] **Given** `pwsh scripts/uat/Import-Roster.ps1 -CsvPath roster.csv`, **then** it signs in to the UAT API as a
      staff user (`-StaffUsername`, default `controller1`) with the staff secret taken from `$env:PULSE_STAFF_SECRET`
      or, failing that, from the App Service settings through the caller's own `az` login (the approach
      `Copy-StaffSecret.ps1` uses), calls `POST /api/auth/staff/login`, uploads the file to
      `POST /api/staff/roster/import`, and signs out (`POST /api/auth/logout`) in a `finally`.
- [ ] **Given** `-DryRun`, **then** it uploads with `?dryRun=true` and writes nothing; either way it prints the counts
      and a table of **row, name, sign-in name, status, message** (failed rows in red text with the reason) and exits
      `1` if any row failed, `0` otherwise.
- [ ] **Given** a real import, **then** it fetches `GET /api/staff/roster` and writes `name, signInName, joinUrl` for
      every participant in the file to `-OutFile` (default `scripts/uat/out/roster-links-<yyyyMMdd-HHmmss>.csv`) and
      prints only that **path**, never a link. `scripts/uat/out/` is added to `.gitignore` so a link file cannot be
      committed. With `-CopyLinks` the links are also placed on the clipboard (never echoed).
- [ ] **Given** `-GenerateWord` or `-Word <text>`, **then** after the import it sets today's word through
      `PUT /api/staff/day-word` and prints the word once (it is meant to be read out), copying it to the clipboard.
      Neither the staff secret, a session token, nor a join link is ever written to the console, a transcript or a log.
- [ ] **Given** an error (bad secret, `401`/`403`, no active exercise, `400` from a malformed CSV), **then** it prints
      the server's readable reason and exits `1` without a stack trace; a `404`/connection failure explains how to check
      `-ApiHost`.
- [ ] **Given** `New-DemoParticipant.ps1`, **then** its header gains a note that testers should use `Import-Roster.ps1`
      (the single-participant, password-based ops script is otherwise unchanged and still works).

### Cross-cutting
- [ ] **Secrets (NFR-009):** the script follows the existing scripts' rule ("never printed, logged or written to disk")
      for the staff secret and tokens; the only secrets it writes are the participant join links, to the gitignored
      local file the operator asked for, with the file's permissions restricted to the current user where the platform
      supports it.
- [ ] **Isolation:** the operator never names an exercise; the login sends the host's resolved exercise (from
      `GET /api/exercise-context`), as `StaffSignInPage` does, and no roster or day-word request carries an exercise id:
      the staff session's active exercise decides where people land.

## Out of Scope

Replacing `New-DemoParticipant.ps1`. Provisioning staff users. Bulk reissue or revoke. Emailing links (13). Running
against anything but the UAT defaults without explicit parameters. (A Pester harness is now **in scope**: see Tests.)

## Technical Notes

Script, `scripts/uat/Import-Roster.ps1`, dot-sourcing `Common.ps1` (`Invoke-Az`), PowerShell 7.4+ (the links file is
created mode 600 from its first byte, which needs .NET 8). PowerShell 7 `Invoke-WebRequest
-Form @{ file = Get-Item $CsvPath }` does the multipart upload. Defaults (`-ApiHost`, `-SiteUrl`, `-Subscription`,
`-ResourceGroup`, `-WebAppName`) match `New-DemoParticipant.ps1`. Add `-CheckOnly` only if it is free (sign in, call
`GET /api/staff/roster`, report the count). The staff login body is `{ username, secret, exerciseId }`
(`StaffLoginService` refuses a login without `exerciseId` with a 400); `exerciseId` is the host's, from
`GET /api/exercise-context`. See `implementation.md` (story 14).

## Dependencies

Backend stories 02, 03 and 05 deployed to UAT (the seam commit and the freeze deploy). Independent of the frontend.

## Tests

Pester (in scope since the `Seed-DemoContent.Tests.ps1` precedent): `scripts/uat/Import-Roster.Tests.ps1`, Pester 5
with no network (an in-memory fake API behind a mocked `Invoke-WebRequest`), covering the request shapes, exit codes,
the links file (contents, formula escaping, permissions, the `-OutFile` checks), `-DryRun`, today's word, sign-out on
failure, readable errors, and no secret, token or join link in any output stream or `$Error`.

Manual, recorded in the PR: `-DryRun` with a CSV containing a bad persona handle (the row fails, nothing
is created); a real import (five rows created, file written, no link on screen); the same file again (five
`unchanged`); `-GenerateWord`; a wrong staff secret (clean error, exit 1). Record the run in the PR.
