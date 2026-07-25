# Feature: Engine content seed / drive path

**Epic:** E8 — Adaptive Content Engine  ·  **Phase:** 2  ·  **Feature ref:** E8 arch §1.1/§1.2/§2/§14 —
continues `docs/BACKEND_ROADMAP.md` Phase B3 (`engine-runtime`)
**World:** backend, ops-only (no participant or staff-session surface of its own — the surfaces it
activates, the reaction loop + review cockpit + participant feed, already exist and are unchanged)
**Issue:** #324 (parent)

## Summary
The last unbuilt seam of the engine backend: **nothing in production ever registers an exercise with
the reaction loop**, so every exercise's social feed stays empty even though the whole engine
(`engine-runtime`, `storyline-model`, `persona-voice-engine`, `autonomy-safety`,
`engine-generation-infra`) is built and `Complete`. `ReactionLoopHost` only ticks exercises present in
`IReactionLoopRegistry.Active`, and `IReactionLoopRegistry.Register(...)` is called **only in tests**
today — the host's own doc comment calls the populating path "a later story" (`ReactionLoopHost.cs:44-47`).
This feature is that story: a secret-gated ops seam that, for an already-**bootstrapped** exercise
(`login/05`'s `POST /api/ops/bootstrap-exercise` — Exercise + staff/participant Accounts +
SharedCredential, nothing else), seeds the minimum viable `Persona` rows the publish path needs
(story 01), constructs one canned starter storyline in memory (story 02), and registers the loop
(story 03) — so the already-shipped, offline `Fake` generation provider starts producing canned
bursts a controller can watch arrive in the review queue, approve, and see land in `GET /api/feed`.
**No live AI endpoint is required or touched.**

This is connective tissue, in the same sense `engine-runtime` describes itself: the mature engine
sub-systems are reused verbatim (`Storyline.Create`/`.Seed`, `PersonaDossier`/`PersonaType`,
`IReactionLoopRegistry`, `EngineAutonomyRegistry`, the guard-before-human generate/publish/measure
pipeline) — nothing here changes engine logic, only feeds it real seed data and flips it on for one
exercise at a time.

