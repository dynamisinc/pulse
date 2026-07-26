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
| **01a** Settings schema + vocabulary widening | **fullstack** | The feature's **only** schema change. Extends the existing `Exercise` entity with the COR-030 settings columns, the **chrome config**, the **watermark on/off flag** (so 02's NFR-008 guard reads real state) and the **practice/sandbox flag**, in one EF migration — *and* carries story 03's **Option B vocabulary widening**: the `Status` column + data migration, `PulseDbContext`'s default, `BootstrapService`'s seed, and the **additive frontend guard widening that must ship first** (see "Lifecycle string literals" + "Client-first ordering"). | `Data/Entities/Exercise.cs`; `Data/PulseDbContext.cs` (the `Exercise` `OnModelCreating` block only); `Data/Migrations/<ts>_ExerciseConfiguration.*` + `PulseDbContextModelSnapshot.cs`; `Features/Ops/Bootstrap/BootstrapService.cs` (seed literal only); `Features/ExerciseResolution/ExerciseScopeDto.cs` (doc/pass-through only); `core/exerciseContext/exerciseContextResolver.ts` (`ExerciseStatus` union + `EXERCISE_STATUSES` + `isExerciseStatus`); `features/staffShell/components/statePillConfig.ts` + `StaffHeader.test.tsx` (the exhaustive status→pill `Record` must gain a key per literal) | The extended `Exercise` entity + **the COR-032 status vocabulary** — every other story in this feature reads/writes these columns and authors **no** migration |
| **01b** Settings — API + shell-config service + staff editor | **fullstack** | New `Features/ExerciseConfiguration/` slice: staff read/write of the COR-030 settings, plus the **constants → per-exercise projection refactor** of the six participant-shell handlers. Staff editor in the existing COBRA `features/planner/` surface. | `Features/ExerciseConfiguration/{ExerciseSettingsDtos,ExerciseSettingsService,ExerciseSettingsEndpoints,ParticipantShellConfigService,ExerciseConfigurationExtensions}.cs`; `Features/ParticipantShell/ParticipantShellEndpoints.cs` (**refactor — serialized file, see hazards**); `features/planner/pages/ExerciseSettingsPage.tsx`, `features/planner/components/ExerciseSettingsPanel.tsx`, `features/planner/hooks/useExerciseSettings.ts`, `features/planner/services/exerciseSettingsService.ts` | `AddExerciseConfiguration()` / `MapExerciseConfigurationEndpoints()`; **`ParticipantShellConfigService`** plus the **per-concern projection interfaces** it resolves from DI (`IChromeConfigProjection`, `IShellVariantProjection`, `IOverlayStateProjection`), whose constant-preserving defaults are registered with **`TryAddScoped`** per the projection-override contract — this is what lets 02 and 03 contribute in their **own** files and run in the same wave; `GET/PUT /api/staff/exercise-settings`; `ExerciseSettingsPage` (the panel host) |
| **02** Compliance chrome — per-exercise config + NFR-008 guard | **fullstack** | The banner component already ships (`participant-shell/01`). This adds the per-exercise chrome config, the **server-side** chrome↔watermark mutual guard, and the staff panel; it serves through the unchanged frozen `ChromeConfigResponse`. | `Features/ExerciseConfiguration/Chrome/{ChromeConfigProjection,ComplianceChromeGuard,ChromeSettingsEndpoints,ChromeExtensions}.cs`; `features/planner/components/ComplianceChromePanel.tsx`, `features/planner/hooks/useChromeSettings.ts`, `features/planner/services/chromeSettingsService.ts` | `IChromeConfigProjection` impl, registered via `services.Replace(...)` per the projection-override contract; `ComplianceChromeGuard` (the NFR-008 invariant, one place); `AddComplianceChromeConfig()` |
| **03** Lifecycle **[Tier-2 — sign-off given]** | backend | COR-032's six states + allowed transitions (409 on disallowed), participant gating (Staged/Live only), the Paused holding page, and XC-004 transition telemetry — layered onto the vocabulary 01a already shipped. **Authors no schema and no migration.** Supplies the shell-variant + overlay-state projections behind 01b's seam. | `Features/ExerciseConfiguration/Lifecycle/{ExerciseLifecycleState,ExerciseLifecycleService,LifecycleProjection,LifecycleEndpoints,LifecycleExtensions,ExerciseLifecycleGatingMiddleware}.cs` | `ExerciseLifecycleService` — the single lifecycle read other features subscribe to (build/go-live, clock, engine); `AddExerciseLifecycle()`; **`UseExerciseLifecycleGating()`** (the participant fail-closed seam — orchestrator-wired); the shell-variant + overlay-state projections, registered via `Replace` |
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

