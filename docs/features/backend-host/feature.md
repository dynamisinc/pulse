# Feature: Backend host & persistence foundation

**Epic:** E1 — Platform Core & Exercise Isolation  ·  **Phase:** 1  ·  **Feature ref:** `docs/BACKEND_ROADMAP.md` §4 Phase B0 (COR domain model §3.1; infrastructure substrate — no single epic `F#.#` section owns it)
**World:** platform/foundation (backend/infra — no UI, no participant skin, no COBRA)  ·  **Issue:** #266

## Summary
The genuinely net-new middle tier. Today Pulse is "two well-built halves with no middle"
(`docs/BACKEND_ROADMAP.md` §1): a feature-rich frontend that fails closed to mock data, and a mature but
unhosted `Pulse.Core` engine ("a library island... there is no runtime yet"). This feature stands up the
first real ASP.NET Core host (`Pulse.WebApi`) — booting the already-built engine DI
(`AddEngineGeneration`) for the first time — and `PulseDbContext`, the first durable, exercise-scoped
persistence in the product. Everything else in the Backend Roadmap (the isolation query filter, the
telemetry sink, and eventually the social/identity/engine-runtime backends) is hosted here or persists
through here; nothing consumer-facing is safe to build until these two stories land.

## Requirements covered
No requirement ID directly — this is the load-bearing infrastructure substrate `docs/BACKEND_ROADMAP.md`
§4 names as Phase B0, cited there against "§6 tech context" and "COR domain model" rather than a specific
ID. It **unblocks** delivery of: COR-001/002/007 (exercise isolation, realized in real SQL by
`exercise-isolation/01-exercise-scoped-queries` on top of this feature's `PulseDbContext`), XC-004
(durable telemetry storage, realized by `telemetry/02-telemetry-sink-backend`), COR-050 (the native
exercise clock's eventual backend service), and NFR-006 (Azure hosting posture — this is the first
application code to actually run on the authored-but-gated `webapp.bicep`/`database.bicep`).

## Design references
None — a backend/infrastructure surface with no participant or staff UI, so no `docs/design/` brief
applies. Source of the plan: `docs/BACKEND_ROADMAP.md` §3 (strategy/principles) and §4 Phase B0 (the
story table this feature formalizes — its slugs are indicative, this feature's structure is
authoritative); `docs/FEATURE_ORCHESTRATION_PLAYBOOK.md` and `docs/ORCHESTRATION_MECHANICS.md` (the Wave
Plan / composition-root / gate contracts this feature's `implementation.md` follows).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | WebApi host bootstrap (composition root, health, CORS, App Insights) | none directly — unblocks COR-001/050, XC-004, NFR-006 | Not Started | #268 |
| 02 | Persistence: `PulseDbContext` + EF Core walking-skeleton entities | COR-001 (schema precondition), XC-004 (durable event store), COR domain model §3.1 (partial) | Not Started | #269 |

## Dependencies
None upstream — this is Phase B0, the serial prerequisite for the rest of the Backend Roadmap. Reuses the
already-built `Pulse.Core` engine DI (`ServiceCollectionExtensions.AddEngineGeneration`, unmodified) and
the authored-but-gated-off `infrastructure/modules/{webapp,database,appinsights}.bicep`. Blocks, as a
serial cross-feature edge (not a fan-out): `exercise-isolation/01-exercise-scoped-queries` (extends this
feature's `PulseDbContext`) and `telemetry/02-telemetry-sink-backend` (writes through this feature's
`DbSet<TelemetryEvent>`) — both are Not Started and both wait on story 02.

## Design notes
**No UI in either world.** This feature cannot blur participant/staff chrome because it renders no chrome
at all — it is a headless ASP.NET Core Web API + EF Core layer. The two-worlds discipline instead applies
to what gets built *on top of* it: a future participant endpoint must still never leak cross-exercise
data; a future staff endpoint must still require staff auth once identity lands (Phase B2).

**Serial, not fan-out (`docs/BACKEND_ROADMAP.md` §7.2).** Phase B0 is a hand-driven dependency line — host
(01) → persistence (02) — built and Gate-1/Gate-2 reviewed in order, not a parallel Workflow fan-out.
Story 02 is the highest-fan-out seam this feature produces: two Phase-B0 stories in *other* features
depend on it next (the isolation filter, the telemetry sink) — see each feature's own
`implementation.md` for how that cross-feature edge is sequenced.

**Composition-root discipline starts here.** `src/Pulse.WebApi/Program.cs` is created by story 01 (solo,
Wave 1, no parallel-merge risk) and from story 02 onward becomes the same kind of orchestrator-owned
integration seam `src/frontend/src/App.tsx` already is: a later story exports an `Add{X}()`/`Map{X}()`
extension method in its own file, and the orchestrator adds the one-line call into `Program.cs` between
waves, serially. See `implementation.md`'s Integration seam table.

**Seed v0, reserve extension fields (`docs/BACKEND_ROADMAP.md` Risk 1).** `PulseDbContext` is the
highest schema-churn-risk seam in the backend, mirroring the frontend's own `XC-004` experience (churned
most *after* its v0 lock, per `docs/FEATURE_ORCHESTRATION_PLAYBOOK.md`). Story 02 seeds the
walking-skeleton entity set only and explicitly reserves known future extension points (rumor/mutation
columns on `Post`, soft delete everywhere per XC-010) rather than treating this migration as final — a
hardening pass is expected after the first consumer wave (Phase B1), not assumed away.
