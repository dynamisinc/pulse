# Implementation: Exercise configuration

> Staff-world settings that shape the world; the lifecycle state machine other features subscribe to.
> Compliance chrome is participant-world framing served from staff-owned config.
>
> **The backend exists.** `src/Pulse.WebApi` is a live .NET minimal-API host with feature slices
> (`EngineRuntime, ExerciseResolution, Identity, Ops, ParticipantShell, Realtime, Social`), a
> `PulseDbContext` with the central exercise query filter, `IExerciseScoped` / `IExerciseContext` /
> `ExerciseScopeViolationException`, and EF migrations under `Data/Migrations/`. This feature **extends**
> that, it does not bootstrap it.
>
> **Two contracts are already frozen and are filled, never reshaped, by this feature:**
> `Features/ExerciseResolution/ExerciseScopeDto.cs` (`GET /api/exercise-context`) and the six
> `Features/ParticipantShell/ParticipantShellDtos.cs` shapes. Most of the backend job here is
> *replacing hardcoded constants with per-exercise data behind the same wire shapes* — so no frontend
> consumer and no runtime type-guard changes.
>
> **The one sanctioned exception (Tier-2 signed off):** `ExerciseScope.status`'s *vocabulary* widens to
> COR-032's six lifecycle states (Option B — `03-exercise-lifecycle.md`). The **shape** is still frozen;
> only the accepted string set changes, and the client guard is widened first. See "Lifecycle string
> literals" and "Client-first ordering" below.

## Per-story tech notes