> **`scheduled` has two defensible readings — this table governs persistence.** The shipped
> `features/staffShell/components/statePillConfig.ts` treats legacy `scheduled` as an **alias of
> `staged`** and renders it "STAGED", while the table above migrates the stored value to **`build`**.
> Both are reasonable (an unconfigured row is arguably either), and the divergence is unobservable once
> the migration has run, because **no row carries `scheduled` afterwards**. The rule: **this table is
> authoritative for the stored value**; the pill's alias governs only how a not-yet-migrated legacy row
> *displays* during the transition. A story-03 builder reading `statePillConfig.ts` to learn the visual
> vocabulary should not infer a lifecycle mapping from it.

### Client-first ordering (the split-deploy guard)

UAT is a split deployment (Azure SWA frontend + App Service backend) whose halves deploy independently,
and `isExerciseStatus` **fails closed on unknown values** — a backend-ahead deploy blanks the participant
world rather than erroring. So 01a's frontend change is **purely additive and ships first**:
`EXERCISE_STATUSES` / `isExerciseStatus` / the `ExerciseStatus` union accept the **transitional superset**
— **nine literals**, not ten: the six COR-032 values plus the legacy four, with `archived` shared by both
— before any backend emits a new value, and the frontend is deployed **no later than** the backend.

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
  - **`Features/Social/PostSanitizer.cs` — the shipped server-side free-text sanitizer (NFR-004). Call
    it; do not hand-roll a second one.** Every NFR-004 AC in this feature (story 01's world/brand/outlet
    names, story 02's banner text) is satisfied through it.
    > **Strip, never entity-encode.** Its header documents the rule and the reason: the participant
    > render path is a React text node that already escapes `& < > " '`, so entity-encoding server-side
    > DOUBLE-encodes ordinary text (`don't` → `don&#39;t`) and breaks the fiction. Reaching for
    > `HtmlEncoder` here would ship banner text reading `UNCLASSIFIED &#47;&#47; EXERCISE` on every
    > participant channel. It is a pure static function — no DI registration, call it at the one write
    > boundary.
  - `Features/Identity/Accounts/AccountFieldRules.cs` — the length/field-bounds validation pattern the
    settings and chrome writes reuse for their "length-bounded, fails closed with 400" ACs.
- **Frontend (merged):**
  - `features/participant-shell/components/ComplianceChrome.tsx` + `chromeConfig.ts` — which export
    **exactly `useChromeConfig` and `isWatermarkRequired`**. **Story 02 does not rebuild or restyle
    these.**
  - `features/participant-shell/{shellState,brandTokens,channelNavConfig}.ts` and
    `components/OverlayLayer/overlayState.ts` — the consuming seams whose runtime guards define what
    "unchanged wire shape" means.
    > **The guards are module-private — do not try to import them.** `isBrandTokens`,
    > `isChannelNavConfigResponseBody` and `isChromeConfig` are unexported internals of a **different,
    > Complete feature** (`participant-shell`), and no story here owns those files. **Write the contract
    > test the intended way:** drive the public hook — `useChromeConfig()`, `useBrandConfig()` /
    > `useBrandTokens()`, `useChannelNav()` — through a **mocked axios adapter returning the real
    > response body**, and assert the hook resolves that body rather than falling back to its default.
    > A hook that silently returns its safe default *is* the guard rejecting the shape, so this proves
    > the contract without exporting anything.
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

## The projection-override contract (authoritative — wave 3's concurrency depends on it)

Wave 3's whole fan-out rests on "01b ships constant-preserving defaults; 02/03/04 each override one
projection from their own file". That only works if the override mechanism is pinned, because
`TryAdd*` (first registration wins) and `Add*` (last wins) give **opposite** outcomes, and the outcome
also depends on the order the orchestrator writes the calls into `Program.cs`. Both idioms already
exist in this codebase — `AddStaffIdentity` deliberately `TryAdd`s a fail-closed null accessor. So:

| Role | Registration | Rule |
|---|---|---|
| **01b's defaults** (`IChromeConfigProjection`, `IShellVariantProjection`, `IOverlayStateProjection`) | `services.TryAddScoped<IX, ConstantX>()` | Fail-safe floor: present iff nobody has contributed a real one. Never `AddScoped` — that would stack a second registration and let last-wins order decide silently. |
| **Contributors** (02 chrome, 03 shell-variant + overlay-state) | `services.Replace(ServiceDescriptor.Scoped<IX, RealX>())` | `Replace` is order-independent and unambiguous: it swaps the descriptor whether or not the default is already registered, and leaves exactly one descriptor behind. |
| **Orchestrator** (`Program.cs`) | contributor `Add*()` calls are **conventionally placed after** `AddExerciseConfiguration()` | A convention, **not a correctness requirement**: `Replace` wins from either side (pinned by `..._WinsEvenWhenItRunsBeforeTheDefault`). Ordering only decides the outcome for the mistaken `TryAdd` idiom below — where *before* would accidentally work and *after* silently fails — so a consistent order makes that mistake less likely to reach production undetected in one direction. It is not a substitute for using `Replace`. |

**The failure this prevents** (silent, ships green) — **it is the `TryAdd` copy, not `AddScoped`:** a
contributor reads 01b's own registration, copies its `TryAddScoped` idiom, and loses. The default is
already registered, so `TryAdd` is a **no-op**; no error is raised anywhere; the contributor's own unit
tests pass because they exercise the projection class directly — and at runtime the constant default
still serves, so `/api/chrome-config` returns identical banners for every exercise. Pinned by
`ExerciseConfigurationProjectionRegistrationTests.ContributedProjection_RegisteredWithTryAdd_IsSilentlyIgnored_WhichIsWhyReplaceIsMandatory`.

> **A bare `AddScoped` is not the trap** (corrected at the wave-2 Gate-2 review — the earlier text here
> named it, wrongly). With `TryAddScoped` registered first, a later `AddScoped` **appends** a second
> descriptor and `GetRequiredService<T>` returns the **last** one, so the contributor wins; if the
> contributor's `AddScoped` runs first, 01b's `TryAdd` sees a registration present and stands down, so
> the contributor wins again. `AddScoped` is still **not** the mandated idiom — it leaves a stale second
> descriptor behind, which changes `IEnumerable<IX>` resolution and makes "which one is live" depend on
> ordering rather than on the descriptor set — but a wave-3 builder or reviewer hunting the silent
> failure should be hunting a `TryAdd`, not an `Add`.

**`Replace` remains mandatory** for both reasons above: it is the only idiom that is order-independent
*and* leaves a single descriptor. Hence the DI-resolution AC on stories 02, 03 and 04 (04's is on its
own `IEvaluationEligibility` seam, not a shell projection): resolve the interface from a fully composed
service provider (the slice's real `Add*()` calls, in the orchestrator's order) and assert the
**contributed** implementation comes back and produces per-exercise output end to end.

## Wave Plan (DAG-ready)

> **Status: waves 1 and 2 are done.** Slices **01a** and **01b** are built, merged to the
> `feature/exercise-configuration` umbrella, wired into `Program.cs` and green. Story 01's file `Status:`
> stays **In Progress** — AC3's channel-enablement route-gating clause is unmet by design and unowned
> (feature.md open question **c**). **Wave 3 (02, 03, 04) is the next dispatch.** What wave 3 inherits is
> tabulated in `feature.md` → "What waves 1 and 2 actually shipped".

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|---------------|------------|--------------|------|--------|
| **01a** Settings schema + vocabulary widening ✅ *shipped* | **fullstack** | `Data/Entities/Exercise.cs`; `Data/PulseDbContext.cs` (`Exercise` block); `Data/Migrations/<ts>_ExerciseConfiguration.*` + snapshot; `Features/Ops/Bootstrap/BootstrapService.cs` (seed literal); `Features/ExerciseResolution/ExerciseScopeDto.cs` (pass-through/doc); `core/exerciseContext/exerciseContextResolver.ts` (additive guard widening); **`features/staffShell/components/statePillConfig.ts` + `StaffHeader.test.tsx`** (the exhaustive `Record<ExerciseStatus, StatePillConfig>` gains a key per new literal — see hazard 1) | — (main; `exercise-isolation` 01/08 merged) | **nothing** — sole migration author this feature | 1 | M |
| **01b** Settings API + shell-config service + staff editor ✅ *shipped* | **fullstack** | `Features/ExerciseConfiguration/{ExerciseSettingsDtos,ExerciseSettingsService,ExerciseSettingsEndpoints,ParticipantShellConfigService,ExerciseConfigurationExtensions}.cs` (incl. the three projection interfaces + constant-preserving defaults); `Features/ParticipantShell/ParticipantShellEndpoints.cs` (refactor); `features/planner/{pages/ExerciseSettingsPage.tsx,components/ExerciseSettingsPanel.tsx,hooks/useExerciseSettings.ts,services/exerciseSettingsService.ts}` | 01a | — (solo: owns the serialized endpoints file) | 2 | L |
| **02** Compliance chrome config + NFR-008 guard | **fullstack** | `Features/ExerciseConfiguration/Chrome/*` (incl. its **own** `AddComplianceChromeConfig()` **and** `MapComplianceChromeEndpoints()` in `ChromeExtensions.cs` — never a line inside 01b's `ExerciseConfigurationExtensions.cs`); `features/planner/{components/ComplianceChromePanel.tsx,hooks/useChromeSettings.ts,services/chromeSettingsService.ts}` | 01a, 01b (**both shipped**); `participant-shell/01` (merged) | 03, 04 | 3 | M |
| **03** Lifecycle **[Tier-2 — signed off]** | backend | `Features/ExerciseConfiguration/Lifecycle/*` — **including the `UseExerciseLifecycleGating()` middleware** it exports for the orchestrator to wire (see "The participant-gating seam") | 01a, 01b (**both shipped**); `exercise-isolation/04` (#47, **Complete** — the session-kind seam the gating middleware reads). **`exercise-isolation/06` (#49) is NOT a blocking edge** — the cycle is split below, and 03 consumes only the `archived` state it defines itself | 02, 04 | 3 | L |
| **04** Practice/sandbox flag | **fullstack** | `Features/ExerciseConfiguration/PracticeMode/*` (incl. its **own** `AddPracticeMode()` **and** `MapPracticeModeEndpoints()` in `PracticeModeExtensions.cs` — never a line inside 01b's `ExerciseConfigurationExtensions.cs`); `features/planner/{components/PracticeModePanel.tsx,hooks/usePracticeMode.ts,services/practiceModeService.ts}` | 01a, 01b (**both shipped**) | 02, 03 | 3 | S |
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
- **Wave 3 fans out three ways.** 02, 03 and 04 own disjoint backend sub-folders (`Chrome/`,
  `Lifecycle/`, `PracticeMode/`) and disjoint planner components, and each contributes its projection as
  an implementation registered by its **own** `Add*()` in its **own** extensions file — so none of them
  re-opens `ParticipantShellEndpoints.cs`, `ParticipantShellConfigService.cs` or
  `ExerciseConfigurationExtensions.cs`. Re-checked against what wave 2 actually shipped: all three
  projection interfaces and the `ExerciseShellConfigSource` read model exist with 02's and 03's inputs
  already populated; every column 02/03/04 need is on `Exercise`; and 01b's `PUT /api/staff/exercise-settings`
  touches **none** of the chrome, watermark or practice columns, so 02 and 04 own those write paths
  outright with no competing writer and no way to bypass 02's NFR-008 guard.
- **Story 03 moved from wave 4 to wave 3** under the two human decisions: its schema dependency is gone
  (01a carries the vocabulary) and its Tier-2 gate is cleared. The two things that had kept it late no
  longer do — the `ParticipantShellConfigService.cs` contention with 02 is dissolved by the projection
  seam, and the `world-steering` overlay-state conflict is now an accepted **merge-time** reconciliation
  rather than a scheduling constraint (hazard 1).

### The participant-gating seam (story 03) — a projection cannot fail closed

Story 03's "in Build / Completed / Archived the participant surface is not served" is **not**
implementable as an `IShellVariantProjection`: that interface only changes
`ShellStateResponse.variant`, so a builder could return `readOnly`, tick the AC, and `/api/feed` would
still serve posts into an archived world. Refusing service is a **pipeline** concern.

Story 03 therefore owns and exports **`UseExerciseLifecycleGating()`** — an `IApplicationBuilder`
extension living in `Features/ExerciseConfiguration/Lifecycle/` — which the orchestrator wires into
`Program.cs` (integration seam below), positioned **after** the exercise-resolution and session
middleware so a scope is already resolved. It must cover, for a **participant** session whose exercise
is in `build` / `completed` / `archived`:

- the social reads/writes — `/api/feed`, `/api/threads/{id}`, `/api/personas`, `POST /api/posts`;
- all six participant-shell config GETs — `/api/shell-state`, `/api/chrome-config`, `/api/brand-tokens`,
  `/api/channel-nav-config`, `/api/alerts`, `/api/overlay-state`;
- and it must **not** gate staff/evaluator sessions (staff work in `build` is the point of `build`), nor
  the pre-auth allowlist (`/api/exercise-context`, login).

This keeps 03 out of the shared endpoint files entirely — it adds no `Map*` and edits no other slice.

### Story 03 ↔ `exercise-isolation/06`: the circular dependency, split

`03` names `exercise-isolation/06` (archived separation, #49) as a dependency; `/06` names
"exercise lifecycle (exercise-configuration COR-032)" as *its* dependency. That is a genuine cycle, and
it is resolved by splitting the Archived behavior rather than by sequencing:

- **Story 03 owns now:** the `archived` lifecycle state itself, the transitions into it, and
  **participant access refusal** while in it (the gating middleware above). Nothing data-layer.
- **`/06` owns later:** data-layer separation — archived content never appearing in any *other*
  exercise's live queries, and the self-contained AAR-exportable set. That is a query/scoping concern on
  top of the central filter, not a lifecycle concern.

So story 03 depends on `/06` only for *naming* — it consumes the `archived` state it already defines and
**must not invent a parallel archived-exclusion query mechanism**; `/06` will build that against the
state 03 ships. Story 03 must not carry an AC asserting cross-exercise archived exclusion, because it
cannot meet one.

### Integration seams (orchestrator-owned — never a wave story)

| Seam | File(s) | Rule |
|------|---------|------|
| Backend composition root | `src/Pulse.WebApi/Program.cs` | **01b's two lines are wired** (`builder.Services.AddExerciseConfiguration()` + `app.MapExerciseConfigurationEndpoints()`), guarded by `Features/ExerciseConfiguration/CompositionRootWiringTests` — three tests that boot the real host with no override and go red if either line is removed. Each wave-3 story exports its **own** pair from its **own** extensions file — 02 `AddComplianceChromeConfig()` / `MapComplianceChromeEndpoints()`, 03 `AddExerciseLifecycle()` (+ `UseExerciseLifecycleGating()`), 04 `AddPracticeMode()` / `MapPracticeModeEndpoints()` — and **must not add a call inside 01b's `ExerciseConfigurationExtensions.cs`**: that file is 01b's, and two wave-3 builders routing their `Map*` through it is the one way this fan-out collides. No builder edits `Program.cs`; the orchestrator wires the one-line calls serially between waves. Note `world-steering-wave2` also edits this file. |
| Frontend route table | `src/frontend/src/App.tsx` (+ `features/app-shell/createRoleAwareRoutes`) | **Now mounted:** `PlannerWorkspaceRoute` fills `staffSurfaces.planner` (the slot was empty, so planner sessions failed closed to `/login`). Still orchestrator-owned — no builder branch edits the route table. |
| Planner barrel | `src/frontend/src/features/planner/index.ts` | Every story here adds an export line to the same barrel (it currently exports `AccountImport`, `ExerciseSettingsPage`, `ExerciseSettingsPanel`, `useExerciseSettings`, …). Orchestrator-owned: one edit per wave, after the wave's branches merge. |
| Planner settings page composition | `features/planner/pages/ExerciseSettingsPage.tsx` | **Created by 01b and on disk**, already carrying the two commented wave-3 mount slots. It deliberately holds no state, no data fetching and no cross-panel coordination. From wave 3 on it is a **composition point**: 02 and 04 export self-contained panels (`ComplianceChromePanel`, `PracticeModePanel`) — each owning its own hook, service, query and states, so nothing needs a prop threaded through the page — and the orchestrator adds the one-line mount. Two wave-3 builders never edit this file. |
| Planner README | `src/frontend/src/features/planner/README.md` | The shipped README documents **every file in the surface in one table**, so each story would append to it. Orchestrator-owned: one edit per wave, alongside the barrel. |
| Backend pipeline | `src/Pulse.WebApi/Program.cs` (middleware ordering) | Story 03 exports `UseExerciseLifecycleGating()`; the orchestrator inserts the single `app.Use…()` call **after** `UseExerciseResolution()` and the session middleware, so a scope and a session kind are resolved before gating decides. No builder edits the pipeline. |

**`features/planner/types.ts` is deliberately NOT a shared seam.** Rather than serialize a fourth file,
the rule is: **02 and 04 keep their client-contract types local to their own service module**
(`chromeSettingsService.ts`, `practiceModeService.ts`), exporting them from there. `types.ts` stays what
it is today — the `identity-auth-roles/02` account-import contract — and no wave-3 builder opens it.

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
   - **A second, frontend conflict surface: `features/staffShell/components/statePillConfig.ts`.**
     Story 01a necessarily widened that file's exhaustive `Record<ExerciseStatus, StatePillConfig>` (a
     key per new literal, or it does not compile), and the same file hosts `pauseStatePillConfig` —
     world-steering's D5-014 tiered-pause factory. **Risk inference, not a confirmed textual conflict:**
     `world-steering-wave2` is local and unmerged and was not inspected, so treat this as "expect to
     meet here", not "will conflict here". If the merge does touch it, the thing to check is that
     **every** `ExerciseStatus` key survives: a dropped key means that status renders as a dot with no
     text label — color-only, an NFR-001 break — and TypeScript will only catch it if the `Record` stays
     exhaustive.
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
