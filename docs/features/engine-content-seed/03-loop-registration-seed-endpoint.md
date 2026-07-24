# Story: Loop-registration seed endpoint — `POST /api/ops/seed-engine-content`  `[backend]` `[TIER-2]`

**Feature:** engine-content-seed  ·  **Epic:** E8  ·  **Phase:** 2  ·  **Stack:** backend  ·  **Status:** In Review (code-review clean; PR pending)
**Requirements:** E8 arch §1.2/§2/§14 (the loop's registration seam — closes exactly the gap
`ReactionLoopHost.cs`'s own doc comment flags as "a later story"), NFR-009 (secret-gated ops surface,
mirroring `BootstrapOptions`), COR-001/XC-001 (isolation)  ·  **Design decisions:** D5-014/1.1
(inherited — see AC3; this story wires into the existing auto-HOLD/kill-switch/swamped-mode invariants,
it does not re-decide them)  ·  **Review:** Tier-2 (a new ops secret, and the call that actually starts
live content generation into the participant feed — the always-Critical review class per
`FEATURE_ORCHESTRATION_PLAYBOOK.md`)  ·  **Issue:** #327

## Context
Everything downstream of this story already works and is `Complete`, untouched: the offline
`FakeGenerationProvider` is the configured default (`Generation:Provider = Fake`), `GenerateStage` runs
the guard-before-human gate, `ReactionLoopDriver` enqueues one review item per accepted burst,
`EngineReviewService` serves the queue and publishes an approved burst through
`EnginePublishService.PublishBurstAsync` → `PostIngestService.IngestAsync(origin:'engine')` → the feed.
The **only** missing piece, precisely as issue #324 traces it, is that nothing ever calls
`IReactionLoopRegistry.Register(...)` in production. This story is that call — composed from story 01's
seeded cast and story 02's canned storyline, behind a secret-gated ops endpoint modeled directly on
`login/05`'s `POST /api/ops/bootstrap-exercise` (same "documented Phase-1 stand-in, fails closed when
unconfigured" shape, same "no session exists yet to gate this any other way" reasoning) — but a
**sibling**, not an extension of it: bootstrap creates exercise **identity** (once, ever, per hostname);
this endpoint activates exercise **content generation** (re-callable, e.g. after a host restart empties
the in-memory registry — see `feature.md`'s "Registration lifecycle" note). Different blast radius,
different secret, different lifecycle — kept as two endpoints under the same `Features/Ops/*` family,
exactly as `BootstrapEndpoints.cs`'s own doc frames the `/api/ops/*` namespace.

**Secret gate — reuse `Authentication:Bootstrap:Secret` (user decision, 2026-07-24).** A separate secret
would mean another full threading round (bicep + workflow + a new GitHub secret + an infra redeploy). For a
single-operator UAT pilot that cost was judged not worth the cleaner rotation separation, so this endpoint
gates on the **same** `Authentication:Bootstrap:Secret` the bootstrap seam uses, presented in the same
`X-Bootstrap-Secret` header — reusing `BootstrapOptions` + `BootstrapSecretGate.IsAuthorized` verbatim
(no new options class, **no bicep/workflow change at all**). [Reversible: to split the secrets later, add an
`EngineSeedOptions` + a new `@secure()` param threaded like `jwtSecretKey`, and swap the bound options —
see implementation.md decision (e).]

## Acceptance Criteria
- [x] **Secret gate (mirrors `login/05` exactly).** Gated on `Authentication:Bootstrap:Secret` (reused,
  presented via the same `X-Bootstrap-Secret` header). Empty/unset by
  default, so the endpoint always returns `404` regardless of the presented header; a configured-but-wrong
  secret also returns `404` (never `401`/`403` — the endpoint does not confirm its own existence to an
  unauthorized caller); the comparison is constant-time (`BootstrapSecretGate.IsAuthorized`, reused, not
  reimplemented) and the secret is never logged.
- [x] **Resolve, never create, an exercise.** **Given** a valid secret and a request naming a `hostname`
  that already resolves to a bootstrapped `Exercise` (via `ExerciseHostName.TryNormalize` + the same
  `Exercises.Hostname` lookup `login/05`/`ExerciseResolutionMiddleware` use), **when** called, **then** it
  proceeds against that exercise; **given** a `hostname` with no matching exercise, **when** called,
  **then** it returns `404` **without creating one** — this endpoint never creates an `Exercise` (only
  `login/05`'s bootstrap does).
- [x] **Compose and register.** **Given** a resolved exercise, **when** called, **then** it: (a) seeds the
  persona cast via story 01's `PersonaCastSeeder.SeedAsync`; (b) builds the starter storyline via story
  02's `StarterStorylineFactory.Build`, passing the seeded handles; (c) resolves `Autonomy` via
  `EngineAutonomyRegistry.GetOrCreate(exerciseId)` — **the same per-exercise singleton instance**
  `EngineReviewService`/`EngineReviewTickHost` already read and mutate for auto-HOLD, kill-switch, and
  swamped mode (**never** a fresh, detached `EngineAutonomyState.Create(...)` — see `feature.md`'s
  "shared-instance correctness point"; a detached instance would silently desynchronize the loop's
  routing from the cockpit's safety controls); (d) builds one `ReactionLoopRegistration` (`ExerciseBrief`
  = the canned Fairhaven scenario brief; `ScenarioStart` = server UTC now at call time; `TimeZoneInfo`
  parsed from the resolved `Exercise.TimeZone` column, falling back to `TimeZoneInfo.Utc` on an
  unrecognized id; `RateConfig = RateGovernanceConfig.Default`; `ControllerDeskId` = a fresh `Guid`); and
  (e) calls `IReactionLoopRegistry.Register(...)` — after which the existing, unmodified
  `ReactionLoopHost` begins ticking this exercise on its next wall-clock heartbeat, with no further
  action.
- [x] **Idempotent re-run (documented limitation).** **Given** the same hostname is seeded twice, **when**
  called again, **then** persona rows are reused, never duplicated (story 01's contract), and the loop
  registration is safely **replaced** (`IReactionLoopRegistry.Register` overwrites by `exerciseId`), never
  duplicated or left orphaned — but the storyline is rebuilt fresh (`Dormant → Seeded` at a new minute 0),
  so any intensity/phase progress accrued since the first seed is reset. This is documented in the
  response and in `feature.md`, not silently swallowed.
- [x] **End-to-end proof (the feature's success criterion).** **Given** a freshly seeded exercise,
  **when** the default 3-scenario-minute silence window elapses (≈3 real minutes — scenario time advances
  1:1 with wall-clock and no freeze/jump occurs), **then** the unmodified loop enqueues a review item in
  the engine review queue (`GET` the review-queue endpoint shows it); **when** a controller approves it
  (`POST /api/engine/review/{id}/approve`, unmodified), **then** the posts appear in `GET /api/feed` —
  proving the offline `Fake`-provider path flows end-to-end with **no** live AI endpoint touched or
  required.
- [x] **Isolation (XC-001/COR-001).** The registration and every persona/storyline write this call
  triggers are scoped to the ops-resolved exercise only; calling the endpoint for exercise A never
  registers, reads, or writes anything against exercise B — extends the standing cross-exercise
  isolation suite with a "seed activates exactly one exercise's loop" case.
- [x] **Telemetry (XC-004).** A successful call emits exactly one audit event,
  `engine.content_seeded` (additive, open vocab — mirroring `exercise.bootstrapped`'s own precedent),
  carrying the exercise id, the persona created/reused counts, and the storyline id/title, in the same
  unit of work as story 01's persona writes — a one-time ops seed against a real environment leaves an
  audit trail, not a silent write.
- [x] **NFR-009 (abuse resistance).** The endpoint is per-IP rate-limited under its own named policy
  (`ops-engine-seed`, mirroring the `ops-bootstrap` policy) even though it is secret-gated — defense in
  depth against a leaked/guessed secret being brute-forced.

## Out of Scope
A controller-console "Start Engine" UI control (flagged in `feature.md` as a `console-shell`/
`world-steering` follow-up — no cockpit-triggered path this pass; an ops-secret call is sufficient to
meet this feature's success criterion). Auto-repopulating the registry on host restart (flagged in
`feature.md`; the operator re-calls this endpoint after a restart/redeploy). Accepting a caller-supplied
custom cast or storyline in the request body (Phase-1 seeds the fixed Fairhaven starter cast only; a
richer request-body-driven variant is a natural `persona-management`/storyline-authoring follow-up, not
built here). Any live-AI-provider activation or config (`Generation:Provider` stays `Fake`;
`engine-runtime/04` owns any live-provider flip — completely unrelated to this endpoint). Any change to
`ReactionLoopHost`, `EngineReviewService`, `EnginePublishService`, or the review-queue/feed endpoints —
this story only **calls** `IReactionLoopRegistry.Register`, it does not touch how the host ticks or
publishes.

## Technical Notes
Backend, ops-only — mirrors `login/05`'s own framing exactly: "no participant- or staff-session gate —
the secret header *is* the gate, by design (no session can exist yet... reachable this way)." New slice
`src/Pulse.WebApi/Features/Ops/EngineContentSeed/` (`EngineContentSeedEndpoints.cs`,
`EngineContentSeedOptions.cs`, `EngineContentSeedService.cs`, `EngineContentSeedDtos.cs`) — follows the
`Features/Ops/Bootstrap/*` slice shape file-for-file (options → secret gate reused → service → minimal-API
endpoint extension), namespaced `/api/ops/*` alongside `/api/ops/bootstrap-exercise`.

**Reuse, do not reinvent** (see `implementation.md` reuse map): `Pulse.WebApi.Features.Ops.Bootstrap.
BootstrapSecretGate.IsAuthorized` (already secret-agnostic — pass `EngineContentSeedOptions.Secret`
straight through, no fork); `Pulse.WebApi.Features.ExerciseResolution.ExerciseHostName.TryNormalize`; the
existing `Exercises.Hostname` unique-index lookup pattern (`BootstrapService.BootstrapAsync` step 3, read
verbatim — this story only reads, never writes, the `Exercise` row); `Pulse.WebApi.Features.EngineRuntime.
{IReactionLoopRegistry, ReactionLoopRegistration, EnginePersona}`; `Pulse.WebApi.Features.EngineRuntime.
EngineAutonomyRegistry` (declare a `TryAddSingleton<EngineAutonomyRegistry>()` in this slice's own DI
registration so it is self-contained regardless of whether `AddEngineReview()` ran first — same
order-independence convention `AddOpsBootstrap` already uses for its shared hashers);
`Pulse.Core.Features.Storylines.Models.RateGovernanceConfig.Default`; `System.TimeProvider` (server clock
for `ScenarioStart` — never client input).

**The exercise brief constant** this story owns (paired with story 02's storyline at registration time,
not owned by story 02 itself): `"Fairhaven is a mid-size municipality responding to a suspected
water-main contamination event near its treatment plant; the exercise plays out on the Pulse social
channel."` — trusted engine context for the generation prompt's system-prompt strata (§3.3/§3.4); never
participant-visible, never mixed with untrusted content.

**Time-zone parsing.** `Exercise.TimeZone` is a plain IANA string (e.g. `America/Chicago`, defaulted to
`UTC` by `BootstrapService`); this is the first place in the codebase that needs to turn that string into
a `TimeZoneInfo` for `IExerciseClock.Start(...)`. Wrap `TimeZoneInfo.FindSystemTimeZoneById(...)` in a
try/catch, falling back to `TimeZoneInfo.Utc` on `TimeZoneNotFoundException`/`InvalidTimeZoneException` —
a small, local helper; not worth a shared utility for one caller.

**`Program.cs` wiring (orchestrator-owned, serial, between waves):** `builder.Services.
AddEngineContentSeed(builder.Configuration);` placed **after** `AddReactionLoopHost()` and
`AddEngineReview()` (depends on `IReactionLoopRegistry` being registered; tolerant of DI order for
`EngineAutonomyRegistry` via `TryAddSingleton`); `app.MapEngineContentSeedEndpoints();` placed alongside
`app.MapBootstrapEndpoints()` / `app.MapEngineRuntime()` / `app.MapEngineReview()`. No new
middleware/ordering constraint — same as `MapBootstrapEndpoints`.

## Dependencies
Story 01 (`PersonaCastSeeder.SeedAsync`) and story 02 (`StarterStorylineFactory.Build`) — this story
composes both; it is the only story in this feature with a same-feature dependency. `engine-runtime`
(`Complete` — `IReactionLoopRegistry`, `ReactionLoopHost`, `EngineAutonomyRegistry`, `IExerciseClock`, all
delivered and unmodified). `login/05` (`BootstrapSecretGate`, `ExerciseHostName` — reused; a bootstrapped
`Exercise` must already exist for this endpoint to resolve).

## Tests
xUnit + one end-to-end `RequiresDockerFact` test mirroring `ReactionLoopHostTests`'s own harness pattern
(build the host with `AddEngineContentSeed()` alongside `AddReactionLoopHost()`, call the seed service
directly or through the endpoint, advance a `ManualTimeProvider` past the response window, run one tick,
and assert a review item is enqueued; approve it through `EngineReviewService` and assert a `Post` row
lands in the feed) — this is the automated proof of the feature's end-to-end success criterion, extending
rather than duplicating the existing loop test harness. Integration: an unconfigured
`Authentication:Bootstrap:Secret` rejects every call with `404` regardless of the presented header
(mirrors the `login/05` test precedent exactly); an unknown hostname returns `404` without creating an
exercise; calling the endpoint twice for the same hostname leaves the persona count unchanged (idempotent)
and replaces rather than duplicates the loop registration (`IReactionLoopRegistry.Active.Count` unchanged
across the two calls for that exercise). Security: the secret comparison is constant-time (reuses
`BootstrapSecretGate`'s own proven test pattern). Telemetry: a successful call emits exactly one
`engine.content_seeded` event.

**Delivered tests** (`Pulse.WebApi.Tests/Features/Ops/EngineContentSeed/`):
- `EngineContentSeedEndpointsHttpTests` (plain `[Fact]`, self-hosted `TestServer`): `Seed_UnconfiguredSecret_Returns404_RegardlessOfHeader`, `Seed_MissingSecretHeader_Returns404`, `Seed_WrongSecret_Returns404` (AC1 — fail closed, 404 never 401/403); `Seed_CorrectSecretButNullBody_Returns400`, `Seed_CorrectSecretButMissingHostname_Returns400` (validation); `Seed_ExceedsPerIpRateLimit_Returns429` (AC8 — NFR-009).
- `CompositionRootWiringTests.ProgramCs_MapsTheSeedEngineContentEndpointExactlyOnce` (`[Fact]`, `WebApplicationFactory<Program>`): the #310→#317 regression guard — the route is wired into the real `Program.cs` exactly once.
- `EngineContentSeedServiceTests` (`[RequiresDockerFact]`, real SQL): `Seed_UnknownHostname_Returns404_WithoutCreatingAnExercise` (AC2); `Seed_ResolvesExistingExercise_SeedsSixPersonas_AndRegistersTheLoop` (AC3); `Seed_RegistrationAutonomy_IsTheSharedRegistryInstance_NotADetachedOne` (AC3 — the shared-instance correctness point); `Seed_RunTwice_ReusesPersonas_AndReplacesRegistration_NeverDuplicates` (AC4); `Seed_ThenTickPastWindow_EnqueuesReviewItem_ThenApprove_LandsPostInFeed` (AC5 — end-to-end success criterion); `Seed_ForExerciseA_NeverWritesOrRegistersExerciseB` (AC6 — isolation); `Seed_EmitsExactlyOneContentSeededEvent_InTheSameUnitOfWork` (AC7); `Seed_UnconfiguredSecret_Rejected_WritesNothing` (AC1 — fail closed at the service).

**Deviation from Technical Notes' file list:** per decision (e) [reverted per user, 2026-07-24], the slice reuses `BootstrapOptions` (`Authentication:Bootstrap:Secret`) verbatim rather than introducing a new `EngineContentSeedOptions` — so `EngineContentSeedOptions.cs` is intentionally NOT created (no new secret, no bicep/workflow change). The slice owns `EngineContentSeedEndpoints.cs`, `EngineContentSeedService.cs`, and `EngineContentSeedDtos.cs`.
