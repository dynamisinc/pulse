# Feature: Exercise configuration

**Epic:** E1 — Platform Core & Exercise Isolation  ·  **Phase:** 1  ·  **Feature ref:** F1.4
**World:** staff  ·  **Issue:** #41

## Summary
Per-exercise settings that shape the world: name/locale/time zone/schedule, enabled channels,
theming, the compliance chrome, the Build→…→Archived lifecycle, and a practice/sandbox flag that keeps
rehearsals out of evaluation exports.

## Requirements covered
COR-030, COR-031, COR-032, COR-033 (with NFR-008 leak protection for chrome/watermark, XC-003
compliance chrome, XC-008 time zone). Plus the **COR-005 participant-identity gap** (story 05 —
requirements decision, COMPONENTS.md divergence #5).

## Design references
D0 foundations (compliance chrome as environment chrome outside the app frame). Master decisions 4
(configurable chrome) and 9/13 (lifecycle, leak protection). **Session 3 (R-006):** the banner
chrome both mockups improvised is inventoried in `docs/design/COMPONENTS.md` and frozen pending the
**D7 unified shell**, and story 05 files the participant exercise-identity requirements gap
(divergence #5) as a D7 input. **The D7 shell has since shipped**, so banner presentation is no longer
this feature's concern at all: `docs/design/D7-application-shells/SHELL-CONTRACT.md` §1 is the normative
chrome contract (two 22px banners, text + colors config-driven, chrome-off a legal state) and
`participant-shell/01` built it. Story 02 is now config + guard only.

## Ground truth at Wave-0 refresh (2026-07-25)

This feature was decomposed when there was no backend. There is one now, and several pieces of what
these stories describe already exist. **Read this before building any story here.**

| Already exists | Where | What it means for this feature |
|---|---|---|
| The `Exercise` entity — `Id`, `Name`, `Hostname`, `BrandedDomain`, `TimeZone` (IANA, default `UTC`), `Status`, `CurrentScenarioTime` | `src/Pulse.WebApi/Data/Entities/Exercise.cs` | Story 01 is **extend + expose**, not invent. Name and time zone are already stored and already served. |
| `GET /api/exercise-context` serving the **frozen** `ExerciseScope { exerciseId, exerciseName, timeZone, status }` | `Features/ExerciseResolution/ExerciseScopeDto.cs` | `status` was frozen to `scheduled \| active \| complete \| archived` — a *different* vocabulary from COR-032's six. **Resolved: Option B (widen it), Tier-2 signed off** — see `03-exercise-lifecycle.md` and the literals in `implementation.md`. |
| Six participant-shell config GETs with **frozen** response DTOs, currently returning hardcoded constants | `Features/ParticipantShell/ParticipantShellEndpoints.cs` + `ParticipantShellDtos.cs` | The work in stories 01/02/03 is *replacing constants with per-exercise data behind the same wire shapes* — **no consumer change**. |
| The compliance-chrome **component** (`ComplianceChrome.tsx`) + its config seam (`chromeConfig.ts`) with the NFR-008 watermark-fallback signal | `src/frontend/src/features/participant-shell/` (`participant-shell/01`, Complete, #185) | Story 02 is **not** "build the chrome". It is "make the chrome config per-exercise, staff-editable, persisted, and guarded server-side". |
| `PulseDbContext` central exercise query filter, `IExerciseScoped`, `IExerciseContext`, `ExerciseScopeViolationException`, EF migrations | `src/Pulse.WebApi/Data/` | Isolation is enforced by the existing central filter — do not hand-roll scoping. |
| The staff planner surface | `src/frontend/src/features/planner/` (`AccountImport`, and since wave 2 `ExerciseSettingsPage` / `ExerciseSettingsPanel`) | The home for the staff settings editor (COBRA, staff world) — and now the mount point wave 3's panels compose into. |

## What waves 1 and 2 actually shipped (read before building a wave-3 story)

Slices **01a** and **01b** are **built, merged to this umbrella and green**. Story 01's `Status:` stays
**In Progress** because AC3's route-gating clause is deliberately unmet (see the open question below) —
"merged" is not "Complete" here. What a wave-3 builder now inherits, verified on disk:

| Shipped | Where | What it means for wave 3 |
|---|---|---|
| The feature's **one migration**, and every column stories 02/03/04 need | `Data/Migrations/20260725174714_ExerciseConfiguration.*`; `Data/Entities/Exercise.cs` (`ComplianceChromeEnabled`, `ChromeTop*`/`ChromeBottom*`, `WatermarkEnabled`, `IsPracticeMode`, the COR-030 settings columns, the widened `Status`) | **No wave-3 story authors a migration.** The columns are already there; layer behavior on them. |
| The `Features/ExerciseConfiguration/` slice: `ExerciseSettingsDtos/Service/Endpoints`, `ParticipantShellConfigService`, `ExerciseConfigurationExtensions` | `src/Pulse.WebApi/Features/ExerciseConfiguration/` | The slice folder exists; 02/03/04 add their own **sub-folders** (`Chrome/`, `Lifecycle/`, `PracticeMode/`) and open none of these files. |
| The three projection seams + their constant-preserving defaults, and the `ExerciseShellConfigSource` read model that already carries the chrome, watermark and brand columns | `ParticipantShellConfigService.cs` (`IChromeConfigProjection`, `IShellVariantProjection`, `IOverlayStateProjection`, `ExerciseShellConfigSource`) | Wave 3's contributors have a **real interface to implement** and a read model already populated with their inputs. `IsPracticeMode` is deliberately **absent** from the read model (XC-002 — staff-only, never handed to a participant projection). |
| **The composition root is wired.** `builder.Services.AddExerciseConfiguration()` and `app.MapExerciseConfigurationEndpoints()` are in `Program.cs`, guarded by `Features/ExerciseConfiguration/CompositionRootWiringTests` (three tests that boot the real host with no override and go red if either line is removed) | `src/Pulse.WebApi/Program.cs` | Wave-3 contributors export their own `Add*()` / `Map*()` and **do not edit `Program.cs`** — it stays orchestrator-owned, wired one line per story between waves. |
| **The planner route slot is filled.** `App.tsx` mounts `PlannerWorkspaceRoute` as `staffSurfaces.planner`; the slot was previously empty, so a planner session failed closed to `/login`. | `src/frontend/src/App.tsx`; `features/planner/pages/ExerciseSettingsPage.tsx` | `ExerciseSettingsPage` is the **composition point** wave 3's panels mount into (one JSX line each, added by the orchestrator). `App.tsx` and `features/planner/index.ts` remain **orchestrator-owned** — no wave-3 builder edits either. |
| Five of the six participant-shell config GETs now serve **per-exercise** data behind unchanged frozen wire shapes | `Features/ParticipantShell/ParticipantShellEndpoints.cs` → `ParticipantShellConfigService` | The constants→projection refactor is done; no wave-3 story re-opens that file. The sixth, `GET /api/alerts`, is still the empty-but-present Phase-1 list (controller-driven alerts are Phase 3) and keeps the scope check only — that is by design, not an omission. |
| The staff settings read/write pair | `GET`/`PUT /api/staff/exercise-settings` | It touches **none** of the chrome, watermark or practice columns, so stories 02 and 04 own their write paths outright — there is no second, competing writer to those columns and no way to bypass 02's NFR-008 guard through this endpoint. |

## Open questions (raised at the wave-2 Gate-2 review — recorded, NOT resolved here)

These are going to the human separately. None of them blocks a wave-3 dispatch; each needs an owner.

**(a) Staff *writes* are not role-scoped.** `ExerciseSettingsEndpoints` gates both verbs with
`EngineCockpitStaffAuthorizationFilter`, which verifies a live **staff-kind** session and an explicit
`StaffAssignment` to the server-resolved exercise — but **never inspects the staff role**, even though
the assignment it reads carries one. So an `evaluator` session can `PUT /api/staff/exercise-settings`
and rewrite the brand, the time zone and the enabled channels. Evidence and bounds: the **client** gate
is correct (`features/app-shell/RoleAwareEntry.tsx` routes only `planner` to the surface), so the
exposure is **API-direct only**; this matches the shipped precedent for every other `/api/staff/...`
endpoint; and story 01's AC5 is written as a staff-session + assignment gate, which the code satisfies
as written. **Open question:** should staff *writes* be role-scoped (planner-only for configuration,
Director-only for lifecycle transitions), and which story owns that hardening — a new story in
`identity-auth-roles`, or an AC added to each writing story? Not decided here.

**(b) `AccountImport` is orphaned.** Built and tested for planners
(`identity-auth-roles/02`, COR-011) and exported from `features/planner/index.ts`, but **mounted
nowhere** — verified by grep across `src/frontend/src` (the only hits outside the planner folder are two
comments). This was excusable while no planner surface existed; it no longer is, because
`PlannerWorkspaceRoute` now exists and mounts **only** `ExerciseSettingsPage`, whose documented
composition points are story 02's and story 04's panels. **Open question:** where does account import
live — a third panel on the settings page, a sibling planner route, or a tab? It is not this feature's
requirement, so no wave-3 story should absorb it opportunistically. Not decided here.

**(c) Channel-enablement route gating is unowned.** Already recorded in
[`01-per-exercise-settings.md`](01-per-exercise-settings.md) → "Known gap: channel-enablement route
gating", and surfaced here so it is visible at feature level: story 01's **AC3 remains deliberately
unticked**. A planner can disable `social`, and `GET /api/channel-nav-config` correctly reports it
`enabled: false` (the nav strip drops it) while `/api/feed`, `/api/threads/{id}` and `POST /api/posts`
keep serving. Story 03's lifecycle gating does **not** close it — lifecycle state and channel
enablement are orthogonal axes. **Open question:** who owns the participant-route filter that reads the
enabled set — a shared filter here, or a per-epic obligation on each channel epic (E3–E6)? Until it has
an owner, read "disabled channel" as *hidden from the nav*, never *unreachable*.

**Frozen-contract rule for this feature:** `ExerciseScopeDto` and the six `ParticipantShellDtos` wire
shapes are frozen. A story here fills them with real per-exercise data; it does not reshape them. Any
change to those shapes is a **schema/contract change → Tier-2 human sign-off**
(`docs/ORCHESTRATION_MECHANICS.md` §3). **One such change has been signed off:** the
`ExerciseScope.status` vocabulary is widened to COR-032's six lifecycle states (Option B — see
`03-exercise-lifecycle.md`; authoritative literals in `implementation.md`). No other reshaping is
sanctioned.

**Single-migration rule:** stories 01, 02, 03 and 04 all need `Exercises`-table columns. Two parallel
builders each scaffolding an EF migration corrupt the model snapshot, so **all** schema work for this
feature — the COR-030 settings columns, the chrome config, the **watermark on/off flag**, the practice
flag, and the `Status` vocabulary widening — is authored once, by one builder, in wave 1
(`implementation.md` story slice **01a**). Later stories layer behavior on columns that already exist.

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Per-exercise settings (locale, TZ, channels, theming) — *extends the existing `Exercise` entity; owns the feature's one migration* | COR-030 | **In Progress** — slices 01a + 01b built, merged and wired; AC3's route-gating clause is unmet by design (open question **c**) | #67 |
| 02 | Compliance chrome — *per-exercise config + server-side NFR-008 guard (the banner component already ships)* | COR-031 | Not Started | #68 |
| 03 | Exercise lifecycle state machine — *Tier-2 signed off; the vocabulary widening ships in 01a, this story is behavior only* | COR-032 | Not Started | #69 |
| 04 | Practice/sandbox flag | COR-033 | Not Started | #70 |
| 05 | Participant-visible exercise identity *(requirements decision, no code — excluded from the Wave Plan)* | COR-005 gap / R-006, COMPONENTS.md #5 | Not Started | #180 |

## Dependencies
The `Exercise` entity and the `PulseDbContext` central query filter **already exist** (`exercise-isolation`
stories 01/08, merged) — this feature extends them. The exercise clock (`exercise-clock`) consumes the
time zone; build/go-live (`exercise-build-golive`) drives the lifecycle transitions story 03 defines.
Story 02 consumes the shipped `participant-shell/01` chrome component and its `chromeConfig.ts` seam.
The staff editor mounts into the existing `features/planner/` staff surface.

**In-flight collision (known + accepted):** the unmerged `feature/world-steering-wave2` umbrella rewrites
the `/api/overlay-state` handler in `Features/ParticipantShell/ParticipantShellEndpoints.cs` (a real
write path with SignalR push) and edits `Program.cs`. The human has decided to **proceed on all waves
and resolve it at merge time** rather than sequence around it — see `implementation.md` → "Integration
hazards".

## Design notes
Staff world. Compliance chrome renders as persistent environment chrome **outside** the simulated app
frame, consistently on every channel (XC-003) — and can be disabled per exercise, but **never**
simultaneously with in-content watermarks off (NFR-008). Single time zone per exercise is a known,
accepted launch constraint (XC-008, open question 4).
