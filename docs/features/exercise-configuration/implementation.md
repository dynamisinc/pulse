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
> `Features/ParticipantShell/ParticipantShellDtos.cs` shapes. The whole backend job here is
> *replacing hardcoded constants with per-exercise data behind the same wire shapes* — so no frontend
> consumer and no runtime type-guard changes.

## Per-story tech notes

| Story | Stack | Approach | Key files (owns) | Exports / seams (that others import) |
|-------|-------|----------|------------------|--------------------------------------|
| **01a** Settings — schema + the one migration | backend | The feature's **only** schema change. Extends the existing `Exercise` entity with the COR-030 columns *plus* the columns stories 02 (chrome config) and 04 (practice flag) need, in a single EF migration. Adds the story-03 lifecycle column too **iff** the Tier-2 reconciliation (below) is signed off before this wave runs. | `Data/Entities/Exercise.cs` (additive columns); `Data/PulseDbContext.cs` (the `Exercise` `OnModelCreating` block only); `Data/Migrations/<ts>_ExerciseConfiguration.*` + `PulseDbContextModelSnapshot.cs` | The extended `Exercise` entity — every other story in this feature reads/writes these columns and authors **no** migration |
| **01b** Settings — API + shell-config service + staff editor | **fullstack** | New `Features/ExerciseConfiguration/` slice: staff read/write of the COR-030 settings, plus the **constants → per-exercise projection refactor** of the six participant-shell handlers. Staff editor in the existing COBRA `features/planner/` surface. | `Features/ExerciseConfiguration/{ExerciseSettingsDtos,ExerciseSettingsService,ExerciseSettingsEndpoints,ParticipantShellConfigService,ExerciseConfigurationExtensions}.cs`; `Features/ParticipantShell/ParticipantShellEndpoints.cs` (**refactor — serialized file, see hazards**); `features/planner/pages/ExerciseSettingsPage.tsx`, `features/planner/components/ExerciseSettingsPanel.tsx`, `features/planner/hooks/useExerciseSettings.ts`, `features/planner/services/exerciseSettingsService.ts` | `AddExerciseConfiguration()` / `MapExerciseConfigurationEndpoints()`; **`ParticipantShellConfigService`** — the per-exercise projection seam stories 02 and 03 fill; `GET/PUT /api/staff/exercise-settings`; `ExerciseSettingsPage` (the panel host) |
| **02** Compliance chrome — per-exercise config + NFR-008 guard | **fullstack** | The banner component already ships (`participant-shell/01`). This adds the per-exercise chrome config, the **server-side** chrome↔watermark mutual guard, and the staff panel; it serves through the unchanged frozen `ChromeConfigResponse`. | `Features/ExerciseConfiguration/Chrome/{ChromeConfigProjection,ComplianceChromeGuard,ChromeSettingsEndpoints}.cs`; `features/planner/components/ComplianceChromePanel.tsx`, `features/planner/hooks/useChromeSettings.ts`, `features/planner/services/chromeSettingsService.ts` | The chrome projection consumed by `ParticipantShellConfigService`; `ComplianceChromeGuard` (the NFR-008 invariant, one place) |
| **03** Lifecycle **[Tier-2 — human sign-off]** | backend | COR-032's six states + allowed transitions, **and** the explicit reconciliation against the frozen `Exercise.Status` vocabulary (options A/B in the story). Projects onto the frozen `status`, `ShellStateResponse.variant` and `OverlayStateResponse` (the Paused holding page). | `Features/ExerciseConfiguration/Lifecycle/{ExerciseLifecycleState,ExerciseLifecycleService,LifecycleProjection,LifecycleEndpoints}.cs`; (option B only) a **second, serial** migration after 01a | `ExerciseLifecycleService` — the single lifecycle read other features subscribe to (build/go-live, clock, engine); the shell-variant + overlay-state projections |
| **04** Practice flag | **fullstack** | Behavior only (the column ships in 01a): set/read the flag and publish the one evaluation-eligibility seam E10 will filter on, plus the staff indicator (icon + text, never color-only). | `Features/ExerciseConfiguration/PracticeMode/{PracticeModeService,PracticeModeEndpoints}.cs`; `features/planner/components/PracticeModePanel.tsx`, `features/planner/hooks/usePracticeMode.ts`, `features/planner/services/practiceModeService.ts` | `IEvaluationEligibility` (the single read E10's export filtering consumes); `PracticeModePanel` |
| **05** Participant exercise identity | *none — requirements decision, no code* | Resolves COMPONENTS.md divergence #5; the outcome lands in story 02's chrome **content** and the D7 shell. **Explicitly excluded from the Wave Plan** — never dispatched to a builder, never in a fan-out. | — | the decision (a D7 input) |

### The Tier-2 lifecycle decision is a wave-0 gate

Story 03 must choose between **Option A** (distinct lifecycle column + a lossy projection onto the frozen
`scheduled | active | complete | archived`) and **Option B** (widen the frozen vocabulary and migrate
every consumer + the deployed client guard). The full trade-off table and the constraint live in
`03-exercise-lifecycle.md`.

Orchestration consequence: **get the sign-off before wave 1 runs.** If option A is signed off in time,
its column joins 01a's single migration and story 03 authors no schema at all. If the decision is still
open when wave 1 runs, story 03 must author a **second, serial** migration after 01a has merged — never
in parallel with it (see hazard 2).

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
    `FromExercise` is the existing projection story 03 must keep valid.
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
    guard that **fails closed on an unknown status**. This is the constraint story 03 works within.
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
| **01a** Settings schema + migration | backend | `Data/Entities/Exercise.cs`; `Data/PulseDbContext.cs` (`Exercise` block); `Data/Migrations/<ts>_ExerciseConfiguration.*` + snapshot | — (main; `exercise-isolation` 01/08 merged) | **nothing** — sole migration author this feature | 1 | M |
| **01b** Settings API + shell-config service + staff editor | **fullstack** | `Features/ExerciseConfiguration/{ExerciseSettingsDtos,ExerciseSettingsService,ExerciseSettingsEndpoints,ParticipantShellConfigService,ExerciseConfigurationExtensions}.cs`; `Features/ParticipantShell/ParticipantShellEndpoints.cs` (refactor); `features/planner/{pages/ExerciseSettingsPage.tsx,components/ExerciseSettingsPanel.tsx,hooks/useExerciseSettings.ts,services/exerciseSettingsService.ts}` | 01a; **`world-steering-wave2` integrated** (same endpoints file) | — (solo: owns the serialized endpoints file) | 2 | L |
| **02** Compliance chrome config + NFR-008 guard | **fullstack** | `Features/ExerciseConfiguration/Chrome/*`; `features/planner/{components/ComplianceChromePanel.tsx,hooks/useChromeSettings.ts,services/chromeSettingsService.ts}` | 01a, 01b; `participant-shell/01` (merged) | 04 | 3 | M |
| **04** Practice/sandbox flag | **fullstack** | `Features/ExerciseConfiguration/PracticeMode/*`; `features/planner/{components/PracticeModePanel.tsx,hooks/usePracticeMode.ts,services/practiceModeService.ts}` | 01a, 01b | 02 | 3 | S |
| **03** Lifecycle **[Tier-2]** | backend | `Features/ExerciseConfiguration/Lifecycle/*`; edits `ParticipantShellConfigService.cs`; (option B) a second serial migration | 01a, 01b, 02; the Tier-2 reconciliation sign-off; `world-steering-wave2` integrated | — (solo) | 4 | L |
| **05** Participant exercise identity | *none* | — | — | — | **excluded — no code, not dispatched** | — |

**Why the waves are shaped this way**

- **Wave 1 is one story on purpose.** Stories 01, 02, 03 and 04 all want `Exercises`-table columns, and
  two builders scaffolding EF migrations in parallel corrupt `PulseDbContextModelSnapshot.cs`. 01a
  authors **every** column this feature needs, once. No other story in this feature authors a migration
  (option B for story 03 is the single, signed-off exception, and is serial).
- **Wave 2 is one story on purpose.** `Features/ParticipantShell/ParticipantShellEndpoints.cs` is wanted
  by 01 (brand tokens, channel nav), 02 (chrome) and 03 (shell state, overlay state). It is treated as a
  **serialized file owned solely by 01b**, which refactors all six handlers from constants onto
  `ParticipantShellConfigService`. Stories 02 and 03 then contribute their projections in their own files
  and never touch the endpoints file.
- **Wave 3 fans out** because 02 and 04 own disjoint backend sub-folders and disjoint planner components.
- **Wave 4 is last** because story 03 is Tier-2, edits `ParticipantShellConfigService.cs` after 02 has,
  and depends on the `world-steering` overlay-state write path.

### Integration seams (orchestrator-owned — never a wave story)

| Seam | File(s) | Rule |
|------|---------|------|
| Backend composition root | `src/Pulse.WebApi/Program.cs` | Story 01b exports `AddExerciseConfiguration()` / `MapExerciseConfigurationEndpoints()`; stories 02/03/04 extend **that slice's own** registration, never `Program.cs`. The orchestrator wires the one-line calls serially between waves. Note `world-steering-wave2` also edits this file. |
| Frontend route table | `src/frontend/src/App.tsx` (+ `features/app-shell/createRoleAwareRoutes`) | The staff planner settings route is mounted by the orchestrator after wave 2 merges. No builder branch edits the route table. |
| Planner barrel | `src/frontend/src/features/planner/index.ts` | Every story here adds an export line to the same barrel. Orchestrator-owned: one edit per wave, after the wave's branches merge. |
| Planner settings page composition | `features/planner/pages/ExerciseSettingsPage.tsx` | Created by 01b. From wave 3 on it is a **composition point**: 02 and 04 export self-contained panels (`ComplianceChromePanel`, `PracticeModePanel`) and the orchestrator adds the one-line mount — so two wave-3 builders never edit the same page file. |

### Integration hazards

1. **`feature/world-steering-wave2` (unmerged, local-only — 14 commits, not pushed, no PR).** It rewrites
   `src/Pulse.WebApi/Features/ParticipantShell/ParticipantShellEndpoints.cs` (+~90 lines), turning
   `GET /api/overlay-state` into a real **write path with SignalR push**, and edits `Program.cs`. Stories
   01b and 03 both want that file, and story 03's Paused holding page is the same overlay-state surface.
   **Sequencing decision belongs to the orchestrator** — the assumption baked into the Wave Plan is that
   world-steering integrates *first* and this feature builds on it. Do not resolve this inside a builder
   branch; a wave-2 dispatch before that lands will produce a conflicting rewrite of the same handlers.
2. **Migration serialization.** One migration author per feature (01a). If any later story needs schema,
   it is authored serially after the previous migration has merged — never in the same wave. Pin
   `dotnet-ef` to the runtime version and never scaffold with `--no-build`, or the snapshot is rewritten
   against a stale model.
3. **The Tier-2 lifecycle reconciliation is a wave-0 gate** (see above). Left open past wave 1, it costs
   a second migration and re-opens the frozen `status` vocabulary late.
4. **Frozen wire shapes.** `ExerciseScopeDto` and the six `ParticipantShellDtos` records are contracts.
   A builder that "improves" one of them breaks a fail-closed client guard and blanks the participant
   shell in UAT rather than raising a type error. Every story here has a contract test in its **Tests**
   section for exactly this reason.
