# Seed-DemoContent.ps1: how to run it and how each AC is tested

Story: `docs/features/demo-polish/24-seed-script.md` (S1, #443). The full behaviour is in the script's
comment-based help: `Get-Help scripts/uat/Seed-DemoContent.ps1 -Full`.

## Run

```powershell
pwsh scripts/uat/Seed-DemoContent.ps1 -WhatIf                              # validate + plan; no sign-in, no writes
pwsh scripts/uat/Seed-DemoContent.ps1 -StaffUsername controller1           # full run (hidden secret prompt, or $env:PULSE_STAFF_SECRET)
pwsh scripts/uat/Seed-DemoContent.ps1 -StaffUsername controller1 -Resume   # finish a partial run on its original anchor
pwsh scripts/uat/Seed-DemoContent.ps1 -StaffUsername controller1 -ReloadFiredRunSheet   # re-arm a run sheet a rehearsal fired
```

Run-of-show: `Clear-DemoContent.ps1` (optional), then `Reset-DemoState.ps1`, then this script. **After a
rehearsal that fired the run sheet: add `-ReloadFiredRunSheet`.** Firing spends an item: the console cannot
fire it again, the server will not delete a fired item, and neither reset script touches the inject queue. A
plain run reports each spent item (fired, firing, skipped, failed, or a burst held part-way) in the plan, and
its self-check fails (❌) naming the switch. With `-ReloadFiredRunSheet` each spent item gets a fresh copy
(pending, at the end of the queue); the manifest records the new id and keeps the old one as `superseded`, so it
is never adopted again. The script never fires, deletes or reorders an old item, so the old ones stay visible in
the console: the run sheet's status filter **Open** (pending, held, firing, failed) hides the fired and skipped
ones, and a failed or skipped one can be deleted there (a fired one cannot). An item still **firing** (a burst
releasing its posts, or suspended by PAUSE INJECTS or FREEZE) is refused and nothing is written: wait for it to
finish, or Hold it in the console, then run again.

If a run stops while loading the run sheet (for example an uncertain create), wait about a minute and run the
same command again. `-Resume` is not needed then, because the posts are all in.

The run sheet is loaded, not exported. Each `runSheet.items` entry in the pack becomes a pending item in the
console's inject queue through `POST /api/injects` (inject-queue 06's frozen `InjectItemWrite`). There is no
file to import: the items appear in the controller console's run-sheet panel, and nothing is fired. The
manifest maps each item key to its item id, so a re-run skips items still in the queue, creates again an item
deleted in the console, and never duplicates one. Pack shape (`docs/demo/pack/schema/pack.schema.json`):

```jsonc
"runSheet": { "items": [
  { "key": "i01", "kind": "post", "title": "…", "notes": "…", "plannedMinute": 5, "assignee": "me",
    "posts": [{ "persona": "Newsline7", "text": "…", "media": [{ "ref": "harbor-photo" }],
                "replyTo": { "postKey": "p02" }, "engagementBaseline": { "like": 20 } }] },
  { "key": "i02", "kind": "burst", "title": "…", "burstWindowSeconds": 60, "assignee": "Eve Evaluator",
    "posts": [{ "persona": "mvega_fh", "text": "…" },
              { "persona": "Newsline7", "text": "…", "replyTo": { "sequence": 1 } },               // an earlier post of this item
              { "persona": "FulcoEM", "text": "…", "replyTo": { "item": "i01", "sequence": 1 } }] }  // a post of an EARLIER item
] }
```

## Test

```powershell
Invoke-Pester scripts/uat/Seed-DemoContent.Tests.ps1 -Output Detailed       # Pester 5; no network
```

Most tests run against an in-memory fake behind a mocked `Invoke-WebRequest`. The fake's `POST /api/injects`
enforces the server's own 400 rules (`InjectItemValidator`), written out in the test file independently of the
script and checked against the server's messages, and it can drop or garble a response on a chosen attempt.
The "Real HTTP, no mocks" block starts a `System.Net.HttpListener` on localhost instead, so the real web cmdlet
runs: its debug stream, its error records and its redirect handling.

## Acceptance criteria → tests

