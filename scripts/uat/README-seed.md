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

## Demo week (Mon 10/19 rehearsal, Tue 10/20 demo)

**Monday, rehearsal.** A normal seed: `Reset-DemoState.ps1`, then
`Seed-DemoContent.ps1 -StaffUsername controller1`.

**Tuesday morning, at least 1 hour before the demo** (time for a re-run, or for `-Restart`'s 8-minute wait):

1. `pwsh scripts/uat/Clear-DemoContent.ps1` (try `-WhatIf` first). It archives Monday's posts, and every
   run-sheet item an MSEL import created, fired or not, so the on-stage import of the Kestrel MSEL creates all
   of them fresh. It lists their Inject #s before writing. Items this seed loaded, or that were written in
   the console, have no Inject # and are not touched. An open console in a visible tab drops the archived items
   within about 3 s (it polls the run sheet); a background tab does once it is brought to the front.
   An imported item publishing a post at that very moment is left alone and named: run the script again a few
   seconds later. If it says **claim stuck** (older than 60 s), Release or Retry that item in the console (a
   firing one settles by itself once PAUSE INJECTS and FREEZE are off), then run the script again.
   The script prints a `-RestoreManifest` command that puts everything back, on the same database only. An
   imported item whose Inject # a newer import holds by then stays archived (it says which), and a restored item
   that was firing publishes its remaining posts at once unless PAUSE INJECTS or FREEZE is on.
   After this step, check the MSEL with the import's **Preview** only: a real import before the show leaves the
   on-stage import nothing to create. If that happened, run steps 1 to 4 again.
2. `pwsh scripts/uat/Reset-DemoState.ps1`.
3. If the rehearsal fired this seed's run-sheet items, first **Skip the leftover unfired items** in the console.
   Then run `pwsh scripts/uat/Seed-DemoContent.ps1 -StaffUsername controller1 -ReloadFiredRunSheet`. If nothing
   was fired, run the same command without the switch.
   The seed posts the opening feed again under new ids, anchored at now. A run-sheet item kept from Monday whose
   reply pointed at one of Monday's (now archived) posts is **re-pointed in place** (`PUT /api/injects/{id}`:
   same item, same place in the queue, console edits kept). A reply a controller re-targeted to another live
   post is left alone. The self-check confirms "every run-sheet reply points at a live post", and every
   self-check line must be ✅.
4. Open the participant app and check that Trending shows `#WaterIssues`.

**Why Tuesday.** The participant app's scenario "now" is the browser's wall clock (`core/clock/exerciseClock.ts`,
the Wave-0 mock), and Trending counts only the last 12 hours (`features/social/explore/trending.ts`). A Monday
seed is about 24 hours old by Tuesday's demo: none of it would trend.

