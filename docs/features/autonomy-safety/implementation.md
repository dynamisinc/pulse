# Implementation: Autonomy & safety

> The safety layer. Staff-world; integrates with the ALREADY-BUILT engine-review-cockpit (#34–36) and
> world-steering — E8 produces exactly what they consume. Backend .NET absent; the autonomy state +
> the auto-HOLD/kill-switch/workload contracts are the seams.

## Per-story tech notes

| Story | Approach | Key files it will own | Exports (the seam others import) |
|-------|----------|-----------------------|----------------------------------|
| 01 Autonomy levels | Per-exercise autonomy state + per-storyline overrides; read by reaction-loop dispatch. | `services/autonomy/level` | `autonomyFor(exercise, storyline) → Suggest \| Delayed` |
| 02 Auto-HOLD wiring | Timed-draft terminal action = HOLD (default); swamped-mode flag (#36) is the only send path. | `services/autonomy/timeout` | timed-draft terminal-action contract for cockpit #35 |
| 03 Kill switch | One control → Suggest/stop instantly; suspends in-flight countdowns; no auto-recovery. | `services/autonomy/killSwitch` | `killSwitch(mode)`; shared "autonomy only down" invariant |
| 04 Workload contract | Demand signal + the demand-reduction design; eval-enforced ≤6/min. | `services/autonomy/demand` | demand signal → queue-pressure meter; the CTL-034 budget |
| 05 Engine settings API | Two new `POST`s + one `GET` on the existing `/api/engine` cockpit group, delegating to `EngineAutonomyState.SetExerciseDefault` (built, previously never called) via the SAME `EngineAutonomyRegistry.GetOrCreate` instance the loop/tick read; a small new per-exercise tier-policy-mode store read at `ReactionLoopHost.cs`'s `Tier = intent.Tier` assignment; extends `EngineCockpitStaffAuthorizationFilter` to a controller-role gate on every mutating route (closes #297). Backend: **Pulse.WebApi**, no new EF entity (process-memory, like the kill switch it sits beside). | `Features/EngineRuntime/EngineReviewEndpoints.cs`, `EngineReviewService.cs` (new methods), `EngineAutonomyStateDto` (additive field), a new small tier-override store, `ReactionLoopHost.cs` (one-line override read) | `GET/POST /api/engine/settings*` — the contract story 06 (and any future console consumer) calls |
| 06 Engine settings panel | New COBRA flyout + hook + live-actions service, registered into the existing toolstrip via `useRegisterSurfaceTool()` exactly like `ControllerConsole.tsx`'s "PERSONAS" tool; fixes `EngineControlBar`'s LIVE label to read the real autonomy default instead of assuming Delayed-auto. Frontend: React Query + mock data behind the shared axios client until story 05 ships; then live. | `features/controller/engine/components/EngineSettingsPanel.tsx`, `hooks/useEngineSettings.ts`, `services/engineSettingsActions.ts`; edits to `ControllerConsole.tsx` + `EngineControlBar.tsx` | The `useEngineSettings()` hook other engine surfaces can read the true autonomy/tier state from |
| 07 Cut to Fake provider | **Composition-root change (orchestrator-owned, flag not pre-assign):** `AddEngineGeneration` must register both the startup-configured provider AND `FakeGenerationProvider` behind a per-exercise selector/decorator implementing `IGenerationProvider`. Backend: new per-exercise cut-state registry + two new `POST`s on the existing `/api/engine` group + an additive `effectiveProvider` field on `EngineSettingsDto`. Frontend: extends story 06's `EngineSettingsPanel`/`useEngineSettings` with a cut/restore toggle, same await-then-apply discipline. | `Pulse.Core.Core.Extensions.ServiceCollectionExtensions` (composition root — orchestrator edge), a new `GenerationProviderCutRegistry`-shaped store, `EngineReviewEndpoints.cs`/`EngineReviewService.cs` (two new routes), `EngineSettingsContracts.cs` (additive field), `EngineEventTypes.cs`/`EngineEventPayloads.cs` (pending #173 alignment); frontend edits to `EngineSettingsPanel.tsx`/`useEngineSettings.ts` | The binary cut/restore lever + the `effectiveProvider` read other engine surfaces (and evaluators) can trust over `provider` |

## Reuse map
- **engine-review-cockpit (#34 queue / #35 auto-HOLD+NEEDS-YOU / #36 swamped-mode)** — E8 produces the timed drafts + terminal action these consume; do not rebuild their UI.
- **world-steering / live-monitoring** — the queue-pressure (demand) meter (D5-014/2.7); the tiered-pause state.
- **engine-generation-infra story 05** — degraded-mode fallback is the automatic sibling of the kill switch (shared invariant + console surface).
- **reaction-loop** — routes drafts per autonomy level (dispatch); burst-level review is a loop design decision.
- **response-reaction story 03** — match suggestion reduces demand.
- E1 **roles** (lead-controller gate, swamped mode) + **clock** (Delayed-auto countdown).
- Telemetry emitter (`XC-004`) — autonomy changes, HOLD/auto-send transitions, kill-switch trips, demand.
- **Story 05 additionally reuses:** `EngineAutonomyRegistry`/`EngineAutonomyStateDto` (story 03 —
  extend additively, don't fork); `EngineCockpitStaffAuthorizationFilter` (extend for the controller-
  role gate, don't add a second auth mechanism); `IOptions<GenerationOptions>` +
  `IGenerationProvider.Name` (engine-generation-infra — read-only surface, never mutated here);
  `IEngineTelemetryEmitter`/`EngineEventTypes` (already wired into `EngineReviewService` — the cheap
  path if the telemetry-vocab question in story 05's ACs is resolved "yes").
- **Story 06 reuses:** `useRegisterSurfaceTool()`/`useToolstrip()` (`@/features/staffShell/
  toolRegistry`, D7-011) — the SAME seam `ControllerConsole.tsx`'s "PERSONAS" tool already uses, not a
  new extension point; `@/core/services/api.ts` (shared axios client); `@/core/config/mockData.ts`
  (`USE_MOCK_DATA`); `@/theme/styledComponents` (COBRA); the `EngineControlBar`/`ReviewQueue` shared
  dark-chrome token object (`chrome`) for visual consistency.
- **Story 07 reuses:** story 03's kill-switch shape (manual, one-way-down, human-only restore capped
  at the pre-existing baseline — the exact pattern this story applies to the provider axis instead of
  the autonomy axis); story 05's `EngineSettingsDto`/`EngineCockpitControllerRoleFilter` (extend
  additively, don't fork — same discipline story 05 itself followed against story 03); story 06's
  `EngineSettingsPanel.tsx`/`useEngineSettings.ts` (the console home + the await-then-apply,
  no-optimism reconciliation model that story's rebuild settled on, ported forward rather than
  re-litigated); `FakeGenerationProvider`/`AddEngineGeneration` (engine-generation-infra — the two
  registrations this story's composition-root change must make coexist); `IEngineTelemetryEmitter`/
  `EngineEventTypes` (extend once the #173 taxonomy question in the story's AC8 is resolved).

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Autonomy levels | autonomy/level | reaction-loop dispatch, E1 roles/clock | — | 1 | M |
| 02 Auto-HOLD wiring | autonomy/timeout | 01, engine-review-cockpit #35/#36 | 03 | 2 | M |
| 03 Kill switch | autonomy/killSwitch | 01, generation-infra 05 | 02 | 2 | S |
| 04 Workload contract | autonomy/demand | 01–03, response-reaction 03, eval-harness | — | 3 | M |
| 05 Engine settings API | `EngineReviewEndpoints.cs`, `EngineReviewService.cs`, `EngineAutonomyStateDto`, tier-override store, `ReactionLoopHost.cs` (1-line read) | 01, 03, engine-generation-infra 04, B2 staff identity | — (coordinate with any concurrent world-steering story before touching `EngineReviewEndpoints.cs`/`Service.cs`) | 4 | M |
| 06 Engine settings panel | `EngineSettingsPanel.tsx`, `useEngineSettings.ts`, `engineSettingsActions.ts`; edits to `ControllerConsole.tsx`, `EngineControlBar.tsx` | 05 (contract; serial — no codegen), staff-shell `toolRegistry.ts` | — | 5 | M |
| 07 Cut to Fake provider (composition-root edge) | `ServiceCollectionExtensions.cs` (composition root — **orchestrator-owned**, not builder-assignable) | 03, 05, generation-infra `AddEngineGeneration` | — | 6a (orchestrator) | S |
| 07 Cut to Fake provider (backend routes + settings) | new cut-state registry, `EngineReviewEndpoints.cs`/`Service.cs` (two new routes), `EngineSettingsContracts.cs` (additive field), telemetry vocab (pending #173) | 6a's selector/decorator seam, 05's `EngineSettingsDto`/role gate | — | 6b | M |
| 07 Cut to Fake provider (console toggle) | edits to `EngineSettingsPanel.tsx`/`useEngineSettings.ts` (adds the cut/restore control) | 6b's contract (serial — no codegen), 06's await-then-apply hook | — | 7 | S |

Levels first (01). Auto-HOLD (02) + kill switch (03) are the two safety controls (wave 2). The
workload contract (04) sits on top and is verified by the eval harness. All integrate with the
already-built cockpit + world-steering — those are contract seams, not rebuilds. **05/06 are a later,
separately-scheduled wave** (audit follow-up, not part of the original four): 05 is backend-only
against the already-shipped `EngineReviewService`/`EngineAutonomyRegistry`, so it can run once those
are stable; 06 is a strict frontend-after-backend serial edge onto 05's contract (the settings
GET/POST shape), consistent with "no codegen — the contract is the seam." **07 is a further,
separately-scheduled wave**, split into three serial edges because its first slice is a composition-
root change: 6a (the `AddEngineGeneration` selector/decorator that makes both the real and Fake
providers coexist) is called out for explicit orchestrator sign-off before any builder wave touches
it, exactly as the playbook requires for composition-root edits; 6b (the routes + settings field) can
only be built once 6a's seam exists; 7 (the console toggle) is a strict frontend-after-backend serial
edge onto 6b's contract, mirroring 06's own relationship to 05.