| AC | Evidence (Pester `Describe` › `It`, unless noted) |
|----|----|
| **Script and safety** (parameters; anonymous exercise-context first; `{username, secret, exerciseId}` login; secret from `PULSE_STAFF_SECRET` or a hidden prompt; secret and tokens never printed, logged or written) | Secrets never leave memory › *no secret or token in any output stream, the manifest or a run-sheet request (created, adopted, stopped and resumed)*; › *the secret is sent only in the login body…*; › *a rejected secret exits 1 without echoing it*; › *refuses plain http to anything but localhost*. Real HTTP › *H-1: a full run with -Debug -Verbose…*; › *M-1: after a connection failure neither $Error nor Get-Error holds the token*; › *L-5: a redirect is never followed…* |
| **Public APIs only** (allowlisted paths, now including `/api/injects` and `/api/injects/assignees`; no `sqlcmd` or SQL) | Public APIs only › *the script names no API path outside the allowlist*; › *the grep catches a forbidden path*; › *the script has no database client, sqlcmd or SQL*; › *its own allowlist matches the story's list exactly (read from 24-seed-script.md)*; › *refuses a non-allowlisted path at runtime too* (fire and reorder stay refused) |
| **Engine paused by default** (`{"tier":"engine"}` plus the `actingHumanId` the server requires; applied tier reported; `-LeaveEngineRunning`) | End to end › *uploads the poster first… posts carry the real request shape* (GET then one POST, with `actingHumanId`); › *-LeaveEngineRunning never touches the pause tier*. Gate-1 folds end to end › *L-6: a frozen world stays frozen*; › *L-6: a running engine is paused once and reported* |
| **Validate first, write nothing on error; -WhatIf** | Pack validation › *<Name> -> <Code>* (one case per rule, markup and every run-sheet rule included; alt is blank to either JavaScript's or .NET's trim), plus *file over the server limit*, *empty file*, *L-7: a symbolic link…*, *counts code points…*, *the JSON Schema…*, *an invalid pack exits 1 before any request*, *malformed JSON exits 1…*. End to end › *-WhatIf prints the plan, signs in to nothing and writes nothing* (each run-sheet item it would create: kind, title, post count) |
| **Media upload** (once each; poster first, then the video with `posterMediaId`; 429 → `Retry-After`; SHA-256 manifest; no re-upload; `-Resume`) | Manifest and idempotency › *uploads posters first…*, *second run: zero uploads and zero posts*, *re-uploads a file whose bytes changed…*, *re-uploads an asset that is gone…*, *a re-uploaded video gets a poster from the same staff user*, *manifest lives at <dir>/<exerciseId>.json…*. End to end › *seeds everything, then a second run issues zero uploads, zero posts and zero run-sheet items* (includes a 429 with `Retry-After: 7`). Retry-After › all |
| **Personas and posts** (handles resolved; merge-patch; unknown handle → stop and list; chronological; `anchor − minutesBeforeAnchor`; replies after parents; baselines; idempotent) | End to end › *an unknown handle stops before any write…*; › *a failed post stops the run; … -Resume finishes on the original anchor without duplicates*. Offset math › all. Gate-1 folds › *L-4: …* (three tests), *M-3: …*. Manifest and idempotency › *a lost manifest adopts…*, *posts again what was archived since*, *never re-posts when the feed is at its 200 cap…*, *persona patch sends only what differs…*. Gate-1 folds end to end › *M-3: … refuses before any write; -AcceptUnverifiableFeed proceeds* |
| **Run-sheet load** (beats → inject items through `POST /api/injects`; handles → persona ids via `GET /api/personas`; media and post keys → real ids; `replyTo` → `{postId}` / `{sequence}` / `{injectPostId}`; bursts → `kind: burst`; item ids in the manifest; a re-run never duplicates) | Pack validation › the run-sheet rows of *<Name> -> <Code>* (the server's limits: title, notes, planned minute, post counts, burst window ≥ 3 × (posts − 1), text, media, alt, replies, loops, baselines, unknown keys). Run sheet (pure) › *a post item: the exact body…*, *a burst: the exact body…*, *sends only what the pack has…*, *refuses to build a body with an unresolved reference*, *plan offline…*, *plan online…*, *adopts only a true match…*, *warns when an item already loaded differs…*, *assignees…*, *a ProblemDetails "detail"…*. Run-sheet load end to end › *the fake is an honest oracle…* (9 cases), *sends the exact InjectItemWrite bodies…*, *loaded after the posts…, and no item is fired*, *an item deleted in the console is created again…*, *warns when a loaded item still replies to a seeded post that was archived…*, *a lost manifest adopts…*, *an uncertain create (<Fault>) is never sent twice…* (no response, 408, 503, unreadable 201), *an uncertain create that did not land stops…; -Resume then creates it once*, *a 429 on a create waits the Retry-After…*, *a 400 stops the run and prints the server's detail as it is*, *an unknown handle in a run-sheet post stops before any write*, *an unknown assignee stops before any write…*, *a server without the inject queue (404)…*, *a pack without a run sheet…*. End to end › *seeds everything, then a second run issues zero uploads, zero posts and zero run-sheet items*. Spent run sheet (`-ReloadFiredRunSheet`) › all: *armable…*, the plan with and without the switch, adopt-by-match never taking a spent or superseded copy, *-ReloadFiredRunSheet creates exactly one fresh copy per spent item, and zero on a second run*, *an uncertain create during a reload adopts the fresh copy*, *a firing item is refused…*, *-WhatIf -ReloadFiredRunSheet sends nothing*, stale replies to a reloaded item, `"me"` not on the roster |
| **Self-check** (feed ≥ the top-level posts seeded; `Range: bytes=0-1` → 206 on every media URL; every run-sheet item in `GET /api/injects` with its post count, and armable; ✅/❌; exit ≠ 0 on failure) | End to end › *self-check: a media URL that does not answer 206 fails the run (exit 1, ❌)*; › *self-check: probes post media, posters, avatars and banners, without the token*; › *seeds everything…* (✅ for the run sheet); Run-sheet load end to end › *self-check: an item missing from the run sheet, or with a post gone, fails the run*; Spent run sheet › *a <Status> item is reported in the plan and fails the self-check…*; Real HTTP › *H-1 …* (a full run that ends "SEEDED — every check passed") |

Manual checks (🧑, not automated): a `-WhatIf` transcript against UAT, a full run against UAT with the
self-check all ✅, then the participant app showing photos, a playing video, threads with replies, and the
baselines, and the controller console's run-sheet panel showing the pack's items, pending, with their
assignees.