**Hazard: never leave the world FROZEN overnight.** A frozen server clock falls behind, so Tuesday's run-sheet
fires and engine posts would be stamped in the past and never trend. The seed warns when it finds the world
frozen. If it happened, run `pwsh scripts/uat/Reset-DemoState.ps1 -Restart`. A restart clears the in-memory pause
tier and scenario clock, but the old process keeps serving for several minutes (Reset-DemoState's own help).
So wait about 8 minutes, then run `pwsh scripts/uat/Reset-DemoState.ps1` (without `-Restart`), then the seed.

## Rehearsals and re-runs

Run-of-show: `Clear-DemoContent.ps1` (**required** after a rehearsal that imported the MSEL, so the show's import
creates its items; optional otherwise), then `Reset-DemoState.ps1`, then this script. **After a
rehearsal that fired the run sheet: add `-ReloadFiredRunSheet`.** Firing spends an item: the console cannot
fire it again, the server will not delete a fired item, and neither reset script touches the items this
script loads (`Clear-DemoContent.ps1` archives only the items an MSEL import created). A plain run reports
each spent item (fired, firing, skipped, failed, or a burst held part-way) in the plan, and its self-check fails
(❌) naming the switch. With `-ReloadFiredRunSheet` each spent item gets a fresh copy
(pending, at the end of the queue); the manifest records the new id and keeps the old one as `superseded`, so it
is never adopted again. The script never fires, deletes or reorders an old item, so the old ones stay visible in
the console: the run sheet's status filter **Open** (pending, held, firing, failed) hides the fired and skipped
ones. Old copies that are **failed** or **held part-way** stay visible under Open, next to the fresh ones, so
delete those old copies in the console (both can be deleted; a fired one cannot), and Open then shows only the
fresh run sheet. An item still **firing** (a burst releasing its posts, or suspended by PAUSE INJECTS or FREEZE)
is refused and nothing is written: wait for it to finish, or Hold it in the console, then run again.

**After a PARTIAL rehearsal** (some items fired, the rest still pending): first **Skip the remaining items in the
console**, then run with `-ReloadFiredRunSheet`. A fresh copy always lands at the end of the queue and the script
never reorders, so reloading only the fired items would put them behind the untouched later ones, and "Fire next"
would open on a mid-storyline beat. Skipping the rest first makes them spent too, so the whole sheet reloads in
pack order. The plan warns about this case, and the self-check fails (❌) when the armable items are not in pack
order in the queue. Dragging them into order in the console also fixes it.

If a run stops while loading the run sheet (for example an uncertain create), wait about a minute and run the
same command again. `-Resume` is not needed then, because the posts are all in.

If a run stops while uploading media because an upload got no clear answer (no response, a 408 or 5xx, or an
unreadable answer), the file was not sent again. The run first looked in the media library for the asset that
upload stored and did not find it. Wait about a minute and run the same command again. The manifest marks the
file "pending", so the next run looks again before it uploads. It adopts the stored asset if it is there now,
and uploads the file only if it is not. That asset has the same kind, name and bytes, and was not in the
library before the upload. A run interrupted mid-upload leaves the same mark.

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
Its `POST /api/media` can do the same, before or after it stores the file, and its media library keeps each
stored file's SHA-256, so a test can tell an adopted upload from a second copy.
The "Real HTTP, no mocks" block starts a `System.Net.HttpListener` on localhost instead, so the real web cmdlet
runs: its debug stream, its error records and its redirect handling.

## Acceptance criteria → tests

| AC | Evidence (Pester `Describe` › `It`, unless noted) |
|----|----|
| **Script and safety** (parameters; anonymous exercise-context first; `{username, secret, exerciseId}` login; secret from `PULSE_STAFF_SECRET` or a hidden prompt; secret and tokens never printed, logged or written) | Secrets never leave memory › *no secret or token in any output stream, the manifest or a run-sheet request (created, adopted, stopped and resumed)*; › *the secret is sent only in the login body…*; › *a rejected secret exits 1 without echoing it*; › *refuses plain http to anything but localhost*. Real HTTP › *H-1: a full run with -Debug -Verbose…*; › *M-1: after a connection failure neither $Error nor Get-Error holds the token*; › *L-5: a redirect is never followed…* |
| **Public APIs only** (allowlisted paths, now including `/api/injects`, `/api/injects/assignees` and `/api/injects/{id}` for `PUT` only; no `sqlcmd` or SQL) | Public APIs only › *the script names no API path outside the allowlist*; › *the grep catches a forbidden path*; › *the script has no database client, sqlcmd or SQL*; › *its own allowlist matches the story's list exactly (read from 24-seed-script.md)*; › *refuses a non-allowlisted path at runtime too* (fire and reorder stay refused; an item route takes `PUT` only) |
| **Engine paused by default** (`{"tier":"engine"}` plus the `actingHumanId` the server requires; applied tier reported; `-LeaveEngineRunning`) | End to end › *uploads the poster first… posts carry the real request shape* (GET then one POST, with `actingHumanId`); › *-LeaveEngineRunning never touches the pause tier*. Gate-1 folds end to end › *L-6: a frozen world stays frozen*; › *L-6: a running engine is paused once and reported* |
| **Validate first, write nothing on error; -WhatIf** | Pack validation › *<Name> -> <Code>* (one case per rule, markup and every run-sheet rule included; alt is blank to either JavaScript's or .NET's trim), plus *file over the server limit*, *empty file*, *L-7: a symbolic link…*, *counts code points…*, *the JSON Schema…*, *an invalid pack exits 1 before any request*, *malformed JSON exits 1…*. End to end › *-WhatIf prints the plan, signs in to nothing and writes nothing* (each run-sheet item it would create: kind, title, post count) |
| **Media upload** (once each; poster first, then the video with `posterMediaId`; 429 → `Retry-After`; SHA-256 manifest; no re-upload; `-Resume`; an uncertain upload is looked up and adopted, never sent twice) | Manifest and idempotency › *uploads posters first…*, *second run: zero uploads and zero posts*, *re-uploads a file whose bytes changed…*, *re-uploads an asset that is gone…*, *a re-uploaded video gets a poster from the same staff user*, *manifest lives at <dir>/<exerciseId>.json…*. End to end › *seeds everything, then a second run issues zero uploads, zero posts and zero run-sheet items* (includes a 429 with `Retry-After: 7`). Retry-After › all. Media upload: an uncertain outcome… › end to end: *an uncertain upload (<Fault>) is never sent twice…* (no response, 408, 503, unreadable 201), *an uncertain VIDEO upload is adopted only with its poster…*, *an uncertain upload that did not land stops without re-sending; the next run looks first, then uploads it once*, *an upload that landed after its run stopped is adopted by the next run…*, *a VIDEO upload that landed after its run stopped: the next run keeps its poster (hidden by then)…*, *a recovery run under ANOTHER staff user finds the late video first and keeps its poster…*, *plan and run agree: when the poster's bytes changed…*, *a next run that cannot tell… sends nothing for it*, *marks the file pending… BEFORE its upload is sent*, *a 400 still stops at once…*, *the plan (-WhatIf) says when a file will be looked for first*; Find-UploadedMediaAsset (stubbed HTTP) › all (never a row held before the upload, claimed, or of another name, kind, hints, poster or bytes; the newest of two copies; a full page proves absence only when it reaches a row from before the upload; an unreadable 200 proves nothing; cannot tell → nothing sent); *Get-MediaUrlSha256 over real HTTP* (no token, size-bounded, no redirect, a stalled body cut off at the deadline) |
| **Personas and posts** (handles resolved; merge-patch; unknown handle → stop and list; chronological; `anchor − minutesBeforeAnchor`; replies after parents; baselines; idempotent) | End to end › *an unknown handle stops before any write…*; › *a failed post stops the run; … -Resume finishes on the original anchor without duplicates*. Offset math › all. Gate-1 folds › *L-4: …* (three tests), *M-3: …*. Manifest and idempotency › *a lost manifest adopts…*, *posts again what was archived since*, *never re-posts when the feed is at its 200 cap…*, *persona patch sends only what differs…*. Gate-1 folds end to end › *M-3: … refuses before any write; -AcceptUnverifiableFeed proceeds* |
| **Run-sheet load** (beats → inject items through `POST /api/injects`; handles → persona ids via `GET /api/personas`; media and post keys → real ids; `replyTo` → `{postId}` / `{sequence}` / `{injectPostId}`; bursts → `kind: burst`; item ids in the manifest; a re-run never duplicates) | Pack validation › the run-sheet rows of *<Name> -> <Code>* (the server's limits: title, notes, planned minute, post counts, burst window ≥ 3 × (posts − 1), text, media, alt, replies, loops, baselines, unknown keys). Run sheet (pure) › *a post item: the exact body…*, *a burst: the exact body…*, *sends only what the pack has…*, *refuses to build a body with an unresolved reference*, *plan offline…*, *plan online…*, *adopts only a true match…*, *warns when an item already loaded differs…*, *assignees…*, *a ProblemDetails "detail"…*. Run-sheet load end to end › *the fake is an honest oracle…* (9 cases), *sends the exact InjectItemWrite bodies…*, *loaded after the posts…, and no item is fired*, *an item deleted in the console is created again…*, *warns when a loaded item still replies to a seeded post that was archived…*, *a lost manifest adopts…*, *an uncertain create (<Fault>) is never sent twice…* (no response, 408, 503, unreadable 201), *an uncertain create that did not land stops…; -Resume then creates it once*, *a 429 on a create waits the Retry-After…*, *a 400 stops the run and prints the server's detail as it is*, *an unknown handle in a run-sheet post stops before any write*, *an unknown assignee stops before any write…*, *a server without the inject queue (404)…*, *a pack without a run sheet…*. End to end › *seeds everything, then a second run issues zero uploads, zero posts and zero run-sheet items*. Spent run sheet (`-ReloadFiredRunSheet`) › all: *armable…*, the plan with and without the switch, adopt-by-match never taking a spent or superseded copy, *-ReloadFiredRunSheet creates exactly one fresh copy per spent item, and zero on a second run*, *an uncertain create during a reload adopts the fresh copy*, *a firing item is refused…*, *-WhatIf -ReloadFiredRunSheet sends nothing*, stale replies to a reloaded item, `"me"` not on the roster. Tue 10/20 re-seed (S1c) › *re-seed keeps order: … re-points a postKey reply IN PLACE (same item, same order, version advances)*, *an { item, sequence } reply is re-pointed in place after its target item was reloaded*, *a 409 … re-reads and retries once*, *a 409 that persists after one retry is a warning…*, *the PUT body echoes every child id unchanged and keeps the queue's title, text and assignee*, *fired items are never PUT*, *-WhatIf lists the items it would re-point and sends nothing*, *the secret and the token never appear in a re-seed's output or in a PUT body*, *L-1: a reply re-targeted in the console to another LIVE post is left alone…*, *L-1: … re-pointed once its post is archived*, *S-2: a final PUT whose answer is lost but which landed is a success…*, *S-3: …spent parent…*, *S-3: …outside a full 200-post feed window…*, *S-4: -LeaveEngineRunning still reads the tier once…*, plus the pure body/repair/liveness tests |
| **Self-check** (feed ≥ the top-level posts seeded; `Range: bytes=0-1` → 206 on every media URL; every run-sheet item in `GET /api/injects` with its post count, armable, and in pack order; every run-sheet reply points at a live post; ✅/❌; exit ≠ 0 on failure) | End to end › *self-check: a media URL that does not answer 206 fails the run (exit 1, ❌)*; › *self-check: probes post media, posters, avatars and banners, without the token*; › *seeds everything…* (✅ for the run sheet); Run-sheet load end to end › *self-check: an item missing from the run sheet, or with a post gone, fails the run*; Spent run sheet › *a <Status> item is reported in the plan and fails the self-check…*, *the self-check fails when the queue is out of pack order…*, *passes in pack order*; Tue 10/20 re-seed › *a 409 that persists… the self-check fails*, *re-seed keeps order…* (✅ live replies); Real HTTP › *H-1 …* (a full run that ends "SEEDED — every check passed") |

Manual checks (🧑, not automated): a `-WhatIf` transcript against UAT, a full run against UAT with the
self-check all ✅, then the participant app showing photos, a playing video, threads with replies, and the
baselines, and the controller console's run-sheet panel showing the pack's items, pending, with their
assignees.
