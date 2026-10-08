# Story: Scripted posts — server-side inject queue (demo slice)

**Feature:** Inject queue & conduct timeline  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** CTL-010 (lite), CTL-011, CTL-014 (lite), COR-001, COR-018, COR-053, XC-002, XC-004, XC-010, NFR-004  ·  **Design decisions:** IQ-1…IQ-10 (implementation.md § Demo slice)  ·  **Issue:** #452
**Story ID:** IQ-B  ·  **Stack:** backend  ·  **Priority:** Must (Oct 20 demo)  ·  **Effort:** L
**Home stories:** [`01`](01-conduct-timeline.md) (list + status, no timeline rail), [`02`](02-fire-hold-skip-edit.md) (single-item fire/hold/skip/edit; no multi-select batch), [`04`](04-timed-bursts.md) (bursts, fixed ~90 s window). **Replaces** demo-polish [`C3`](../demo-polish/19-run-sheet.md)'s browser-only run sheet (#438).

## Context
**As** a controller in a multi-controller SimCell, **I want** scripted persona posts held on the server, assigned to
a controller like MSEL rows, and released on cue (one post, or a paced pile-on burst), **so that** Pulse matches the
Looking Glass workflow this customer runs today: a mix of pre-written posts released on cue and live role-play.

Decided with Tom on 2026-10-08 (interview; recorded in implementation.md § Demo slice):
- **Server-side for the demo.** Several controllers each own their slice of the script, so a list saved in one browser
  is not the product.
- **MSEL assignment.** Each item names a controller. "Mine" is a filter, not a lock: anyone can fire anything, and
  the log records who did.
