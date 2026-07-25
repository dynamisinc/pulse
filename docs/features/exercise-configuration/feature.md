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
| `GET /api/exercise-context` serving the **frozen** `ExerciseScope { exerciseId, exerciseName, timeZone, status }` | `Features/ExerciseResolution/ExerciseScopeDto.cs` | `status` on this wire shape is frozen to `scheduled \| active \| complete \| archived` — a *different* vocabulary from COR-032's six lifecycle states. See the hazard section in `03-exercise-lifecycle.md`. |
| Six participant-shell config GETs with **frozen** response DTOs, currently returning hardcoded constants | `Features/ParticipantShell/ParticipantShellEndpoints.cs` + `ParticipantShellDtos.cs` | The work in stories 01/02/03 is *replacing constants with per-exercise data behind the same wire shapes* — **no consumer change**. |
| The compliance-chrome **component** (`ComplianceChrome.tsx`) + its config seam (`chromeConfig.ts`) with the NFR-008 watermark-fallback signal | `src/frontend/src/features/participant-shell/` (`participant-shell/01`, Complete, #185) | Story 02 is **not** "build the chrome". It is "make the chrome config per-exercise, staff-editable, persisted, and guarded server-side". |
| `PulseDbContext` central exercise query filter, `IExerciseScoped`, `IExerciseContext`, `ExerciseScopeViolationException`, EF migrations | `src/Pulse.WebApi/Data/` | Isolation is enforced by the existing central filter — do not hand-roll scoping. |
| The staff planner surface | `src/frontend/src/features/planner/` (today: `AccountImport`) | The right home for the staff settings editor (COBRA, staff world). |

**Frozen-contract rule for this feature:** `ExerciseScopeDto` and the six `ParticipantShellDtos` wire
shapes are frozen. A story here fills them with real per-exercise data; it does not reshape them. Any
change to those shapes — or to the `ExerciseScope.status` vocabulary — is a **schema/contract change →
Tier-2 human sign-off** (`docs/ORCHESTRATION_MECHANICS.md` §3).

**Single-migration rule:** stories 01, 03 and 04 all add columns to the `Exercises` table. Two parallel
builders each scaffolding an EF migration corrupt the model snapshot, so **all** schema work for this
feature is authored once, by one builder, in wave 1 (`implementation.md` story slice **01a**). Later
stories layer behavior on columns that already exist.

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Per-exercise settings (locale, TZ, channels, theming) — *extends the existing `Exercise` entity; owns the feature's one migration* | COR-030 | Not Started | #67 |
| 02 | Compliance chrome — *per-exercise config + server-side NFR-008 guard (the banner component already ships)* | COR-031 | Not Started | #68 |
| 03 | Exercise lifecycle state machine — **Tier-2: reconciles COR-032 against the frozen `status` vocabulary** | COR-032 | Not Started | #69 |
| 04 | Practice/sandbox flag | COR-033 | Not Started | #70 |
| 05 | Participant-visible exercise identity *(requirements decision, no code — excluded from the Wave Plan)* | COR-005 gap / R-006, COMPONENTS.md #5 | Not Started | #180 |

## Dependencies
The `Exercise` entity and the `PulseDbContext` central query filter **already exist** (`exercise-isolation`
stories 01/08, merged) — this feature extends them. The exercise clock (`exercise-clock`) consumes the
time zone; build/go-live (`exercise-build-golive`) drives the lifecycle transitions story 03 defines.
Story 02 consumes the shipped `participant-shell/01` chrome component and its `chromeConfig.ts` seam.
The staff editor mounts into the existing `features/planner/` staff surface.

**In-flight collision:** the unmerged `feature/world-steering-wave2` umbrella rewrites
`Features/ParticipantShell/ParticipantShellEndpoints.cs` (turning `/api/overlay-state` into a real write
path with SignalR push) and edits `Program.cs`. Stories 01 and 03 want the same file — see
`implementation.md` → "Integration hazards".

## Design notes
Staff world. Compliance chrome renders as persistent environment chrome **outside** the simulated app
frame, consistently on every channel (XC-003) — and can be disabled per exercise, but **never**
simultaneously with in-content watermarks off (NFR-008). Single time zone per exercise is a known,
accepted launch constraint (XC-008, open question 4).
