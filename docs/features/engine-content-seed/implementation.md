# Implementation: Engine content seed / drive path

> Closes issue #324 — the last unbuilt seam of `docs/BACKEND_ROADMAP.md` Phase B3
> (`engine-runtime`, `Complete`). Three small `[backend]` stories, no frontend, no schema migration.
> Story 03 carries an elevated bar: **`[TIER-2]`** (a secret-gated ops call — reusing
> `Authentication:Bootstrap:Secret`, no new secret — that activates live content generation into the
> participant feed, the always-Critical review class). Everything downstream of
> registration (generate/guard/publish/measure, the review cockpit, the feed) is `Complete` and
> **out of scope for changes** — this feature only feeds it real seed data and turns it on.

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|-------------------|-------------------------------|
| 01 Persona cast seed | An idempotent write path over the existing `Persona` `DbSet` (no migration): given an `exerciseId`, ensure a fixed starter cast exists (by `(ExerciseId, Handle)`), reusing existing rows on re-run. **As originally shipped: six personas, no impersonator.** **Superseded (`profiles-social-graph/06`, #369): the same file's catalog now seeds nine, including the SOC-052 impersonation pair, gated engine-side by `Persona.Castable`** — see that story. Because this ops seam has no per-request `IExerciseContext`, idempotency reads use `IgnoreQueryFilters()` + an explicit `ExerciseId` predicate (`BootstrapService`'s own documented pattern). Pairs each persisted row with a real `PersonaDossier` from a small internal catalog. | `Pulse.WebApi/Features/Ops/EngineContentSeed/PersonaCastSeeder.cs` (+ xUnit) | `PersonaCastSeeder.SeedAsync(Guid, CancellationToken) -> IReadOnlyList<SeededPersona>` (`SeededPersona` pairs `Persona.Id` + `PersonaDossier`) — story 03 assembles these into `EnginePersona`s |
| 02 Starter storyline factory | A pure static factory (no DI, no I/O) that calls the already-built `Storyline.Create(...)` / `.Seed(0)` with the Fairhaven-arc constants (title/expectation/curve/hashtags) and a citizens-first `ParticipatingPersonas` order built from the handles it is given. `responseWindowMinutes` is caller-tunable (default 3 — demo-tuned, since scenario minutes run 1:1 with wall-clock). | `Pulse.WebApi/Features/Ops/EngineContentSeed/StarterStorylineFactory.cs` (+ xUnit) | `StarterStorylineFactory.Build(Guid exerciseId, IReadOnlyList<string> personaHandles, StarterStorylineOptions? options) -> Storyline` |
| 03 Loop-registration seed endpoint | A secret-gated ops endpoint (`POST /api/ops/seed-engine-content`), modeled file-for-file on `Features/Ops/Bootstrap/*`: resolve the exercise by hostname (never create one) → call 01 → call 02 with 01's handles → resolve `Autonomy` from the **shared** `EngineAutonomyRegistry.GetOrCreate(exerciseId)` (not a detached instance — the load-bearing correctness point) → build one `ReactionLoopRegistration` → `IReactionLoopRegistry.Register(...)` → emit one `engine.content_seeded` XC-004 event. | `Pulse.WebApi/Features/Ops/EngineContentSeed/{EngineContentSeedEndpoints.cs, EngineContentSeedOptions.cs, EngineContentSeedService.cs, EngineContentSeedDtos.cs}` (+ xUnit, incl. one `RequiresDockerFact` end-to-end test) | The `AddEngineContentSeed(config)` / `MapEngineContentSeedEndpoints()` composition-root pair |

## Reuse map

**This feature's own dependency (built, `Complete`, unmodified) — the entire reason this feature is
small:**
- `Pulse.WebApi.Features.EngineRuntime.{IReactionLoopRegistry, ReactionLoopRegistration, EnginePersona,
  ReactionLoopHost}` — the host + registry story 03 populates; nothing here changes how it ticks.
- `Pulse.WebApi.Features.EngineRuntime.EngineReviewService` / `EngineAutonomyRegistry` /
  `EngineReviewTickHost` — the auto-HOLD/kill-switch/swamped-mode safety layer story 03 must share an
  instance with (`GetOrCreate(exerciseId)`), never re-decide.
- `Pulse.Core.Features.Storylines.Models.Storyline` (`.Create`/`.Seed`) — story 02's only dependency.
- `Pulse.Core.Features.Generation.Models.{PersonaDossier, PersonaStyle, PersonaType}` — story 01's
  dossier shape, identical to what `GenerateStage`/`IntentComposer` already consume.
- `Pulse.Core.Features.Storylines.Models.RateGovernanceConfig.Default` — story 03's `RateConfig`.
- `Pulse.Core.Features.Generation.Services.FakeGenerationProvider` — already the configured default
  (`Generation:Provider = Fake` in `appsettings.json`); this feature never touches generation config.

**`login/05` (`Complete`) — reused verbatim, not forked:**
- `Pulse.WebApi.Features.Ops.Bootstrap.BootstrapSecretGate.IsAuthorized(string?, string?)` — already
  secret-agnostic; story 03 passes its own `EngineContentSeedOptions.Secret` straight through.
- `Pulse.WebApi.Features.ExerciseResolution.ExerciseHostName.TryNormalize(string?, out string)` — the
  same hostname normalizer bootstrap and `ExerciseResolutionMiddleware` use.
- The `Exercises.Hostname` unique-index lookup pattern (`BootstrapService.BootstrapAsync` step 3, read
  path only — this feature never writes an `Exercise` row).

**Schema — no migration needed:** `Pulse.WebApi.Data.PulseDbContext.Personas` +
`Pulse.WebApi.Data.Entities.Persona` already carry every field story 01 writes (`DisplayName`, `Handle`,
`Kind`, `Verified`, optional `PersonaTemplateId` — left `null`, no template library row this phase).

**Not applicable to this feature (no frontend, no participant surface):** COBRA/`styledComponents`, the
shared axios client, FontAwesome, React Query, the SignalR feed hook, a brand-theme provider — this
feature is backend-only and mounts nothing in `App.tsx`. Its output renders through surfaces that already
exist and already reuse all of the above.

## Wave Plan (DAG-ready)

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|----------------|------------|---------------|------|--------|
| 01 Persona cast seed | backend | `Pulse.WebApi/Features/Ops/EngineContentSeed/PersonaCastSeeder.cs` (+ xUnit) | `login/05` (a bootstrapped exercise to seed into); the existing `Persona` schema | 02 | 1 | S |
| 02 Starter storyline factory | backend | `Pulse.WebApi/Features/Ops/EngineContentSeed/StarterStorylineFactory.cs` (+ xUnit) | `storyline-model`'s `Storyline.Create`/`.Seed` (built, unmodified) | 01 | 1 | S |
| 03 Loop-registration seed endpoint | backend | `Pulse.WebApi/Features/Ops/EngineContentSeed/{EngineContentSeedEndpoints.cs, EngineContentSeedOptions.cs, EngineContentSeedService.cs, EngineContentSeedDtos.cs}` (+ xUnit) | 01 + 02 (composes both, data dependency — calls their exported functions); `engine-runtime` (`IReactionLoopRegistry`, `EngineAutonomyRegistry`); `login/05` (`BootstrapSecretGate`, `ExerciseHostName`) | — | 2 | M |

`Stack` (`backend`) tells the orchestrator to spawn a `backend-agent` and run the Gate-0 `dotnet build +
dotnet test` command (`ORCHESTRATION_MECHANICS.md §5`) — no frontend gate applies anywhere in this
feature.

**Wave 1 = the two file-disjoint, independently-testable seed primitives** (01 owns the `Persona`
write path; 02 owns the pure `Storyline` factory — no shared symbols, no shared file, so they fan out
together with no further analysis). **Wave 2 = 03**, which composes both by calling their exported
functions at runtime (a data dependency, not a file dependency) and adds the one new HTTP surface.

### Integration seam (orchestrator-owned — never a wave story)

| Seam | File(s) | Rule |
|------|---------|------|
| Backend composition root | `Pulse.WebApi/Program.cs` | `builder.Services.AddEngineContentSeed(builder.Configuration);` — placed **after** `AddReactionLoopHost()`/`AddEngineReview()` (depends on `IReactionLoopRegistry`; tolerant of order for `EngineAutonomyRegistry` via `TryAddSingleton`). `app.MapEngineContentSeedEndpoints();` — placed alongside `MapBootstrapEndpoints()`/`MapEngineRuntime()`/`MapEngineReview()`. One serial edit, between waves, orchestrator-only — no builder branch touches `Program.cs`. |

No frontend integration seam exists for this feature (no `App.tsx` edit — nothing here mounts a route or
a provider).

## Decisions & open questions (Tier-2 — flagged for confirmation before build)

- **(a) [DECIDED] A sibling ops endpoint, not an extension of bootstrap and not a controller-console
  button.** Bootstrap creates exercise *identity* (once, per hostname); this endpoint activates
  *content generation* (re-callable, e.g. after a restart empties the in-memory registry) — different
  blast radius and lifecycle warrant a separate endpoint under the same `Features/Ops/*` family. A
  cockpit "Start Engine" control is a good `console-shell`/`world-steering` follow-up once a controller
  role can legitimately trigger it, but is not required to meet this feature's success criterion and is
  explicitly deferred (see feature.md).
- **(b) [DECIDED] A fixed, hardcoded starter cast, not a request-body-driven or authoring-UI cast.**
  Minimal for Phase-1; `persona-management` remains the real templates/cast-authoring feature. A
  request-body-driven variant (caller supplies its own cast) is a plausible near-term enhancement but
  adds validation surface not needed to prove the end-to-end path — deferred.
- **(c) [DECIDED] An in-memory canned `Storyline`, not `DbSet<Storyline>` persistence.** Sufficient to
  drive the `Fake` provider end-to-end; persistence + a real authoring endpoint is real, deferred scope
  (a `storyline-model` follow-up). Accepted limitation: a restart or re-seed resets narrative progress
  (see feature.md). Flag if this trade-off is not acceptable for the target demo/pilot use.
- **(d) [DECIDED] No auto-repopulation of the registry on host startup.** Given (c), an auto-resume
  would just re-seed a fresh `Dormant` storyline anyway — no better than an operator re-calling this
  endpoint after a restart/redeploy. Worth revisiting only once storyline persistence exists.
- **(e) [DECIDED — reverted per user, 2026-07-24] Reuse `Authentication:Bootstrap:Secret`, NOT a dedicated
  secret.** A separate `Authentication:EngineSeed:Secret` was the initial call (independent blast
  radius/rotation), but it requires another bicep/workflow secret-threading round + infra redeploy; for a
  single-operator UAT pilot the user chose to reuse the existing bootstrap secret (same `X-Bootstrap-Secret`
  header, `BootstrapOptions`/`BootstrapSecretGate` reused verbatim, **no infra change**). Reversible later —
  see story 03 Context.
- **(f) [DECIDED] `responseWindowMinutes` defaults to 3 (demo-tuned), not the ~20-minute window used in
  illustrative engine-runtime tests.** Scenario time advances 1:1 with wall-clock (no acceleration
  multiplier exists anywhere in the codebase today), so a realistic 20-minute window means a 20-real-
  minute wait before the first review-queue item appears — poor for a "watch it happen" demo/pilot.
  Tunable per call via the request body if a slower, more "realistic" run is wanted.
- **(g) [SUPERSEDED] Bad-actor/impersonator personas excluded from the Phase-1 seed.** Originally: no
  scenario "enable bad actors" toggle was wired anywhere, so seeding a `Troll`/`Bot`-type persona with
  no way to disable it would ship content the platform cannot turn off — flagged as a
  `persona-management` + `world-steering` follow-up. **`profiles-social-graph/06` (#369) answered this
  differently: it seeds the SOC-052 lookalike and a low-credibility outlet as rows (`Castable =
  false`), so participants can browse them for training purposes while the engine's eligible cast and
  storyline participation stay filtered to `Castable` personas only.** The toggle now exists as a
  column; a live UI/surface to flip it per-scenario is still the `persona-management` +
  `world-steering` follow-up.

All seven are flagged in `feature.md`/each story's Context for confirmation before building; none blocks
authoring the stories, but (b)/(c) in particular change what "done" looks like for a demo audience and
are worth an explicit thumbs-up before a builder starts. (g) is resolved as described above.