| Story | Stack | Approach | Key files (owns) | Exports / seams (that others import) |
|-------|-------|----------|------------------|--------------------------------------|
| **01a** Settings schema + vocabulary widening | **fullstack** | The feature's **only** schema change. Extends the existing `Exercise` entity with the COR-030 settings columns, the **chrome config**, the **watermark on/off flag** (so 02's NFR-008 guard reads real state) and the **practice/sandbox flag**, in one EF migration — *and* carries story 03's **Option B vocabulary widening**: the `Status` column + data migration, `PulseDbContext`'s default, `BootstrapService`'s seed, and the **additive frontend guard widening that must ship first** (see "Lifecycle string literals" + "Client-first ordering"). | `Data/Entities/Exercise.cs`; `Data/PulseDbContext.cs` (the `Exercise` `OnModelCreating` block only); `Data/Migrations/<ts>_ExerciseConfiguration.*` + `PulseDbContextModelSnapshot.cs`; `Features/Ops/Bootstrap/BootstrapService.cs` (seed literal only); `Features/ExerciseResolution/ExerciseScopeDto.cs` (doc/pass-through only); `core/exerciseContext/exerciseContextResolver.ts` (`ExerciseStatus` union + `EXERCISE_STATUSES` + `isExerciseStatus`) | The extended `Exercise` entity + **the COR-032 status vocabulary** — every other story in this feature reads/writes these columns and authors **no** migration |
| **01b** Settings — API + shell-config service + staff editor | **fullstack** | New `Features/ExerciseConfiguration/` slice: staff read/write of the COR-030 settings, plus the **constants → per-exercise projection refactor** of the six participant-shell handlers. Staff editor in the existing COBRA `features/planner/` surface. | `Features/ExerciseConfiguration/{ExerciseSettingsDtos,ExerciseSettingsService,ExerciseSettingsEndpoints,ParticipantShellConfigService,ExerciseConfigurationExtensions}.cs`; `Features/ParticipantShell/ParticipantShellEndpoints.cs` (**refactor — serialized file, see hazards**); `features/planner/pages/ExerciseSettingsPage.tsx`, `features/planner/components/ExerciseSettingsPanel.tsx`, `features/planner/hooks/useExerciseSettings.ts`, `features/planner/services/exerciseSettingsService.ts` | `AddExerciseConfiguration()` / `MapExerciseConfigurationEndpoints()`; **`ParticipantShellConfigService`** plus the **per-concern projection interfaces** it resolves from DI (`IChromeConfigProjection`, `IShellVariantProjection`, `IOverlayStateProjection`) with constant-preserving defaults — this is what lets 02 and 03 contribute in their **own** files and run in the same wave; `GET/PUT /api/staff/exercise-settings`; `ExerciseSettingsPage` (the panel host) |
| **02** Compliance chrome — per-exercise config + NFR-008 guard | **fullstack** | The banner component already ships (`participant-shell/01`). This adds the per-exercise chrome config, the **server-side** chrome↔watermark mutual guard, and the staff panel; it serves through the unchanged frozen `ChromeConfigResponse`. | `Features/ExerciseConfiguration/Chrome/{ChromeConfigProjection,ComplianceChromeGuard,ChromeSettingsEndpoints,ChromeExtensions}.cs`; `features/planner/components/ComplianceChromePanel.tsx`, `features/planner/hooks/useChromeSettings.ts`, `features/planner/services/chromeSettingsService.ts` | `IChromeConfigProjection` impl (resolved by `ParticipantShellConfigService`); `ComplianceChromeGuard` (the NFR-008 invariant, one place); `AddComplianceChromeConfig()` |
| **03** Lifecycle **[Tier-2 — sign-off given]** | backend | COR-032's six states + allowed transitions (409 on disallowed), participant gating (Staged/Live only), the Paused holding page, and XC-004 transition telemetry — layered onto the vocabulary 01a already shipped. **Authors no schema and no migration.** Supplies the shell-variant + overlay-state projections behind 01b's seam. | `Features/ExerciseConfiguration/Lifecycle/{ExerciseLifecycleState,ExerciseLifecycleService,LifecycleProjection,LifecycleEndpoints,LifecycleExtensions}.cs` | `ExerciseLifecycleService` — the single lifecycle read other features subscribe to (build/go-live, clock, engine); `AddExerciseLifecycle()`; the shell-variant + overlay-state projection implementations |
| **04** Practice flag | **fullstack** | Behavior only (the column ships in 01a): set/read the flag and publish the one evaluation-eligibility seam E10 will filter on, plus the staff indicator (icon + text, never color-only). | `Features/ExerciseConfiguration/PracticeMode/{PracticeModeService,PracticeModeEndpoints,PracticeModeExtensions}.cs`; `features/planner/components/PracticeModePanel.tsx`, `features/planner/hooks/usePracticeMode.ts`, `features/planner/services/practiceModeService.ts` | `IEvaluationEligibility` (the single read E10's export filtering consumes); `PracticeModePanel` |
| **05** Participant exercise identity | *none — requirements decision, no code* | Resolves COMPONENTS.md divergence #5; the outcome lands in story 02's chrome **content** and the D7 shell. **Explicitly excluded from the Wave Plan** — never dispatched to a builder, never in a fan-out. | — | the decision (a D7 input) |

### Lifecycle string literals (authoritative — every builder uses these exact strings)

The COR-032 reconciliation is decided: **Option B — widen the frozen vocabulary. Tier-2 human sign-off
given.** The rationale is recorded in `03-exercise-lifecycle.md`; it is no longer an orchestration gate,
and the widening ships in **01a's single migration**, not story 03's wave.

The stored `Exercise.Status` / wire `ExerciseScope.status` vocabulary is, verbatim:

```
build | staged | live | paused | completed | archived
```

Lowercase single tokens, matching the existing convention. Note **`completed`**, not the legacy
`complete` — COR-032 names the state "Completed (EndEx)" and this is the deliberate spelling. Do not
coin `Build`, `in_progress`, `ended` or any other variant anywhere in the stack.

**Legacy → new mapping** for 01a's data migration (existing rows only ever carry `scheduled`, the
`HasDefaultValue`, or `active`, the `BootstrapService` seed):

| Legacy | New | Why |
|---|---|---|
| `scheduled` | `build` | an exercise created and never configured is still in staff-only content development |
| `active` | `live` | the bootstrap seed marks a running exercise; StartEx has effectively occurred |
| `complete` | `completed` | spelling change only |
| `archived` | `archived` | unchanged |

### Client-first ordering (the split-deploy guard)

