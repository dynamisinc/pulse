# Seed-DemoContent.ps1: how to run it and how each AC is tested

Story: `docs/features/demo-polish/24-seed-script.md` (S1, #443), extended by
`docs/features/demo-feedback/S1-seed-script-update.md` (#510: exercise pins, the white-noise pool, media marking
and `-RunSheet`). The full behaviour is in the script's comment-based help:
`Get-Help scripts/uat/Seed-DemoContent.ps1 -Full`.

## Run

```powershell
pwsh scripts/uat/Seed-DemoContent.ps1 -WhatIf                              # validate + plan; no sign-in, no writes
pwsh scripts/uat/Seed-DemoContent.ps1 -StaffUsername controller1           # full run (hidden secret prompt, or $env:PULSE_STAFF_SECRET)
pwsh scripts/uat/Seed-DemoContent.ps1 -StaffUsername controller1 -RunSheet exceptMsel   # THE DEMO (DF-16): the MSEL import adds the msel items
pwsh scripts/uat/Seed-DemoContent.ps1 -RunSheet exceptMsel -WhatIf         # plan it: lists each item left for the import
pwsh scripts/uat/Seed-DemoContent.ps1 -StaffUsername controller1 -Resume   # finish a partial run on its original anchor
pwsh scripts/uat/Seed-DemoContent.ps1 -StaffUsername controller1 -ReloadFiredRunSheet   # re-arm a run sheet a rehearsal fired
```

## Demo week (Mon 10/19 rehearsal, Tue 10/20 demo)

**The demo command line** (DF-16), on both days:

```powershell
pwsh scripts/uat/Seed-DemoContent.ps1 -StaffUsername controller1 -RunSheet exceptMsel
```

`-RunSheet exceptMsel` loads every run-sheet item except the ones with an `msel` ref. The on-stage import (the
run sheet's Import button, with the Kestrel run sheet rendered as a Cadence MSEL, C2) adds those, so nothing is
loaded twice. Bursts, and any single post a seeded item replies to, stay seeded: an MSEL row becomes one single
post and cannot reply to anything. Every run also pins the pack's `pins` for everyone, replaces the white-noise
pool with the pack's `noise`, leaves white noise **off** (turn it up on stage with the console's knob), and makes
sure media marking (`watermarkEnabled`) is on.

**Order ("Fire next").** The seed loads its items in pack order, each at the end of the queue. The on-stage import
does not append: it places each item it creates just before the first pending item with a later planned minute
(DF-18, story 14). So after the import the queue reads in pack order again, **as long as every seeded item has a
`plannedMinute`**: the import cannot place its items around one without it, and the plan warns about such an
item when an `exceptMsel` run leaves msel items out. The self-check checks the seeded items' order; the imported
ones arrive later, on stage.

**Monday, rehearsal.** `Reset-DemoState.ps1`, then the demo command line. Rehearsing the import on this exercise
is fine: Tuesday's `Clear-DemoContent.ps1` archives what it created.

**Tuesday morning, at least 1 hour before the demo** (time for a re-run, or for `-Restart`'s 8-minute wait):

1. `pwsh scripts/uat/Clear-DemoContent.ps1`. It archives Monday's posts (Monday's pins and noise posts go with
   them) and the run-sheet items Monday's MSEL import created (the ones with an Inject #, fired ones included),
   so the show's import creates them again. The items this script seeded are not touched.
2. `pwsh scripts/uat/Reset-DemoState.ps1`.
3. If the rehearsal fired seeded items, first **Skip the leftover unfired seeded items** in the console. Then run
   the demo command line with `-ReloadFiredRunSheet`, or without it if nothing was fired.
   The seed posts the opening feed again under new ids, anchored at now, and pins the new copies. A run-sheet
   item kept from Monday whose reply pointed at one of Monday's (now archived) posts is **re-pointed in place**
   (`PUT /api/injects/{id}`: same item, same place in the queue, console edits kept). A reply a controller
   re-targeted to another live post is left alone. The self-check confirms "every run-sheet reply points at a
   live post", and every self-check line must be ✅ (➖ lines are informational: the items left for the import,
   for example).
