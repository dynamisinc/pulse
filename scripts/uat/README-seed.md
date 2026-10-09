# Seed-DemoContent.ps1: how to run it and how each AC is tested

Story: `docs/features/demo-polish/24-seed-script.md` (S1, #443). The full behaviour is in the script's
comment-based help: `Get-Help scripts/uat/Seed-DemoContent.ps1 -Full`.

## Run

```powershell
pwsh scripts/uat/Seed-DemoContent.ps1 -WhatIf                              # validate + plan; no sign-in, no writes
pwsh scripts/uat/Seed-DemoContent.ps1 -StaffUsername controller1           # full run (hidden secret prompt, or $env:PULSE_STAFF_SECRET)
pwsh scripts/uat/Seed-DemoContent.ps1 -StaffUsername controller1 -Resume   # finish a partial run on its original anchor
```

Run-of-show: `Clear-DemoContent.ps1` (optional), then `Reset-DemoState.ps1`, then this script.

## Test

```powershell
Invoke-Pester scripts/uat/Seed-DemoContent.Tests.ps1 -Output Detailed       # Pester 5; no network
```

```bash
cd src/frontend && npx vitest run src/features/controller/runSheet/seedRunSheet.golden.test.ts
```

Most tests run against an in-memory fake behind a mocked `Invoke-WebRequest`. The "Real HTTP, no mocks"
block starts a `System.Net.HttpListener` on localhost instead, so the real web cmdlet runs: its debug
stream, its error records and its redirect handling.

The golden file `test-fixtures/runsheet.demo.golden.json` is exactly what the seeder exports for the fixture
pack. Pester checks it byte for byte, and the vitest runs it through C3's real `parseRunSheetFile`. To
regenerate it after a deliberate change, set `$env:SEED_UPDATE_GOLDEN = '1'` for one Pester run.

## Acceptance criteria → tests

| AC | Evidence (Pester `Describe` › `It`, unless noted) |
|----|----|
| **Script and safety** (parameters; anonymous exercise-context first; `{username, secret, exerciseId}` login; secret from `PULSE_STAFF_SECRET` or a hidden prompt; secret and tokens never printed, logged or written) | Secrets never leave memory › *no secret or token in any output stream, the manifest or the run sheet*; › *the secret is sent only in the login body…*; › *a rejected secret exits 1 without echoing it*; › *refuses plain http to anything but localhost*. Real HTTP › *H-1: a full run with -Debug -Verbose…*; › *M-1: after a connection failure neither $Error nor Get-Error holds the token*; › *L-5: a redirect is never followed…* |
| **Public APIs only** (allowlisted paths; no `sqlcmd` or SQL) | Public APIs only › *the script names no API path outside the allowlist*; › *the grep catches a forbidden path*; › *the script has no database client, sqlcmd or SQL*; › *refuses a non-allowlisted path at runtime too* |
| **Engine paused by default** (`{"tier":"engine"}` plus the `actingHumanId` the server requires; applied tier reported; `-LeaveEngineRunning`) | End to end › *uploads the poster first… posts carry the real request shape* (GET then one POST, with `actingHumanId`); › *-LeaveEngineRunning never touches the pause tier*. Gate-1 folds end to end › *L-6: a frozen world stays frozen*; › *L-6: a running engine is paused once and reported* |
| **Validate first, write nothing on error; -WhatIf** | Pack validation › *<Name> -> <Code>* (one case per rule, markup included), plus *file over the server limit*, *empty file*, *L-7: a symbolic link…*, *counts code points…*, *the JSON Schema…*, *an invalid pack exits 1 before any request*, *malformed JSON exits 1…*. End to end › *-WhatIf prints the plan, signs in to nothing and writes nothing* |
| **Media upload** (once each; poster first, then the video with `posterMediaId`; 429 → `Retry-After`; SHA-256 manifest; no re-upload; `-Resume`) | Manifest and idempotency › *uploads posters first…*, *second run: zero uploads and zero posts*, *re-uploads a file whose bytes changed…*, *re-uploads an asset that is gone…*, *a re-uploaded video gets a poster from the same staff user*, *manifest lives at <dir>/<exerciseId>.json…*. End to end › *seeds everything, then a second run issues zero uploads and zero posts* (includes a 429 with `Retry-After: 7`). Retry-After › all |
| **Personas and posts** (handles resolved; merge-patch; unknown handle → stop and list; chronological; `anchor − minutesBeforeAnchor`; replies after parents; baselines; idempotent) | End to end › *an unknown handle stops before any write…*; › *a failed post stops the run; … -Resume finishes on the original anchor without duplicates*. Offset math › all. Gate-1 folds › *L-4: …* (three tests), *M-3: …*. Manifest and idempotency › *a lost manifest adopts…*, *posts again what was archived since*, *never re-posts when the feed is at its 200 cap…*, *persona patch sends only what differs…*. Gate-1 folds end to end › *M-3: … refuses before any write; -AcceptUnverifiableFeed proceeds* |
| **Run-sheet export** (`pulse.runsheet.v1`, real ids, imports unedited) | Golden run sheet › *regenerating the export … matches … exactly*; **vitest** `seedRunSheet.golden.test.ts` (C3's real `parseRunSheetFile`, round trip); End to end › *exports a run sheet the console imports*; Run-sheet rewrite › all, including 24 *refuses what the importer refuses* cases |
| **Self-check** (feed ≥ the top-level posts seeded; `Range: bytes=0-1` → 206 on every media URL; ✅/❌; exit ≠ 0 on failure) | End to end › *self-check: a media URL that does not answer 206 fails the run (exit 1, ❌)*; › *self-check: probes post media, posters, avatars and banners, without the token*; Real HTTP › *H-1 …* (a full run that ends "SEEDED — every check passed") |

Manual checks (🧑, not automated): a `-WhatIf` transcript against UAT, a full run against UAT with the
self-check all ✅, then the participant app showing photos, a playing video, threads with replies, and the
baselines.
