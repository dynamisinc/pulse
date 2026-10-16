# Wave 4: restart-proof state, edit own post, finish (demo 10/20)

> **Status: plan agreed with Tom 10/15 (Thu evening); contract FROZEN once story 17 opens.** This is the Wave 4
> addendum to [`implementation.md`](implementation.md) and [`feature.md`](feature.md). It lives in its own file
> because `feature.md` and `implementation.md` have diverged between `main` (DF-21..DF-23, story 16) and
> `feature/demo-feedback-w3` (DF-17..DF-20, stories 11-15). **After the Wave 3 PR merges, the orchestrator folds the
> Wave 4 rows below into `feature.md` (Stories table, UAT walk) and the DF rows into `implementation.md`** in one
> docs commit, and this file stays as the wave plan.
>
> Mechanics as Wave 3: one story per worktree off the wave's integration branch, a read-only Gate-1 review per
> branch (clean = no Critical/High), Mediums folded, real merges (never squash), **one migration for the wave
> (story 17) with Tom's Tier-2 sign-off**, PR to `main` with a Copilot review. Merging to `main` deploys to UAT.

## Why this wave

The demo plan's §10 names the top stability risk: **"UAT state is fragile (restarts drop the engine and clock)"**.
The pause tier, the exercise clock and the participant holding-page state live only in memory
(`PauseTierRegistry`, `ExerciseClockService`, `OverlayStateService`), so every deploy or App Service restart sets the
engine back to Running and restarts scenario time. That is how UAT showed **LIVE (suggest) with ~37 drafts** after
`Reset-DemoState` on 10/15, and it is why Monday's seed must follow the last deploy. Wave 4 makes that state survive a
restart, adds the one participant feature Tom still wants for an X that looks finished (**edit your own post**), and
closes the finish items.

## Who builds what (agreed 10/15)

| Session | Owns | Integration branch |
|---|---|---|
| **Planning session** (this plan's author) | 17, 18, 19, 20 (the wave's one migration and edit own post), 26, 27, 28 (demo readiness), and the load-report slice ([`post-demo-feedback/01`](../post-demo-feedback/01-load-test-report.md)) | `feature/demo-feedback-w4` (17-20); 26-28 go to `main` as one small scripts/docs PR |
| **Wave 3 session** (after its Wave 3 PR #534) | 21, 22, 23, 24, 25 | `feature/demo-feedback-w4-polish` |

The Wave 3 session asked for this list to check it for overlaps with its in-flight work. **Neither session edits
the other's worktree or branch.** The owned-files column below is the contract between them.

## Decisions (DF-24..DF-39)

DF numbers continue after `main`'s DF-23 (`feature/demo-feedback-w3` used DF-17..DF-20, `main` DF-21..DF-23; no
overlap).