## Requirements covered
No single epic requirement ID names this gap (it was surfaced by code-level adversarial review, issue
#324) — following `engine-runtime`'s own precedent for connective/infra stories, this feature cites the
**E8 architecture** sections directly:
- **E8 arch §1.1** — "Storylines are created by planners (pre-seeded) or controllers (ad hoc)" — the
  basis for a canned, pre-seeded starter storyline (story 02).
- **E8 arch §1.2 / §2** — the reaction loop + system shape — the basis for the registration seam
  (story 03), which is exactly the gap `ReactionLoopHost.cs`'s own doc flags as unbuilt.
- **E8 arch §14** — feature decomposition (the input this backlog itself is derived from).

Cross-cutting: **COR-001/XC-001** (isolation — every seeded row + the registration itself is
exercise-scoped), **NFR-009** (secret-gated ops surface, mirroring `BootstrapOptions`), **XC-004**
(one audit event per successful seed call, mirroring `exercise.bootstrapped`), **NFR-004** (the seeded
persona text runs through the same sanitization funnel real persona-authored text would use).

**Explicitly NOT claimed:** COR-020/COR-021 (persona template authoring + one-action cast seeding from
a planner-facing library) — that is `persona-management`'s feature, still `In Progress`. This feature's
persona seed is a narrow, fixed, engine-scoped stopgap so the publish path has real `Persona` rows to
resolve handles against; it is not the COR-021 authoring/library experience and should not be read as
satisfying it. See Design notes.

## Design references
No dedicated design brief exists for this seam (mirrors `engine-runtime`'s own "no design brief — this
is a backend connective feature" framing). The canonical design is
`docs/design/E8-ENGINE-ARCHITECTURE.md` §1.1 (storyline creation), §1.2 (the reaction loop), §2 (system
shape), §14 (feature decomposition). No `STORY-UPDATES.md` amendment targets this seam directly, but
story 03 **inherits** D5-014/1.1 (auto-HOLD, never auto-send) by sourcing the registration's autonomy
state from the same `EngineAutonomyRegistry` the cockpit's auto-HOLD/kill-switch/swamped-mode already
honor — it does not re-decide that behavior, only wires into it correctly (see story 03 AC3, the
load-bearing correctness point).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Persona cast seed — the engine's minimum viable cast `[backend]` | E8 arch §5/§14 (narrow, engine-scoped; not COR-020/021) | Complete | #325 |
| 02 | Starter storyline factory — one canned, in-memory storyline `[backend]` | E8 arch §1.1/§6.1 | Complete | #326 |
| 03 | Loop-registration seed endpoint — `POST /api/ops/seed-engine-content` `[backend]` `[TIER-2]` | E8 arch §1.2/§2/§14, NFR-009 (COR-001, XC-004) | Complete | #327 |

## Dependencies
**Delivered, reused unchanged:** `engine-runtime` (Complete — `ReactionLoopHost`,
`IReactionLoopRegistry`/`ReactionLoopRegistration`/`EnginePersona`, `EnginePublishService`,
`EngineReviewService`/`EngineAutonomyRegistry`/`EngineReviewTickHost`, `IExerciseClock`); the built
engine sub-systems (`storyline-model`'s `Storyline.Create`/`.Seed`, `persona-voice-engine`'s
`PersonaDossier`/`PersonaStyle`/`PersonaType` + `BurstAcceptancePolicy`, `engine-generation-infra`'s
`FakeGenerationProvider` — already the configured default, `autonomy-safety`'s `EngineAutonomyState`);
`login/05` (`BootstrapService` — the exercise this feature seeds into must already exist;
`BootstrapSecretGate.IsAuthorized` — reused verbatim, not forked; `ExerciseHostName.TryNormalize` —
reused for hostname resolution); the `Persona` `DbSet` + entity (`social-api`/B0 schema — no migration
needed, all fields this feature writes already exist).

**Consumed, not modified:** the existing publish funnel (`EnginePublishService.PublishBurstAsync` →
`PostIngestService.IngestAsync(origin:'engine')` → `Post` + SignalR → `GET /api/feed`) and the existing
review-queue endpoints (`POST /api/engine/review/{id}/{approve,edit,veto,reroll}`) — this feature's
success criterion is proven entirely by exercising those *unmodified* paths against freshly seeded data.

## Design notes

**Two worlds.** Backend, ops-only — reachable only by a caller holding a deployment-configured secret,
not even a staff session (mirrors `login/05`'s bootstrap seam exactly: "no participant- or
staff-session gate — the secret header *is* the gate, by design"). It has no UI of its own. Its
*output* — the personas and posts it causes to exist — renders on the existing participant social feed
(brand-skinned, unchanged) and the existing staff review cockpit (COBRA, unchanged); this feature adds
no new rendering surface to either world, so there is nothing here to check against the no-enterprise-
look or accessibility non-negotiables directly (both remain the responsibility of the surfaces that
already render this data).

**The shared-instance correctness point (load-bearing).** `EngineAutonomyState` is a mutable class, not
a value type. `EngineReviewService`/`EngineReviewTickHost` read and mutate the *per-exercise* instance
held in the DI-singleton `EngineAutonomyRegistry` (`GetOrCreate(exerciseId)`) for auto-HOLD, kill-switch,
and swamped-mode. A `ReactionLoopRegistration.Autonomy` built from a **fresh, detached**
`EngineAutonomyState.Create(exerciseId)` (as the `engine-runtime` test harness does, deliberately, for
isolated unit tests) would silently desynchronize the loop's routing from the cockpit's safety controls
in production — a kill switch flipped in the console would never actually stop the loop, because the
loop would be reading a *different* object. Story 03 must resolve `Autonomy` from
`EngineAutonomyRegistry.GetOrCreate(exerciseId)`, the exact singleton the cockpit reads/writes. This is
called out explicitly in story 03's ACs and is the single most important correctness detail in this
feature.

**Storyline persistence — deliberately deferred (Tier-2, flagged).** `Storyline` has no `DbSet` and no
authoring endpoint; this feature does not add either. Story 02 constructs one canned storyline
**in memory**, fresh, every time the seed endpoint runs. Accepted Phase-1 limitation: a host restart
(the registry is in-memory) or a deliberate re-seed call discards whatever intensity/phase progress had
accrued and restarts the arc at `Dormant → Seeded`, minute 0. Building durable storyline persistence +
a real authoring endpoint is real, deferred scope — track it as a `storyline-model` follow-up (a
`DbSet<Storyline>` + author endpoint) once Phase-2 planning revisits it; it is not worth half-building
here (an auto-resume-on-restart without durable state would just restart a fresh storyline anyway, no
better than the operator re-calling this endpoint).

**Registration lifecycle after a restart.** Because `IReactionLoopRegistry` is in-memory, an app
restart/redeploy silently empties it and the feed stops generating new content (existing posts are
unaffected). This feature does **not** add an auto-resume-on-startup hosted service — see the Tier-2
decision list below. The operational answer for Phase-1 is: re-call
`POST /api/ops/seed-engine-content` after any restart (the same runbook step that already re-runs
`POST /api/ops/bootstrap-exercise` if needed).

**Bad-actor / impersonator personas — excluded this pass.** The shipped frontend org-library mock
(`personaTemplates.ts`) includes a SOC-052 impersonation-training pair (`@FairhavenWater` verified vs.
`@FairhavenWaterUpd` unverified lookalike) and a low-credibility "influencer" persona. This feature's
starter cast deliberately **excludes** the impersonator and influencer/troll-type personas: seeding a
`Troll`/`Bot`-type persona into an active storyline without a real scenario "enable bad actors" toggle
(not built anywhere yet — `persona-voice-engine`'s bad-actor gating exists as a pure domain service but
is not currently invoked by `ReactionLoopDriver`) would be seeding content the platform has no way to
turn off. Flagged as a `persona-management` + `world-steering` follow-up once that toggle exists, not
built here.

**Naming disambiguation (like `login`'s COR-030 note).** "Persona seeding" here is narrower than
`persona-management/02`'s COR-021 ("Casts & one-action seeding with derived state"): that story is the
planner-facing library → named-cast → one-action-seed experience with believable derived state (varied
follower counts, join dates). This feature's story 01 is a fixed, hardcoded, engine-scoped stopgap with
no UI and no template library — enough for the engine to function, not a claim on COR-021. Do not read
story 01's completion as satisfying persona-management's backlog.