UAT is a split deployment (Azure SWA frontend + App Service backend) whose halves deploy independently,
and `isExerciseStatus` **fails closed on unknown values** — a backend-ahead deploy blanks the participant
world rather than erroring. So 01a's frontend change is **purely additive and ships first**:
`EXERCISE_STATUSES` / `isExerciseStatus` / the `ExerciseStatus` union accept the **transitional superset**
(both vocabularies, ten literals) before any backend emits a new value, and the frontend is deployed **no
later than** the backend.

Keeping the legacy four valid through the transition is also what keeps wave 1's diff small: `'active'`
is a fixture literal in ~25 frontend test files and a dozen backend tests. **Retiring the legacy four is
a documented follow-up**, taken once no deployed client or database row carries them — not part of this
feature.

## Reuse map

Build on these; do not recreate any of them.

- **Backend (real C# in `src/Pulse.WebApi/`, merged):**
  - `Data/Entities/Exercise.cs` — the aggregate root. Already carries `Name`, `TimeZone` (IANA, default
    `UTC`), `Hostname` / `BrandedDomain`, `Status`, `CurrentScenarioTime`. **Extend it; do not add a
    parallel settings entity.**
  - `Data/PulseDbContext.cs` — the central exercise query filter + write-time scope guard, and the
    `Exercise` model configuration (`Status` `HasDefaultValue("scheduled")`). New scoped entities extend
    this context; never stand up a second `DbContext`.
  - `Data/IExerciseContext.cs` / `ExerciseContext.cs` — the server-resolved scope. **The only source of
    "which exercise"**; never a client-supplied parameter (COR-001). `Data/IExerciseScoped.cs` +
    `ExerciseScopeViolationException.cs` complete the isolation seam.
  - `Features/ExerciseResolution/ExerciseScopeDto.cs` — **frozen** `GET /api/exercise-context` shape;
    `FromExercise` is the existing projection; its **shape** stays frozen while story 01a widens the
    `status` vocabulary flowing through it (Option B, Tier-2 signed off).
  - `Features/ParticipantShell/ParticipantShellDtos.cs` — **frozen** wire shapes for all six config
    GETs. Fill them, never reshape them.
  - `Features/ParticipantShell/ParticipantShellEndpoints.cs` — the six handlers, today returning
    `static readonly` constants and failing closed (401) on an unresolved scope. Story 01b converts the
    constants to a per-exercise service; **keep the fail-closed behavior**.
  - `Features/Identity/Staff/*` + `Features/EngineRuntime/EngineCockpitStaffAuthorizationFilter.cs` —
    the staff-session gate pattern every `/api/staff/...` endpoint in this feature reuses (XC-002).
  - `Features/Social/FeedEndpoints.cs` — the canonical minimal-API slice shape (`AddX()` / `MapX()`
    extensions, `*Service`, DTOs) this feature's new slice mirrors.
  - `Data/Entities/TelemetryEvent.cs` + `TelemetryEnvelopeRules.cs`, `Telemetry/TelemetryController.cs`,
    `Features/EngineRuntime/Telemetry/IEngineTelemetryEmitter.cs` — the XC-004 v0 envelope + sink story
    03's lifecycle-transition events emit against.
  - `Features/Ops/Bootstrap/BootstrapService.cs` — creates the first `Exercise` (`Status = "active"`,
    normalized `TimeZone`). A vocabulary or required-column change must keep bootstrap working.
- **Frontend (merged):**
  - `features/participant-shell/components/ComplianceChrome.tsx` + `chromeConfig.ts` (`useChromeConfig`,
    `isChromeConfig`, `isWatermarkRequired`) — **story 02 does not rebuild or restyle these.**
  - `features/participant-shell/{shellState,brandTokens,channelNavConfig}.ts` and
    `components/OverlayLayer/overlayState.ts` — the consuming seams whose runtime guards define what
    "unchanged wire shape" means.
  - `core/exerciseContext/exerciseContextResolver.ts` — the `ExerciseStatus` union + `isExerciseStatus`
    guard that **fails closed on an unknown status**. Story 01a widens it additively (both vocabularies)
    and ships that change first — this is the split-deploy guard, not a file to leave alone.
  - `features/planner/` (`AccountImport`, `useAccountImport`, `accountImportService`) — the staff-world
    surface pattern the settings editor follows: COBRA `@/theme/styledComponents` + `CobraStyles`,
    FontAwesome only, MUI 9 `sx`-only, React Query 5, the shared axios client, and a single env-guarded
    mock flip point (`core/config/mockData.ts`'s `USE_MOCK_DATA`).
  - `core/services/api.ts` (shared axios client), `core/services/queryClient.ts`,
    `core/utils/validateEnv.ts`.
- **Design contracts:** `docs/design/D7-application-shells/SHELL-CONTRACT.md` §1 (chrome: two banners,
  text + colors config-driven, chrome-off legal) and the overlay z-order/state list §Overlay layer.
- **Consumed by:** `exercise-build-golive` (lifecycle transitions), `exercise-clock` (time zone; Live
  starts the clock), every channel (enablement + theming), E8 (dormant until Live), E10 (practice flag).

## Wave Plan (DAG-ready)

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|---------------|------------|--------------|------|--------|
| **01a** Settings schema + vocabulary widening | **fullstack** | `Data/Entities/Exercise.cs`; `Data/PulseDbContext.cs` (`Exercise` block); `Data/Migrations/<ts>_ExerciseConfiguration.*` + snapshot; `Features/Ops/Bootstrap/BootstrapService.cs` (seed literal); `Features/ExerciseResolution/ExerciseScopeDto.cs` (pass-through/doc); `core/exerciseContext/exerciseContextResolver.ts` (additive guard widening) | — (main; `exercise-isolation` 01/08 merged) | **nothing** — sole migration author this feature | 1 | M |
| **01b** Settings API + shell-config service + staff editor | **fullstack** | `Features/ExerciseConfiguration/{ExerciseSettingsDtos,ExerciseSettingsService,ExerciseSettingsEndpoints,ParticipantShellConfigService,ExerciseConfigurationExtensions}.cs` (incl. the three projection interfaces + constant-preserving defaults); `Features/ParticipantShell/ParticipantShellEndpoints.cs` (refactor); `features/planner/{pages/ExerciseSettingsPage.tsx,components/ExerciseSettingsPanel.tsx,hooks/useExerciseSettings.ts,services/exerciseSettingsService.ts}` | 01a | — (solo: owns the serialized endpoints file) | 2 | L |
| **02** Compliance chrome config + NFR-008 guard | **fullstack** | `Features/ExerciseConfiguration/Chrome/*`; `features/planner/{components/ComplianceChromePanel.tsx,hooks/useChromeSettings.ts,services/chromeSettingsService.ts}` | 01a, 01b; `participant-shell/01` (merged) | 03, 04 | 3 | M |
| **03** Lifecycle **[Tier-2 — signed off]** | backend | `Features/ExerciseConfiguration/Lifecycle/*` | 01a (the vocabulary), 01b (the projection seam) | 02, 04 | 3 | L |
| **04** Practice/sandbox flag | **fullstack** | `Features/ExerciseConfiguration/PracticeMode/*`; `features/planner/{components/PracticeModePanel.tsx,hooks/usePracticeMode.ts,services/practiceModeService.ts}` | 01a, 01b | 02, 03 | 3 | S |
| **05** Participant exercise identity | *none* | — | — | — | **excluded — no code, not dispatched** | — |

**Why the waves are shaped this way**

- **Wave 1 is one story on purpose.** Stories 01, 02, 03 and 04 all want `Exercises`-table columns, and
  two builders scaffolding EF migrations in parallel corrupt `PulseDbContextModelSnapshot.cs`. 01a
  authors **every** column this feature needs — settings, chrome, watermark flag, practice flag — plus
  the Option-B `Status` widening, once. **No other story in this feature authors a migration.**
- **Wave 2 is one story on purpose.** `Features/ParticipantShell/ParticipantShellEndpoints.cs` is wanted
  by 01 (brand tokens, channel nav), 02 (chrome) and 03 (shell state, overlay state). It is a
  **serialized file owned solely by 01b**, which refactors all six handlers from constants onto
  `ParticipantShellConfigService` and publishes the three per-concern projection interfaces.
- **Wave 3 fans out three ways.** 02, 03 and 04 own disjoint backend sub-folders and disjoint planner
  components, and each contributes its projection as an implementation registered by its **own**
  `Add*()` — so none of them re-opens `ParticipantShellEndpoints.cs` or `ParticipantShellConfigService.cs`.
- **Story 03 moved from wave 4 to wave 3** under the two human decisions: its schema dependency is gone
  (01a carries the vocabulary) and its Tier-2 gate is cleared. The two things that had kept it late no
  longer do — the `ParticipantShellConfigService.cs` contention with 02 is dissolved by the projection
  seam, and the `world-steering` overlay-state conflict is now an accepted **merge-time** reconciliation
  rather than a scheduling constraint (hazard 1).

### Integration seams (orchestrator-owned — never a wave story)

| Seam | File(s) | Rule |
|------|---------|------|
| Backend composition root | `src/Pulse.WebApi/Program.cs` | Each story exports its own registration — 01b `AddExerciseConfiguration()` / `MapExerciseConfigurationEndpoints()`, 02 `AddComplianceChromeConfig()`, 03 `AddExerciseLifecycle()`, 04 `AddPracticeMode()` (each registering its own projection implementation over 01b's default). No builder edits `Program.cs`; the orchestrator wires the one-line calls serially between waves. Note `world-steering-wave2` also edits this file. |
| Frontend route table | `src/frontend/src/App.tsx` (+ `features/app-shell/createRoleAwareRoutes`) | The staff planner settings route is mounted by the orchestrator after wave 2 merges. No builder branch edits the route table. |
| Planner barrel | `src/frontend/src/features/planner/index.ts` | Every story here adds an export line to the same barrel. Orchestrator-owned: one edit per wave, after the wave's branches merge. |
| Planner settings page composition | `features/planner/pages/ExerciseSettingsPage.tsx` | Created by 01b. From wave 3 on it is a **composition point**: 02 and 04 export self-contained panels (`ComplianceChromePanel`, `PracticeModePanel`) and the orchestrator adds the one-line mount — so two wave-3 builders never edit the same page file. |

### Integration hazards

1. **`feature/world-steering-wave2` (unmerged, local-only — 14 commits, not pushed, no PR) — known,
   accepted, human-decided.** It rewrites `GET /api/overlay-state` in
   `src/Pulse.WebApi/Features/ParticipantShell/ParticipantShellEndpoints.cs` into a real **write path
   with SignalR push**, and edits `Program.cs`. The decision is to **proceed on all waves and resolve
   the conflict at merge time** rather than sequence around it — this is not an open question.
   Two facts that bound it:
   - **The textual conflict surface is one handler.** World-steering rewrites *only* the
     `/api/overlay-state` handler; `chrome-config`, `brand-tokens`, `channel-nav-config` and
     `shell-state` are untouched by it. So 01b's six-handler refactor conflicts in exactly one place,
     and 03 is the only story that meets it semantically.
   - **The semantic risk is duplicate pause semantics.** World-steering's CTL-023 Freeze and COR-032's
     Paused holding page target the **same surface and the same register**. The story-03 builder must
     reconcile them explicitly — one composed overlay state routed through world-steering's write path —
     and must **not** add a second parallel pause mechanism beside it.
2. **Migration serialization.** One migration author per feature (01a) — and 01a's scope now includes the
   `Status` vocabulary change, so nothing is left for a later wave to migrate. Pin `dotnet-ef` to the
   runtime version and never scaffold with `--no-build`, or the snapshot is rewritten against a stale
   model.
3. **Split-deploy ordering (the live risk that survives Option B).** UAT's frontend and backend deploy
   independently and `isExerciseStatus` fails closed, so a backend-ahead deploy of the new vocabulary
   blanks the participant world. 01a's client widening is additive and ships first (see "Client-first
   ordering"). This is a **deployment-order** constraint, not a build-order one — it binds whoever
   promotes wave 1 to UAT, not the builder.
4. **Frozen wire shapes.** The six `ParticipantShellDtos` records are contracts and are not reshaped by
   anything in this feature. `ExerciseScopeDto`'s **shape** is likewise frozen — only its `status`
   *vocabulary* changes, under the Tier-2 sign-off. A builder that "improves" either breaks a
   fail-closed client guard and blanks the participant shell in UAT rather than raising a type error.
   Every story here carries a contract test in its **Tests** section for exactly this reason.