- **Bursts.** A pile-on is released in ~1–2 minutes and mixes replies with standalone posts.
- **Media.** Scripted posts carry library media (beat 3's brown-tap-water photo).
- **Pause.** PAUSE INJECTS suspends bursts but manual fire still works. FREEZE blocks fire and suspends bursts.
- **No fallback to C3.** This outranks other Should/Could backend work before the 10/15 freeze.

**World: staff only.** Nothing in this story is participant-visible except the posts it publishes, which go through
the existing funnel and projection.

## Acceptance Criteria
- [ ] **Model.** New entities `InjectItem` and `InjectItemPost`, both `IExerciseScoped` and soft-deleted
      (`DeletedAt`, XC-010).
      - An item is `kind: post` (exactly 1 child) or `kind: burst` (2..20 children with a window of 30..600 s,
        default 90).
      - One new EF migration, created **on top of** demo-polish B1's migration. It passes the idempotent deploy
        script: one compiled batch per migration, so any hand-written SQL that names a column added in the same
        migration is `EXEC`-wrapped (the #413 rule).
      - A migration test proves `Up` applies on LocalDB/SQL Server.
- [ ] **Author and edit (staff API).** `POST /api/injects`, `PUT /api/injects/{id}`, `DELETE /api/injects/{id}` (soft)
      and `POST /api/injects/reorder` create, edit, delete and reorder items.
      - Item fields: title (1..120), notes (≤ 500), planned minute (`plannedMinute`, integer ≥ 0, shown as T+N, a sort
        hint and display only, **no auto-fire**), and assignee (a staff user assigned to this exercise, or none).
      - Per child post: `personaId`, text (1..280 code points, sanitized server-side at fire through the funnel,
        NFR-004), `media` (≤ 4 images **or** 1 video, `alt` 1..1000, never mixed), `replyTo` (`{sequence}` = an earlier sibling in
        this item, `{injectPostId}` = another scripted post, or `{postId}` = an existing post); on `PUT` a child echoing
        its `id` keeps its identity and `engagementBaseline` (0..1,000,000 each).
      - Edits are accepted only while the item is `pending`, `held` or `failed`. A `fired`, `firing` or `skipped` item
        is read-only (409).
      - Every write carries the item's `version`; a stale version is a 409, so two controllers editing at once never
        silently overwrite each other.
      - Validation failures are a 400 with a readable message. A persona, item or post id from another exercise gives
        **the same response as an unknown id** (COR-001).
- [ ] **Read.** `GET /api/injects` returns the exercise's items in `order`, with every child's status, so a console can
      poll it for live sync (IQ-6).
      - The response is a **staff-only DTO** (XC-002).
      - `GET /api/injects/assignees` lists the staff assigned to the active exercise (`id`, display name, role) plus
        the caller's own id.
- [ ] **Fire publishes through the one funnel.** `POST /api/injects/{id}/fire` publishes each child through
      **`PostIngestService.IngestAsync`**, in-process, with this attribution:
      - `origin: 'inject'` and `injectId` = the item id;
      - the controller who pressed Fire as the acting human (COR-018);
      - the persona as author;
      - scenario time from the exercise clock (COR-053), never the client.
      The post is therefore sanitized, persisted with its own `post`/`reply` telemetry event, broadcast live to
      participants (participant-safe projection only, XC-002) and seen by the engine's post observers, exactly like a
      live persona post.
      The child records the fired post id, wall-clock and scenario time, and who fired it. A `kind: post` item moves
      to `fired`.
- [ ] **Exactly once.** Firing claims the item through its `Version` concurrency token (IQ-9). If two controllers fire the same item
      at once, exactly one post is published and the other gets a 409 with the item's current state. Each burst child
      is claimed the same way, so a second app instance or a restart never double-posts.
- [ ] **Hold / release / skip / unskip / retry.**
      - `hold`: `pending → held`, and also `firing → held` for a burst, which suspends its remaining posts.
      - `release`: `held → pending`, or `→ firing` for a burst that already started.
      - `skip`: `pending|held → skipped`; a partly fired burst's remaining posts are skipped.
      - `unskip`: `skipped → pending`, or `→ held` if anything already fired.
      - `retry`: `failed → re-fire the failed posts`.
      Any other transition is a 409. `fired` is terminal; a fired post is corrected with takedown, not here.
- [ ] **Bursts are paced on the server.** Firing a burst publishes its first post immediately, then the rest across the
      window with jitter: increasing, never two at the same instant, and no gap under 3 s.
      - The pacing runs in a hosted service (`InjectBurstRunner`), so it continues if every console closes.
      - Progress (`firedCount`/`total`) is in the read model.
      - A child whose reply parent is an earlier child (`{sequence}` or `{injectPostId}`) **waits** for that parent's post id. One whose parent
        is in another, unfired item fails with "Fire the parent first" (and can be retried).
      - The item moves to `fired` when every child is fired or skipped, and to `failed` if any child failed.
- [ ] **Pause tiers (IQ-5).**
      - Under **PAUSE INJECTS** a running burst publishes nothing until resume, then continues at its original spacing.
        Overdue posts are **not** dumped together: lateness shifts the remainder. Manual fire still works.
      - Under **FREEZE**, `fire`/`retry` answer 409 ("The world is frozen") and bursts are suspended the same way.
      - **ENGINE PAUSED** has no effect.
      - After a backend restart a running burst resumes paced. The same lateness rule covers the downtime.
- [ ] **Failure is visible, never a false "fired".** If ingest refuses a child (invalid media, an unresolvable reply
      parent, ...), the child and item become `failed` with the ingest message and the response says so. Nothing is
      marked fired that the funnel did not create.
- [ ] **Telemetry (XC-004).** Every create, edit, delete, reorder, hold, release, skip, unskip, fire and retry emits
      exactly one server-side event, in the same unit of work as the state change:
      - `eventType: inject_action`, `channel: system`;
      - `actor { kind: system, actingHumanId }`, `injectId` = item id;
      - `target { entityType: inject, entityId }`;
      - wall-clock and scenario time;
      - `payload { action, kind, status }`.
      This comes in addition to each published post's own event, which carries `origin: inject` + the same `injectId`.
      The console emits nothing for these actions (no double count).
- [ ] **Staff only, exercise-scoped.** Every `/api/injects*` route requires a live **staff** session. A participant or
      anonymous caller gets 401/403, and a cross-exercise id is indistinguishable from an unknown one. All data is
      read and written through `PulseDbContext`'s central exercise filter and write guard.
- [ ] **Cannot merge unwired.**
      - A composition-root test on the **real `Program`** (`WebApplicationFactory<Program>`) proves every route is
        mapped (no 404 for an anonymous call; the gate answers first), `InjectBurstRunner` is a registered hosted
        service, and the queue service resolves.
      - An end-to-end test fires through the **real** `PostIngestService` and asserts the persisted post (origin
        `inject`, `injectId`, acting human), its telemetry, the `inject_action` event, the participant broadcast
        (no provenance) and an observer notification.

## Out of Scope
- Timed auto-release at `plannedMinute` (story 03).
- Spreadsheet/MSEL import.
- Cadence as a source (CTL-012, Phase 4).
- Time-jump disposition (story 05).
- Multi-select batch actions.
- Assignee locks.
- A SignalR push for queue changes (the console polls; see IQ-6).
- Editing a fired post.
- Moving the engine's pause state out of memory.

## Technical Notes
- **Files.** New `src/Pulse.WebApi/Features/Injects/**`: entities + EF configuration, `InjectQueueService`,
  `InjectEndpoints`, `InjectBurstRunner`, DTOs and `InjectTelemetry`.
  - Entities live in `Data/Entities/InjectItem.cs`, `InjectItemPost.cs`, with `DbSet`s in `PulseDbContext`.
  - Plus one migration.
  - The `Program.cs` `AddInjects()`/`MapInjects()` lines are **orchestrator-owned**: this story's orchestrator adds
    them in the same PR, and the composition-root test guards them.
- **Do not edit** `PostIngestService.cs`, `PostWriteEndpoints.cs` or `CreatePostRequest`: demo-polish BP owns them in
  this push.
  - Fire builds a `CreatePostRequest` + `PostAttribution` and calls `IngestAsync`.
  - Media / `ParentPostId` / `EngagementBaseline` are mapped onto BP's typed members (implementation.md §1.5.2) once BP
    merges. Until then a text-only mapping compiles, and the media/reply/baseline paths are covered by tests that are
    enabled when BP lands.
- **Amendment needed in BP (#425).** Honour `engagementBaseline` for origin `inject` as well as `controller-as-persona`.
  Keep media / reply / baseline handling **inside `IngestAsync`** so in-process callers get identical validation.
- **Reply to a scripted post** maps `replyTo.injectPostId` → that child's `FiredPostId` → `ParentPostId`, which B2's
  `IReplyParentResolver` resolves in scope.
- **Concurrency.** Every state change bumps the item's integer `Version` (`IsConcurrencyToken`). A concurrent writer
  gets `DbUpdateConcurrencyException` → 409. The repo has no `ExecuteUpdate`/rowversion precedent, and a token behaves
  the same on SQL Server and the test providers.
- **Gate and identity.**
  - Staff gate: `EngineCockpitStaffAuthorizationFilter`. Mutations also use `EngineCockpitControllerRoleFilter`. Both
    go on an empty-prefix group, as `PauseTierEndpoints` does.
  - The acting human is `ICurrentStaffSessionAccessor` → `StaffUserId` (the `PostAttributionResolver` pattern), never
    the body.
  - Assignees are `StaffAssignment` rows for the scoped exercise, joined to `StaffUser.DisplayName`.
- **Background scope.** The runner follows `EnginePublishService.cs:83-129`: create a scope, set
  `ExerciseContext.CurrentExerciseId` **before** resolving `PulseDbContext`/`PostIngestService`, then call
  `IngestAsync`. It reads the tier via `PauseTierRegistry.GetTier(exerciseId)`, which is in memory and resets to
  Running on restart. It discovers firing bursts across exercises with an `IgnoreQueryFilters()` read of ids only, then
  works per exercise inside a scoped context.
- **Time.** Scenario time = `IExerciseClock.CurrentScenarioTime(exerciseId) ?? exercise.CurrentScenarioTime ?? now`
  (the FollowService pattern); the time zone comes from the exercise row.

## Dependencies
- demo-polish **B1** merged: the migration is created on top of it.
- **BP** + **B2** merged before the media and reply paths go live (code against §1.5.2 until then).
- The existing pause tiers (`PauseTierRegistry`), exercise clock, staff session gate and telemetry pipeline.
- Must merge before the **backend freeze, Thu 10/15**; target Tue 10/13.

## Tests
- **Unit:**
  - the state machine (every allowed and refused transition);
  - burst pacing (increasing, jittered, ≥ 3 s gaps, first at 0);
  - the lateness shift (pause and restart never dump);
  - reply waits;
  - validation matrix.
- **Endpoint (TestServer):**
  - staff-only gate (participant/anonymous refused);
  - cross-exercise ids ≡ unknown;
  - version conflict → 409;
  - fire → fired;
  - double fire → one post + 409;
  - freeze → 409;
  - injects-pause → manual fire OK;
  - ingest refusal → `failed` with message.
- **Composition root:** `WebApplicationFactory<Program>` route + hosted-service + DI guard; verify the guard bites
  (neuter `MapInjects` and watch it fail).
- **Real funnel:** fire through real `PostIngestService` → post + telemetry + broadcast + observer.
- **Real SQL** (`RequiresDockerFact`, runnable locally with `PULSE_TEST_SQL_CONNECTION` → LocalDB): migration applies;
  concurrent fire claims → exactly one post.