4. Open the participant app and check that Trending shows `#WaterIssues` and the Pinned tab opens on the pins.

**Never run `-RunSheet all` after the on-stage import.** It would load the msel items as well. The queue does not
show an item's Inject #, so the seed cannot tell an imported item from its own: it adopts one only when kind, title,
persona and text all match, and otherwise adds a second copy. The plan warns when an msel item an earlier run
recorded is still armable while `exceptMsel` leaves it for the import.

**Why Tuesday.** The participant app's scenario "now" is the browser's wall clock (`core/clock/exerciseClock.ts`,
the Wave-0 mock), and Trending counts only the last 12 hours (`features/social/explore/trending.ts`). A Monday
seed is about 24 hours old by Tuesday's demo: none of it would trend.

**Hazard: never leave the world FROZEN overnight.** A frozen server clock falls behind, so Tuesday's run-sheet
fires and engine posts would be stamped in the past and never trend. The seed warns when it finds the world
frozen. If it happened, run `pwsh scripts/uat/Reset-DemoState.ps1 -Restart`. A restart clears the in-memory pause
tier and scenario clock, but the old process keeps serving for several minutes (Reset-DemoState's own help).
So wait about 8 minutes, then run `pwsh scripts/uat/Reset-DemoState.ps1` (without `-Restart`), then the seed.

## Rehearsals and re-runs

Run-of-show: `Clear-DemoContent.ps1` (optional), then `Reset-DemoState.ps1`, then this script. **After a
rehearsal that fired the run sheet: add `-ReloadFiredRunSheet`.** Firing spends an item: the console cannot
fire it again, the server will not delete a fired item, and neither reset script touches an item this script
seeded (`Clear-DemoContent.ps1` archives only the items an MSEL import created, the ones with an Inject #). A
plain run reports each spent item (fired, firing, skipped, failed, or a burst held part-way) in the plan, and
its self-check fails (❌) naming the switch. With `-ReloadFiredRunSheet` each spent item gets a fresh copy
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

## Pins, white noise, media marking and `-RunSheet` (demo-feedback S1, #510)

Pack shape (all optional; `docs/demo/pack/schema/pack.schema.json`):

```jsonc
"pins": ["p02", "p01"],                                     // post keys, pinned for everyone; the Pinned tab shows them in this order
"noise": [{ "persona": "mvega_fh", "text": "…" }],          // the white-noise pool: up to 1,000 entries, text 1–280 code points
"runSheet": { "items": [{ "key": "i03", "kind": "post", "msel": "3", … }] }   // msel: the MSEL Inject #; post items only, unique
```

| Step | Request | Rules |
|---|---|---|
| Before seeding | `PUT /api/staff/noise { level: off }`; `GET` then (only when off) `PUT /api/staff/chrome-settings` | Noise off before the first post, so a run that stops part-way still leaves it off. Media marking on before any media is posted: the PUT is a full replace with no version token, so it sends every field exactly as read with only `watermarkEnabled` changed; nothing is sent when it is already on |
| 9. Pins | `PUT /api/staff/posts/{id}/pin` per pin | The post key resolves to the id step 8 used. Last listed first, so the Pinned tab (newest pin first, DF-5) reads in pack order while the exercise clock runs. With the clock stopped, `PinService` stamps the later of the exercise's stored scenario time and the post's own, so the tab may follow the posts' own times, or its id tie-break. A post already pinned answers 204 and keeps its pin; a refused pin (a 404, a 5xx) is a ❌ |
| 10. Run sheet | as before | Only the items `-RunSheet` loads. A left-out item is never created, adopted, re-pointed, compared or self-checked, and its manifest entry stays, so the import's items are never touched. The queue is read when an item loads, or when an msel item left out has a manifest entry (never with `none`). Plan warnings: a copy of an msel item an earlier run recorded and the console could still fire (delete it before the import, unless the import created it: the queue does not show Inject #); an msel item that replies to a post (an MSEL row cannot carry the reply, so the import creates it top-level: keep in-thread replies seeded); a seeded item without a `plannedMinute` while msel items are left out (the import cannot place around it, DF-18) |
| 11. Noise pool | `PUT /api/staff/noise/pool` | `mode: replace` with the first 1,000 entries, `append` for any more; persona handles sent as ids. Each rejected entry is a warning (`noise[i] (@handle) was not loaded: <server's reason>`). A pack without `noise` leaves the server's pool alone |
| 12. After seeding | `PUT /api/staff/noise { level: off }` | On every run, `-LeaveEngineRunning` included. A run that began writing (step 5) but stops early, throws, or does not get a confirmed off here sends it once more on the way out |
| 13. Self-check | the feed read | Every pin PUT accepted and `pinnedForAll` in the feed, the pool loaded, noise off, media marking on |

Validation adds: noise handles and text (the post-text rules), pins naming pack posts, `msel` on post items only and
unique ignoring case. With `exceptMsel`, a loaded item that replies to an msel item stops the run before any request,
naming both items: its parent would not exist yet when the seed creates it.

## Test

```powershell
Invoke-Pester scripts/uat/Seed-DemoContent.Tests.ps1 -Output Detailed       # Pester 5; no network
```

Most tests run against an in-memory fake behind a mocked `Invoke-WebRequest`. The fake's `POST /api/injects`
enforces the server's own 400 rules (`InjectItemValidator`), written out in the test file independently of the
script and checked against the server's messages, and it can drop or garble a response on a chosen attempt.
Its `POST /api/media` can do the same, before or after it stores the file, and its media library keeps each
stored file's SHA-256, so a test can tell an adopted upload from a second copy. Its white-noise, pin and
chrome-settings routes follow the server's rules (`WhiteNoiseService`, `PinService`, `ChromeSettingsService`):
per-entry pool rejections and the all-rejected 400, an idempotent pin, a full-replace chrome PUT.
The "Real HTTP, no mocks" block starts a `System.Net.HttpListener` on localhost instead, so the real web cmdlet
runs: its debug stream, its error records and its redirect handling.

## Acceptance criteria → tests

| AC | Evidence (Pester `Describe` › `It`, unless noted) |
|----|----|
| **Script and safety** (parameters; anonymous exercise-context first; `{username, secret, exerciseId}` login; secret from `PULSE_STAFF_SECRET` or a hidden prompt; secret and tokens never printed, logged or written) | Secrets never leave memory › *no secret or token in any output stream, the manifest or a run-sheet request (created, adopted, stopped and resumed)*; › *the secret is sent only in the login body…*; › *a rejected secret exits 1 without echoing it*; › *refuses plain http to anything but localhost*. Real HTTP › *H-1: a full run with -Debug -Verbose…*; › *M-1: after a connection failure neither $Error nor Get-Error holds the token*; › *L-5: a redirect is never followed…* |
| **Public APIs only** (allowlisted paths, now including `/api/injects`, `/api/injects/assignees` and `/api/injects/{id}` for `PUT` only, and for #510 `/api/staff/noise`, `/api/staff/noise/pool`, `/api/staff/chrome-settings` and `/api/staff/posts/{id}/pin` for `PUT` only; no `sqlcmd` or SQL) | Public APIs only › *the script names no API path outside the allowlist*; › *the grep catches a forbidden path*; › *the script has no database client, sqlcmd or SQL*; › *its own allowlist matches the stories' list exactly (read from 24-seed-script.md and demo-feedback S1-seed-script-update.md)*; › *refuses a non-allowlisted path at runtime too* (fire and reorder stay refused; an item route takes `PUT` only). Demo feedback S1 › *Set-ExercisePins: … the pin route is PUT-only and GUID-only (never unpin)* |
| **Engine paused by default** (`{"tier":"engine"}` plus the `actingHumanId` the server requires; applied tier reported; `-LeaveEngineRunning`) | End to end › *uploads the poster first… posts carry the real request shape* (GET then one POST, with `actingHumanId`); › *-LeaveEngineRunning never touches the pause tier*. Gate-1 folds end to end › *L-6: a frozen world stays frozen*; › *L-6: a running engine is paused once and reported* |
| **Validate first, write nothing on error; -WhatIf** | Pack validation › *<Name> -> <Code>* (one case per rule, markup and every run-sheet rule included; alt is blank to either JavaScript's or .NET's trim), plus *file over the server limit*, *empty file*, *L-7: a symbolic link…*, *counts code points…*, *the JSON Schema…*, *an invalid pack exits 1 before any request*, *malformed JSON exits 1…*. End to end › *-WhatIf prints the plan, signs in to nothing and writes nothing* (each run-sheet item it would create: kind, title, post count) |
| **Media upload** (once each; poster first, then the video with `posterMediaId`; 429 → `Retry-After`; SHA-256 manifest; no re-upload; `-Resume`; an uncertain upload is looked up and adopted, never sent twice) | Manifest and idempotency › *uploads posters first…*, *second run: zero uploads and zero posts*, *re-uploads a file whose bytes changed…*, *re-uploads an asset that is gone…*, *a re-uploaded video gets a poster from the same staff user*, *manifest lives at <dir>/<exerciseId>.json…*. End to end › *seeds everything, then a second run issues zero uploads, zero posts and zero run-sheet items* (includes a 429 with `Retry-After: 7`). Retry-After › all. Media upload: an uncertain outcome… › end to end: *an uncertain upload (<Fault>) is never sent twice…* (no response, 408, 503, unreadable 201), *an uncertain VIDEO upload is adopted only with its poster…*, *an uncertain upload that did not land stops without re-sending; the next run looks first, then uploads it once*, *an upload that landed after its run stopped is adopted by the next run…*, *a VIDEO upload that landed after its run stopped: the next run keeps its poster (hidden by then)…*, *a recovery run under ANOTHER staff user finds the late video first and keeps its poster…*, *plan and run agree: when the poster's bytes changed…*, *a next run that cannot tell… sends nothing for it*, *marks the file pending… BEFORE its upload is sent*, *a 400 still stops at once…*, *the plan (-WhatIf) says when a file will be looked for first*; Find-UploadedMediaAsset (stubbed HTTP) › all (never a row held before the upload, claimed, or of another name, kind, hints, poster or bytes; the newest of two copies; a full page proves absence only when it reaches a row from before the upload; an unreadable 200 proves nothing; cannot tell → nothing sent); *Get-MediaUrlSha256 over real HTTP* (no token, size-bounded, no redirect, a stalled body cut off at the deadline) |
| **Personas and posts** (handles resolved; merge-patch; unknown handle → stop and list; chronological; `anchor − minutesBeforeAnchor`; replies after parents; baselines; idempotent) | End to end › *an unknown handle stops before any write…*; › *a failed post stops the run; … -Resume finishes on the original anchor without duplicates*. Offset math › all. Gate-1 folds › *L-4: …* (three tests), *M-3: …*. Manifest and idempotency › *a lost manifest adopts…*, *posts again what was archived since*, *never re-posts when the feed is at its 200 cap…*, *persona patch sends only what differs…*. Gate-1 folds end to end › *M-3: … refuses before any write; -AcceptUnverifiableFeed proceeds* |
| **Run-sheet load** (beats → inject items through `POST /api/injects`; handles → persona ids via `GET /api/personas`; media and post keys → real ids; `replyTo` → `{postId}` / `{sequence}` / `{injectPostId}`; bursts → `kind: burst`; item ids in the manifest; a re-run never duplicates) | Pack validation › the run-sheet rows of *<Name> -> <Code>* (the server's limits: title, notes, planned minute, post counts, burst window ≥ 3 × (posts − 1), text, media, alt, replies, loops, baselines, unknown keys). Run sheet (pure) › *a post item: the exact body…*, *a burst: the exact body…*, *sends only what the pack has…*, *refuses to build a body with an unresolved reference*, *plan offline…*, *plan online…*, *adopts only a true match…*, *warns when an item already loaded differs…*, *assignees…*, *a ProblemDetails "detail"…*. Run-sheet load end to end › *the fake is an honest oracle…* (9 cases), *sends the exact InjectItemWrite bodies…*, *loaded after the posts…, and no item is fired*, *an item deleted in the console is created again…*, *warns when a loaded item still replies to a seeded post that was archived…*, *a lost manifest adopts…*, *an uncertain create (<Fault>) is never sent twice…* (no response, 408, 503, unreadable 201), *an uncertain create that did not land stops…; -Resume then creates it once*, *a 429 on a create waits the Retry-After…*, *a 400 stops the run and prints the server's detail as it is*, *an unknown handle in a run-sheet post stops before any write*, *an unknown assignee stops before any write…*, *a server without the inject queue (404)…*, *a pack without a run sheet…*. End to end › *seeds everything, then a second run issues zero uploads, zero posts and zero run-sheet items*. Spent run sheet (`-ReloadFiredRunSheet`) › all: *armable…*, the plan with and without the switch, adopt-by-match never taking a spent or superseded copy, *-ReloadFiredRunSheet creates exactly one fresh copy per spent item, and zero on a second run*, *an uncertain create during a reload adopts the fresh copy*, *a firing item is refused…*, *-WhatIf -ReloadFiredRunSheet sends nothing*, stale replies to a reloaded item, `"me"` not on the roster. Tue 10/20 re-seed (S1c) › *re-seed keeps order: … re-points a postKey reply IN PLACE (same item, same order, version advances)*, *an { item, sequence } reply is re-pointed in place after its target item was reloaded*, *a 409 … re-reads and retries once*, *a 409 that persists after one retry is a warning…*, *the PUT body echoes every child id unchanged and keeps the queue's title, text and assignee*, *fired items are never PUT*, *-WhatIf lists the items it would re-point and sends nothing*, *the secret and the token never appear in a re-seed's output or in a PUT body*, *L-1: a reply re-targeted in the console to another LIVE post is left alone…*, *L-1: … re-pointed once its post is archived*, *S-2: a final PUT whose answer is lost but which landed is a success…*, *S-3: …spent parent…*, *S-3: …outside a full 200-post feed window…*, *S-4: -LeaveEngineRunning still reads the tier once…*, plus the pure body/repair/liveness tests |
| **Self-check** (feed ≥ the top-level posts seeded; `Range: bytes=0-1` → 206 on every media URL; every run-sheet item in `GET /api/injects` with its post count, armable, and in pack order; every run-sheet reply points at a live post; ✅/❌; exit ≠ 0 on failure) | End to end › *self-check: a media URL that does not answer 206 fails the run (exit 1, ❌)*; › *self-check: probes post media, posters, avatars and banners, without the token*; › *seeds everything…* (✅ for the run sheet); Run-sheet load end to end › *self-check: an item missing from the run sheet, or with a post gone, fails the run*; Spent run sheet › *a <Status> item is reported in the plan and fails the self-check…*, *the self-check fails when the queue is out of pack order…*, *passes in pack order*; Tue 10/20 re-seed › *a 409 that persists… the self-check fails*, *re-seed keeps order…* (✅ live replies); Real HTTP › *H-1 …* (a full run that ends "SEEDED — every check passed") |

Demo feedback S1 (#510), `docs/features/demo-feedback/S1-seed-script-update.md`. Every row is in the Pester
`Describe` *Demo feedback S1 (#510): -RunSheet, white noise, exercise pins and media marking*:

| AC | Evidence (`Context` › `It`) |
|----|----|
| **Schema and fixture** (`noise`, `pins`, `msel`; the fixture gains 3 noise entries, 2 pins and the msel-marked `i03`; existing packs stay valid) | pack validation and the JSON Schema › *<Name> -> <Code>* (19 cases: noise, pins and msel, one per rule), › *the JSON Schema takes noise, pins and msel, and refuses their bad shapes; a pack without them stays valid*. The fixture itself passes every older test (`i03` loaded under the default `all`) |
| **Cross-checks** (noise handles like post handles; pins name `posts[].key`; `msel` on post items only, unique; with `exceptMsel` no loaded item may reply to an msel item, both named) | the `<Name> -> <Code>` cases above (noise handles are also in step 4's unknown-handle check); -RunSheet selection (pure) › *exceptMsel: a loaded item that replies to an msel item fails, naming both items; all and none pass*; -RunSheet end to end › *an exceptMsel run whose seeded item replies to an msel item exits 1 before any request, naming both items*, *an unknown persona on an msel item exceptMsel leaves out still stops the run before any write*; white noise › *an unknown noise persona stops the run with the unknown-handle message before any write* |
| **Noise pool and level** (replace, chunks of 1,000 then append; each rejection a warning with index and reason; no `noise` leaves the pool alone; level off at the end of every run) | white noise › *Get-NoisePoolChunks…*, *loads the pool with one replace… off before the first post and again at the end*, *a re-run replaces the pool again*, *a rejected entry is a warning…*, *a replace none of whose entries can be used is refused (400)…*, *more entries than one call takes go in chunks…*, *a refused first chunk sends no append…*, *a pack without noise leaves the server's pool alone…*, *a run that stops part-way still leaves noise off…; -LeaveEngineRunning turns it off too*, *L-2: noise turned up mid-run is turned off again on the way out when the run stops early; a clean run sends no extra call*, *L-2: an error after step 5… still turns noise off on the way out*, *L-2: a failure before step 5 writes nothing, white noise included*, *a server without white noise (404)…*. Real HTTP › *H-1* (level and pool over real HTTP) |
| **Exercise pins** (`PUT /api/staff/posts/{id}/pin`, ids as the script resolves post keys; idempotent) | exercise pins › *pins each pin for everyone after the posts, last listed first, and reads them back from the feed*, *a re-run pins again harmlessly*, *a pin the server refuses (404: taken down)…*, *L-1: a pin PUT that failed fails the self-check even when the feed shows the post pinned*, *Set-ExercisePins: … PUT-only and GUID-only*. Real HTTP › *H-1* (a body-less PUT answered 204) |
| **Media marking** (read first, change only `watermarkEnabled`, everything else sent back; no-op when on) | media marking › *already on: one read, nothing written*, *off: read, then one PUT before any media is posted…; a re-run sends nothing*, *New-ChromeSettingsBody echoes every field it read…*, *a read without the two switches writes nothing…*, *a refused write (400)…* |
| **`-RunSheet all\|exceptMsel\|none`** (the selection in one function; left-out items not drift and never touched; `-WhatIf` reports the skip) | -RunSheet selection (pure) › *Test-RunSheetItemLoaded…*, *Get-RunSheetItems: -Left is exactly the complement…*, *plan: exceptMsel plans only the loaded items…*, *plan: a seeded copy of an msel item is warned about…*; -RunSheet end to end › *exceptMsel loads every item but the msel one…*, *exceptMsel never touches the MSEL import's item… on a re-run or a Tuesday re-seed*, *switching from all to exceptMsel…*, *none: no run-sheet request at all…*, *-WhatIf -RunSheet exceptMsel reports the skip and sends nothing*, *an msel item that itself replies to a post is warned about…*, *exceptMsel with a seeded item that has no plannedMinute warns in the plan…*, *every item msel: the queue is still read when an earlier run recorded one…*; -RunSheet selection (pure) › *plan (DF-18): exceptMsel warns when a loaded item has no plannedMinute…* |
| **Re-running is safe** | the re-run cases above (pool replaced, pins kept, marking not re-sent, imported items untouched) and End to end › *seeds everything, then a second run…* with the new fixture |

Manual checks (🧑, not automated): a `-WhatIf` transcript against UAT, a full run against UAT with the
self-check all ✅, then the participant app showing photos, a playing video, threads with replies, and the
baselines, and the controller console's run-sheet panel showing the pack's items, pending, with their
assignees. For #510: the Pinned tab opens on the pack's pins, the console's noise knob shows Off with the pool
size, every image and video carries the EXERCISE bands, and (with `-RunSheet exceptMsel`) the run sheet holds
no msel item until the on-stage import adds it.