| # | Decision | Source |
|---|---|---|
| DF-24 | **Pause tier, exercise clock and holding-page state survive a restart.** One row per exercise in a new `ExerciseRuntimeStates` table, written through on every applied change, read back by a startup rehydrator before any hosted service ticks | Tom 10/15 |
| DF-25 | **A running clock keeps advancing through downtime.** The row stores the anchor (`ScenarioStart`, elapsed-at-anchor, wall anchor as UTC `DateTimeOffset`, frozen flag, time zone); on restore, `elapsed = elapsedAtAnchor + (utcNow - wallAnchorUtc)` when running, `elapsedAtAnchor` when frozen. Scenario time after a restart is what it would have been, so it matches participants' browser clocks | Tom 10/15 |
| DF-26 | **The tier comes back exactly as persisted** (Freeze stays Freeze, Engine stays Engine, Running stays Running), and the participant holding page (overlay state, register, message) comes back with it | Tom 10/15 |
| DF-27 | **The overlay sequence is monotonic across restarts.** It is persisted with the overlay snapshot, and the first sequence after a restore is the persisted value + 1, so a participant client that saw a high sequence never drops the next frame | orchestrator |
| DF-28 | **A controller can reset an exercise's runtime state** (`POST /api/steering/runtime-state/reset`: tier Running, clock unstarted, overlay none, row deleted). The demo reset uses it instead of an App Service restart, so a reset no longer costs the 8-minute restart wait. An App Service restart no longer clears anything (README-seed and `Reset-DemoState -Restart` docs change) | orchestrator |
| DF-29 | **Participants edit their own posts and replies, text only.** Media, reply target and author never change. Origin must be `participant`; engine, noise, inject and controller-as-persona posts are not editable; a taken-down post is not editable | Tom 10/15 |
| DF-30 | **The edit window is 15 minutes of wall-clock time from `Post.CreatedWallClock`, at most 5 edits** (X parity), checked on the server. The participant never sees a wall-clock time (COR-053): the read gives `viewer.editableForSeconds` (own posts only) and the client counts that down. **Amended 10/15 evening:** an edit is refused (409 `frozen`) whenever posting is refused: pause tier Freeze, a frozen clock, or a lifecycle that is paused or ended. The window keeps running meanwhile | Tom 10/15 + orchestrator |
| DF-31 | **Edit history is visible to everyone, X-style.** The card shows "Edited"; "View edit history" lists every version with its scenario time, newest first. Staff see the same in Live world, and the export carries the edit count, the last edit's scenario time and the original text | Tom 10/15 |
| DF-32 | **Controllers do not edit persona posts** (takedown + post a correction stay the staff tools). Controller editing stays on the roadmap | Tom 10/15 |
| DF-33 | **An edit publishes one exercise-group push, `PostEdited`**, after commit, with the new text, the edit summary and `version = EditCount` (monotonic per post; a stale frame drops). It never re-notifies mentions and never moves counts. An identical text is a no-op (200, nothing written, nothing pushed) | orchestrator |
| DF-34 | **The exercise-pin marker shows on every card** (feed, thread, profile, Pinned, Live world already has it): a "Pinned" line above the author, icon plus text (never icon or color only), updating live from `PostPinChanged`. Personal pins stay private (the Pin action's own state) | Tom 10/15 |
| DF-35 | **Exercise Management gets rename, archive and a minimal duplicate.** Rename and archive from row actions; archive follows the lifecycle (`completed → archived` only). Duplicate creates a new exercise in `build` with: settings columns (brand, chrome, watermark, channels, outlets, time zone; noise reset to `off`), personas, noise pool, run sheet (items reset to pending, fired/claim fields cleared), and the caller's staff assignment. **Not copied:** posts, reactions, pins, follows, roster accounts, links, day words, sessions, telemetry, engine review items. Media rows are re-keyed to the new exercise pointing at the **same blob** (no blob copy) | Tom 10/15 |
| DF-36 | **"Mark fired" fires a run-sheet item without publishing** (an inject delivered outside Pulse or posted by hand): from `pending`, `held` or `failed`, controller only, behind a confirm. It stamps `FiredByHumanId` and `FiredScenarioTime`; the row shows "Marked fired" (derived: fired with no child post carrying a post id). Allowed under Freeze (nothing reaches participants). No undo | Tom 10/15 |
| DF-37 | **One COBRA muted-text token** (AA on white and on the console surfaces) replaces the per-file grey constants; the below-AA `#848482` goes from staff text. Participant themes are untouched | Tom 10/15 |
| DF-39 | **The export gains a second sheet, `Edit history`** (amends DF-8's one sheet): one row per version of every post or reply that has been edited, with post id, edit number (0 = original), scenario time, wall clock (UTC), text, and current (yes/no). Never-edited posts have no rows (their only version is on `Posts`). Text cells are values, never formulas | Tom 10/15 evening |
| DF-38 | **AI for the demo: Fake provider, engine paused by the seed, beat 7 optional.** No §8 sign-off, no live provider. The pre-flight (26) fails if the tier is looser than `engine` | Tom 10/15 |

## Frozen wire contract

### Schema (story 17, ONE migration `DemoFeedbackWave4RuntimeAndEdits`)

| Entity | Change |
|---|---|
| **new** `ExerciseRuntimeState` (`ExerciseRuntimeStates`), `IExerciseScoped` | `ExerciseId` (PK + FK to `Exercises`, **restrict**: XC-010, no cascading FKs; amended 10/15 at story 17 build), `PauseTier` nvarchar(16) not null default `running`, `ClockScenarioStart` datetimeoffset null, `ClockTimeZone` nvarchar(64) null, `ClockElapsedAtAnchorTicks` bigint null, `ClockWallAnchorUtc` datetimeoffset null, `ClockFrozen` bit not null default 0, `OverlayState` nvarchar(16) not null default `none`, `OverlayRegister` nvarchar(16) null, `OverlayMessage` nvarchar(500) null, `OverlaySequence` bigint not null default 0, `UpdatedAt` datetimeoffset not null. Clock columns are all null (unstarted) or all set |
| `Post` | `EditCount` int not null default 0; `LastEditedAt` datetimeoffset null (wall clock, staff/export only); `LastEditedScenarioTime` datetimeoffset null |
| **new** `PostEdit` (`PostEdits`), `IExerciseScoped` | `Id` guid PK, `ExerciseId` not null, `PostId` FK to `Posts` (restrict), `EditNumber` int (1..5), `PreviousBody` (same max length as `Post.Body`), `EditedAt` datetimeoffset (wall), `EditedScenarioTime` datetimeoffset, `ActingHumanId` (same type as `Post.ActingHumanId`, nullable). Unique index (`PostId`, `EditNumber`) |

Only story 17 touches the snapshot. Stories 18-25 never add a migration; if one seems needed, stop and ask.

### Routes

| Route | Who | Story |
|---|---|---|
| `POST /api/steering/runtime-state/reset` → 200 `PauseTierStateDto` | controller (`EngineCockpitStaffAuthorizationFilter` + `EngineCockpitControllerRoleFilter`) | 18 |
| `PATCH /api/posts/{postId:guid}` `{ text }` → 200 `ParticipantPostDto`; 403 not yours / not participant origin; 404 other exercise or taken down; 409 `{ reason: "window-closed" \| "edit-limit" \| "frozen" }`; 400 empty or too long | participant session that authored it | 19 |
| `PATCH /api/posts/{postId:guid}` notes (19 Gate-1, 10/16) | an **ended** exercise (completed/archived/build) is refused **403 by the lifecycle gate** before the handler; `409 frozen` covers Freeze, a frozen clock and `paused`. Two edits colliding on (PostId, EditNumber): the loser gets **409 with no body** = concurrent edit, re-read (story 20 shows its generic error). `viewer.editableForSeconds` keeps counting during Freeze/pause; the server answers `frozen` | 19 |
| `GET /api/posts/{postId:guid}/edits` → 200 `PostEditHistoryDto` | any session in the exercise (participant or staff) | 19 |
| `PATCH /api/org/exercises/{exerciseId:guid}` `{ name }` → 200 org exercise row | planner, org admin, controller (DF-20 set) | 22 |
| `POST /api/org/exercises/{exerciseId:guid}/archive` → 200 / 409 `{ reason: "not-completed" }` | same | 22 |
| `POST /api/org/exercises/{exerciseId:guid}/duplicate` `{ name }` → 201 org exercise row | same | 22 |
| `POST /api/injects/{itemId:guid}/mark-fired` `{ expectedVersion }` → 200 inject item | controller | 23 |

### Types

```ts
// ParticipantPostDto / StaffPostDto gain (19):
edited: { count: number; scenarioTime: string } | null   // null when never edited
// ParticipantPostDto.viewer gains (own posts only; absent otherwise):
editableForSeconds?: number                               // seconds left in the window, 0 when closed or at the limit

// PostEditHistoryDto (19)
{ postId: string; versions: Array<{ editNumber: number; text: string; scenarioTime: string }> }
// versions newest first; the current text is editNumber = EditCount, the original is editNumber 0

// PostEdited push (19), exercise group, after commit
{ postId: string; text: string; edited: { count: number; scenarioTime: string }; version: number } // version = count

// PauseTierStateDto gains (18):
persisted: boolean   // false only when the write-through failed (logged at Error); the console shows a warning chip
```

### Export columns (19, sheet `Posts`, appended after the existing columns)

`Edits` (int) · `Last edited (scenario)` · `Original text` (blank when never edited). Text cells stay text values
(never formulas), as DF-8's gotcha.

**Second sheet `Edit history` (DF-39):** `Post id` · `Edit number` (0 = original) · `Scenario time` · `Wall clock (UTC)` ·
`Text` · `Current` (`yes`/`no`). One row per version of each edited post or reply, ordered by post then edit number;
autofilter and frozen header like `Posts`. Version 0's times are the post's `CreatedScenarioTime` / `CreatedWallClock`;
version n's are `PostEdit` n's `EditedScenarioTime` / `EditedAt`; its text is `PostEdit` n+1's `PreviousBody`, or the
current `Body` for the last version.

### Telemetry (XC-004, counts only, no text, no names)

`post.edited` (postId, editNumber, scenario + wall time, actor session kind) · `steering.runtime_reset` ·
`inject.marked_fired` · `exercise.renamed` / `exercise.archived` / `exercise.duplicated` (source and new id, row
counts copied).

## Wave plan

`Effort`: S ≤ ½ day of agent time, M ≈ 1 day.

| Story | Owner | Stack | Pri | Files it owns | Depends on | Effort | Tier-2 |
|---|---|---|---|---|---|---|---|
| [17 Foundation](17-wave4-foundation-schema-and-contract.md) (#535) | planning | backend | Must | `Data/Entities/{Post,PostEdit,ExerciseRuntimeState}.cs`, `Data/PulseDbContext.cs`, the one migration + snapshot, contract DTO stubs (`Features/Social/Editing/PostEditDtos.cs`, `PauseTierStateDto.persisted`) | none | S | **Yes (schema)** |
| [18 Persist tier + clock](18-persist-pause-tier-and-clock.md) (#536) | planning | backend | Must | `Features/EngineRuntime/Clock/**`, `Steering/{PauseTierRegistry,PauseTierEndpoints,PauseOverlayPublisher}.cs`, `OverlayStateService`, new `Features/EngineRuntime/Persistence/**` (+ tests) | 17 | M | review |
| [19 Edit own post: backend](19-edit-own-post-backend.md) (#537) | planning | backend | Must | new `Features/Social/Editing/**`; `Social/{ParticipantPostDto,PostWireDtos}.cs` + the staff post DTO (the `edited` field only); `Realtime/{IFeedBroadcaster,SignalRFeedBroadcaster}.cs` (`PostEdited`); `Features/Exports/{PostExportRow,PostExportWorkbook,PostExportService}.cs` (three columns) (+ tests) | 17 | M | review (new write route) |
| [20 Edit own post: frontend](20-edit-own-post-frontend.md) (#538) | planning | frontend | Must | new `social/edit/**`; `social/components/post/{PostActions,PostHeader,PostBody}.tsx`; `social/types/post.ts`; `social/services/realtimeFeed.ts` (`PostEdited`); `social/services/postService.ts` (mocks + map `edited`); `controller/liveWorld/LiveWorldRow.tsx` (Edited chip + history link only) (+ tests) | 17's contract (mocks); 19 for the live check | M | no |
| [21 Pinned marker on every card](21-pinned-marker-every-card.md) (#539) | W3 session | frontend | Must | `social/components/post/PostCard.tsx`, new `social/components/post/PinnedMarker.tsx` (+ css, tests); `social/pinned/PinnedFeed.tsx` (switch its own label to the shared marker) | none | S | no |
| [22 Exercise rename, archive, duplicate](22-exercise-rename-archive-duplicate.md) (#540) | W3 session | fullstack | Should (duplicate: Could) | `Features/ExerciseLifecycleAdmin/**`; new `Features/ExerciseLifecycleAdmin/Duplicate/**`; `features/exerciseLifecycleAdmin/**` (+ tests) | none | M+ | **Yes (writes ~8 exercise-scoped tables)** |
| [23 Mark fired](23-mark-as-fired.md) (#541) | W3 session | fullstack | Should | `Features/Injects/{InjectEndpoints,InjectQueueService}.cs` (one new method + route); `controller/runSheet/{RunSheetRow,RunSheetStatusChip}.tsx`, `controller/services/injectService.ts`, `useInjectQueue.ts` (+ tests) | none | S | no |
| [24 Persona refresh on switch](24-persona-refresh-on-switch.md) (#542) | W3 session | frontend | Should | `features/personas/personaService.ts`, `controller/components/PersonaPicker.tsx` (+ tests) | none | S | no |
| [25 COBRA muted token + visual pass](25-cobra-muted-text-and-visual-pass.md) (#543) | W3 session | frontend | Should | `theme/cobraTheme.ts`, `theme/CobraStyles.ts`, the listed constant files (`personaEditStyles.ts`, `rosterStyles.ts`, `PersonaContextPanel.tsx`, `PersonaComposerEmoji.module.css`, `staffShellTokens.ts`); visual-pass fixes only in files no other Wave 4 story owns | none; visual pass after 21 + 20 merge | S | no |
| [26 Demo pre-flight + one-shot reset](26-demo-preflight-and-reset.md) (#544) | planning | script | Must | new `scripts/uat/{Test-DemoReady,Invoke-DemoReset}.ps1` (+ `.Tests.ps1`), `scripts/uat/Reset-DemoState.ps1` (call the runtime reset), `scripts/uat/README-seed.md` | 18 deployed for the reset step (falls back to `-Restart` until then) | S | no |
| [27 Freeze verification (beat 6)](27-freeze-beat6-verification.md) (#545) | planning | script + manual | Must | new `scripts/uat/Test-FreezeResume.ps1`; `docs/features/world-steering/{07,08}-*.md` status lines | 18 for the restart check | S | no |
| [28 Governance docs correction](28-governance-docs-correction.md) (#546) | planning | docs | Should | `docs/demo/AI-GOVERNANCE-BRIEF.md`, `docs/demo/PARTICIPANT-FIRST-DEMO-PLAN.md` (the draft-leak lines), `docs/features/social-api/05-realtime-role-scoped-groups.md` | none | S | Tom reviews the brief before it is sent |

**Hot-file splits between the two sessions.** `PostCard.tsx` belongs to 21 (the marker sits above the header);
`PostActions.tsx`, `PostHeader.tsx`, `PostBody.tsx` and `social/types/post.ts` belong to 20. 21 reads the existing
`post.pinnedForAll` and never changes the post type. `LiveWorldRow.tsx` belongs to 20 (Edited chip); 24 changes the
persona store only, never Live world files. 25 fixes nothing in a file another Wave 4 story owns; it lists such
findings for the owner.

### Integration seams (orchestrator-owned, never a wave story)

| Seam | File(s) | Owner | When |
|---|---|---|---|
| S-5 Backend composition root (planning) | `src/Pulse.WebApi/Program.cs`: `AddExerciseRuntimePersistence()` (registers the rehydrator **first** among hosted services, before `ReactionLoopHost`, `EngineReviewTickHost`, `InjectBurstRunner`, `WhiteNoisePacer`), `MapRuntimeStateReset()` beside `MapPauseTier…`, `AddPostEditing()/MapPostEditing()` after `AddSocialRealtimeHub()`; `CompositionRootWiringTests` asserts each new route maps exactly once and the rehydrator is the first hosted service | planning | After 18 + 19 merge into `feature/demo-feedback-w4` |
| S-6 Backend composition root (W3 session) | `Program.cs`: any new `Map…` for 22 (the org routes may live inside the existing `MapExerciseLifecycleAdmin`, then no seam); 23's route lives inside `MapInjects` (no seam) | W3 session | After 22 merges |

Two sessions touching `Program.cs`: whichever PR reaches `main` second merges `main` in first (a real merge) and
re-runs `CompositionRootWiringTests`.

### Calendar

| When | Planning session | W3 session | Tom |
|---|---|---|---|
| **Fri 10/16 AM** | 17 (migration) opens first. 26, 27 (script part), 28 in parallel | Wave 3 PR [#534](https://github.com/dynamisinc/pulse/pull/534) (opened 10/15) through Copilot | Merge #534 (deploys). **Tier-2 on 17 by midday** |
| **Fri 10/16 PM** | 18 ∥ 19 after 17 merges into `feature/demo-feedback-w4`; 20 starts on mocks. Readiness PR (26-28) to `main` | 21, 24, 23 in parallel; 22 starts | Merge readiness PR; review the corrected brief |
| **Fri 10/16 night** | Gate-1 on 18/19; S-5; `feature/demo-feedback-w4` backend PR to `main` if green | 22 Gate-1 | Tier-2 on 22 (duplicate) |
| **Sat 10/17 AM** | **Load test** ([post-demo-feedback/01](../post-demo-feedback/01-load-test-report.md)) on a throwaway exercise; 20 live check | 25 token + visual pass | Run the load script (you sign in) |
| **Sat 10/17 PM** | 20 Gate-1 → Wave 4 PR(s) to `main`; reset + seed with `Invoke-DemoReset`; **Rehearsal 1** | Polish PR to `main` | Merge; rehearse |
| **Sun 10/18** | Fixes; `Test-FreezeResume`; UAT walk (below) | Fixes | **Pencils down evening** |
| **Mon 10/19** | `Invoke-DemoReset` + `Test-DemoReady`; rehearsal 2 | — | Rehearse |

**First to cut if the window slips:** 22's duplicate (Could), then 25's visual pass, then 23, then the load slice.
17-21, 26 and 27 are the floor.

## Gotchas that will bite a parallel builder

- **One migration.** Only 17 touches the snapshot. The idempotent deploy script (`deploy-backend.yml`) runs it.
- **The rehydrator runs before anything ticks.** `ReactionLoopHost.EnsureClockStarted` starts a clock only when it is
  neither running nor frozen (`ShouldStartClock`), so a restored clock is never restarted; a test proves it.
- **`ExerciseClockState` keeps a monotonic `TimeProvider` timestamp, which cannot be persisted.** Persist a UTC
  `DateTimeOffset` wall anchor beside it; never write `GetTimestamp()` to the database.
- **Write-through is awaited after the in-memory apply, outside `PauseTierRegistry`'s lock** (the overlay publish is
  already outside it). A failed write logs at Error and returns `persisted: false`; it never rolls back the tier.
- **The rehydrator reads every exercise's row.** Use the same cross-exercise read pattern as `WhiteNoisePacer`
  (documented `IgnoreQueryFilters` in one reader, per-exercise writes under `ExerciseContext`).
- **An edit is not a new post.** No `PostReceived`, no mention notification, no count change, no new engagement
  version. Hashtag/trending reads recompute from `Body` as they do today.
- **Never show wall clock to a participant.** `editableForSeconds` is a duration; history shows scenario times.
- **A test pins `PostViewerState` keys** (`post.provenance.test.ts`); 20 updates it for `editableForSeconds`.
- **Duplicate writes across exercises.** The `PulseDbContext` write guard only refuses an **empty** `ExerciseId`; it
  does NOT refuse a row stamped with another exercise's id (corrected 10/15 at story 17 build). So 22 must set every
  copied row's `ExerciseId` to the new exercise explicitly, read under the source exercise, never `IgnoreQueryFilters`
  on a write, and prove with a test that no source row changed. Media read must authorize by the `MediaAsset` row, not a blob path prefix; 22 proves a re-keyed row serves.
- **Mark fired publishes nothing.** It must not go through the post funnel or the burst runner.

## Risks

| Risk | Mitigation |
|---|---|
| 17 slips and blocks 18/19 | 17 is S, opens first Friday; Tier-2 by midday |
| Persisted Freeze surprises a reset ("never leave FROZEN overnight") | `Invoke-DemoReset` calls the runtime reset first; `Test-DemoReady` fails on Freeze |
| A restart after Monday's seed now *keeps* state; someone expects a clean slate | README-seed and `Reset-DemoState -Restart` help text say so; the reset route is the clean slate |
| Edit window disputes on stage | Server is authoritative; the client counts down from `editableForSeconds` and hides Edit at 0 |
| Load test degrades UAT the day before rehearsal | Throwaway exercise, Saturday AM only, stop rules, `Test-DemoReady` on the demo exercise afterwards |
| Duplicate corrupts isolation | Tier-2 sign-off; isolation tests that the source exercise is unchanged and the copy sees only its own rows |

## Manual UAT walk additions (Sun 10/18; fold into `feature.md`)

10. Set Pause engine, restart the App Service: after it is back the console shows Pause engine and the scenario
    clock reads what it would have without the restart. Freeze, restart: the participant still sees the holding page;
    Resume continues from the same scenario minute.
11. As a participant, post, then edit within 15 minutes: the other browser shows the new text live with "Edited";
    "View edit history" lists both versions with scenario times. After 15 minutes (or 5 edits) Edit is gone. A reply
    edits the same way. Export shows the edit count and the original text.
12. A post a controller pinned for everyone shows "Pinned" in the home feed, the thread and the profile, not only
    in the Pinned tab, and it goes away live when unpinned.
13. Exercise Management: rename an exercise, archive a completed one, duplicate the demo exercise: the copy opens
    in build with the personas, run sheet (all pending) and noise pool, and no posts.
14. Run sheet: Mark fired on a pending item: it shows "Marked fired", nothing appears in the feed.
15. Switch exercise in the console: the persona picker lists the new exercise's personas without a reload.
16. `Test-DemoReady.ps1` passes on the demo exercise after `Invoke-DemoReset.ps1`.
