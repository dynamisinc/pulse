# Implementation: World steering

> Staff-world levers over the E2 world + the E8 engine + the exercise clock. Several stories carry
> safety-critical D5 amendments (Break Fiction, tiered pause, dial target). Backend not present —
> steering endpoints + the real-time broadcast are the serial contract seam; mock now.

> **Phase 0 reconciliation (done, this pass — Wave 1 = stories 02/03 only).** Checked against the
> FROZEN backend contracts (`Pulse.Core/Features/Storylines/Models/Storyline.cs`,
> `StorylinePhase.cs`, `Services/StorylineBriefProjection.cs`) and the SHIPPED E7 seams: `@/core/clock`
> (`IExerciseClock`, `getExerciseClock`/`setExerciseClock`/`resetExerciseClock`), the `staff-shell`
> `StaffHeader.tsx` state pill, `ControllerConsole.tsx`'s work-area layout, `@/core/telemetry`'s
> `steering_action` vocabulary (already reserved in `KNOWN_TELEMETRY_EVENT_TYPES`), and
> `@/features/participant-shell`'s `OverlayLayer/overlayState.ts` seam (which explicitly defers its
> trigger to this feature). Stories 01/04/05/06 are **not** reconciled this pass — their file
> ownership/reuse notes below are retained unchanged from the prior draft for planning continuity
> only; they are **out of the Wave-1 file-footprint plan**.
>
> **The one real reconciliation point.** `@/core/clock`'s `IExerciseClock` has no pause primitive —
> only `scenarioNow()` + optional `subscribe()`. Story 03 (tiered pause) owns a small, feature-local
> **pausable exercise clock** (`features/controller/services/pausableExerciseClock.ts`) that
> implements `IExerciseClock` and is installed via the SHIPPED `setExerciseClock()` on Freeze. On
> Resume it STAYS installed and its `resume()` is called (folding the frozen span into an
> accumulated-frozen offset) so scenario time continues with **none lost** — resetting to the
> wall-mirroring default would instead jump scenario time forward by the frozen span. This is the
> mock stand-in for story-01's native pause-aware clock provider (deferred) /
> the backend reaction-loop pause (`BACKEND_ROADMAP` B3) — the later flip swaps which `IExerciseClock`
> is installed, a contract-only change with no consumer edits (`useScenarioTime` already
> polls+subscribes generically). See story 03's Technical Notes for the full mechanics and the safety
> invariant (clock stops on Freeze, and ONLY on Freeze).

## Per-story tech notes

| Story | Approach | Key files (owns) | Exports (that others import) |
|-------|----------|------------------|------------------------------|
| 02 Escalation dial — **Wave 1** | One track (actual fill + target tick), click/drag/keyboard to set target. Actual + phase are read from a TS mock storyline store that mirrors `Storyline.cs` field-for-field (`Intensity` int 0–100, `TargetIntensity` int?, `Phase` label UPPERCASE per `StorylineBriefProjection.PhaseLabel`, `Sentiment` −1..1 carried for future reuse). `useStorylineTarget()` calls the mock's `SetTargetIntensity`-equivalent, logs a `steering_action` telemetry event, and exposes the target for the (deferred, Phase 2) engine-follows-target loop. | `features/controller/components/steering/EscalationDial.tsx`, `features/controller/hooks/useStorylineTarget.ts`, `features/controller/services/storylineMock.ts` | `useStorylineTarget()`, `<EscalationDial>`, the mirrored `StorylineActual`/`StorylinePhaseLabel` types |
| 03 Tiered pause — **Wave 1** | A 4-state pause machine — `running` (unpaused) / `injects` / `engine` / `freeze` (the `PauseTier` union; displayed as RUNNING / INJECTS PAUSED / ENGINE PAUSED / WORLD FROZEN) — exposed by `usePauseState()`. Freeze installs `pausableExerciseClock` via `setExerciseClock()` (see the DECISION above) so the header SCENARIO clock stops; every other tier leaves the clock untouched. `<PausePill>` renders the four labels (dot + text, NFR-001). Each tier change logs a `steering_action` telemetry event. Exposes an overlay-register selection (in-fiction/out-of-fiction) as a seam for `participant-shell`'s (deferred) trigger wiring — this story does not call `overlayState` itself. | `features/controller/hooks/usePauseState.ts`, `features/controller/components/steering/PausePill.tsx`, `features/controller/services/pausableExerciseClock.ts` | `usePauseState()` (the primitive; `DraftTimerDriver`/inject-queue/`OverlayLayer` consumers are deferred — this exposes the seam only), `<PausePill>` |
| 01 Attention levers *(deferred)* | Thin controls over E2 suggested-follows / notifications / trend weight. | `features/controller/components/steering/AttentionLevers.tsx`, `services/steeringActions.ts` | `setSuggestedFollows()`, `flagAsAlert()`, `boostTrend()` |
| 04 Break Fiction *(deferred)* | Guarded/latched Director control + type-to-confirm + all-session broadcast + per-session log. | `features/controller/components/steering/BreakFiction.tsx`, `services/breakFiction.ts` | `<BreakFictionControl>` |
| 05 Takedown *(deferred)* | Staff takedown reusing E2 soft-delete + category + Director notify; replay honors it. | `features/controller/components/steering/TakedownAction.tsx`, `services/takedown.ts` | `takedownContent()` |
| 06 Off-platform marker *(deferred)* | Event write bound to a storyline/inject that satisfies expectations. | `features/controller/components/steering/OffPlatformMarker.tsx` | `markOffPlatformResponse()` |

## Reuse map

- **COBRA theme + `@/theme/styledComponents` + `CobraStyles`** (staff surface only) —
  `src/frontend/src/theme/`. Both Wave-1 stories are staff-world; no participant skin involved.
- **`@/core/clock` (SHIPPED) — the pausable-clock seam.** Story 03 imports `getExerciseClock`,
  `setExerciseClock`, `resetExerciseClock`, and the `IExerciseClock` type; it implements its own
  `pausableExerciseClock.ts` conforming to that interface. The dependency direction is one-way and
  legal: `features/controller` may import `@/core/clock`; `@/core/clock` must NOT import back into
  `features/controller` or any other feature (it stands alone, per its own module header).
  `setExerciseClock()` is documented "not for production" — this is precisely its sanctioned mock
  use until story 01's native pause-aware provider lands (see the DECISION note above).
- **`@/core/telemetry`'s `buildAndEmit` (SHIPPED, XC-004 v0)** — every steering action (dial target
  change, pause-tier change) emits `eventType: 'steering_action'` (already reserved in
  `KNOWN_TELEMETRY_EVENT_TYPES`), `channel: 'system'`, `actor: { kind: 'system', actingHumanId, role
  }` sourced from `useControllerIdentity()`, `target: { entityType: 'storyline' | 'exercise',
  entityId }`, `payload` carrying the action detail. This mirrors
  `features/controller/engine/services/reviewActions.ts`'s `emitReviewed()` shape (same
  `buildAndEmit` call pattern, same `channel: 'system'`) — steering actions are controller/system
  actions on world state, not persona-authored content, so `actor.kind: 'system'` (not `'engine'`,
  which is reserved for engine-authored content/decisions).
- **`@/core/exerciseContext`'s `useExerciseContext()` (SHIPPED)** — `exerciseId`/`timeZone` are
  STAMPING-ONLY (COR-001) on the mock storyline store and every telemetry event; never a
  client-supplied query-scoping parameter.
- **`@/core/auth`'s `useRole()` (SHIPPED)** — gates both surfaces to staff roles (XC-002). Freeze's
  guard in Wave 1 is a **deliberate confirm step** (per D5 "Pause popover": 3 radio tiers, Freeze
  styled amber, Cancel/Pause), **not** a Director role-gate — Break Fiction (story 04, deferred) owns
  the Director-gate pattern; do not invent one for Freeze here.
- **`useControllerIdentity()` (SHIPPED, `@/features/controller/identity/controllerIdentity`)** —
  supplies `actingHumanId`/`role`/`callSign` for both stories' telemetry actor and (story 02) the
  target-change attribution.
- **The FROZEN `Storyline` contract (`Pulse.Core/Features/Storylines/Models/Storyline.cs`)** —
  story 02's `storylineMock.ts` mirrors it field-for-field: `Intensity` (int, 0–100, clamped),
  `TargetIntensity` (int?, null = unset), `Phase` (mirrors `StorylinePhase` — Dormant/Seeded/
  Escalating/Peak/Addressed/Decaying/Resolved), phase LABEL uppercased per
  `StorylineBriefProjection.PhaseLabel`. `SetTargetIntensity`'s detail-string convention (`"78 → 60"`,
  `"none → 60"`) is mirrored in the mock's telemetry payload.
- **Integration seam (orchestrator-owned, like `App.tsx` — NOT a story here).**
  - `StaffHeader.tsx`'s state pill: at integration, the pill's label is driven by `usePauseState()`
    (INJECTS PAUSED / ENGINE PAUSED / WORLD FROZEN), overriding the `STATE_PILL_CONFIG[status]` label
    while paused; `running` leaves the existing RUNNING/LIVE/STAGED/etc. behavior untouched. Story 03
    builders do NOT edit `StaffHeader.tsx` — they only build `usePauseState()`/`<PausePill>` to the
    contract the orchestrator wires in.
  - `ControllerConsole.tsx`'s main content region (the `flex: 1` Box left of the 336px review-queue
    column, NOT that column) is where `<EscalationDial>` mounts at integration. **Contract note /
    resolved mismatch:** the D5 design brief places the actual+target intensity bar inside the
    toolstrip's consult-on-demand **"Stories" flyout** (a storyline-board card list, D5-016/017);
    the shipped `ControllerConsole.tsx` has no Stories flyout yet. For Wave 1, `<EscalationDial>` is
    built as a container-agnostic widget (it does not assume a flyout vs. inline mount) so it can be
    re-parented into the future Stories flyout with no rework; the orchestrator's interim integration
    step mounts it directly in the work-area's `flex: 1` region for this wave. Story 02 builders do
    NOT edit `ControllerConsole.tsx` — they only build `<EscalationDial>`/`useStorylineTarget()` to a
    props/hook contract the orchestrator wires in.
- **Deferred, not touched this wave:** E2 mechanisms (SOC-041/053/072, SOC-005/XC-010) for stories
  01/05; the real-time broadcast host (SignalR) + Director role for story 04; E8 escalation profiles
  (ADP-010) for the dial's Phase-2 follow loop; E8 expectations + E10 sink for story 06;
  `participant-shell`'s `OverlayLayer`/`overlayState.ts` consumer wiring for story 03's
  in-fiction/out-of-fiction register (that seam's module header explicitly names this feature as the
  owner of the trigger — not built this pass).

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 03 Tiered pause | `features/controller/hooks/usePauseState.ts`, `features/controller/components/steering/PausePill.tsx`, `features/controller/services/pausableExerciseClock.ts` | shipped `@/core/clock` (`setExerciseClock` seam), `@/core/telemetry`, `useControllerIdentity()` | 02 | 1 | M |
| 02 Escalation dial | `features/controller/components/steering/EscalationDial.tsx`, `features/controller/hooks/useStorylineTarget.ts`, `features/controller/services/storylineMock.ts` | shipped `@/core/telemetry`, `useControllerIdentity()`, `useExerciseContext()` (self-contained mock otherwise) | 03 | 1 | M |
| — Integration seam (orchestrator) | `StaffHeader.tsx` (state-pill wiring), `ControllerConsole.tsx` (dial mount) | 02, 03 | — | 2 (serial, not a builder wave) | S |
| 01 Attention levers *(deferred)* | `AttentionLevers.tsx`, `steeringActions.ts` | E2 SOC-041/053/072 | — | deferred | M |
| 05 Takedown *(deferred)* | `TakedownAction.tsx`, `takedown.ts` | E2 soft-delete; E10 replay filter | 06 | deferred | M |
| 06 Off-platform marker *(deferred)* | `OffPlatformMarker.tsx` | E8 expectations; E10 sink | 05 | deferred | S |
| 04 Break Fiction *(deferred)* | `BreakFiction.tsx`, `breakFiction.ts` | 03 (Freeze); SignalR broadcast host (B1); Director role (B2) | — | deferred | L |

Stories 02 and 03 are file-disjoint (`steering/EscalationDial.tsx` vs. `steering/PausePill.tsx`;
`hooks/useStorylineTarget.ts` vs. `hooks/usePauseState.ts`; `services/storylineMock.ts` vs.
`services/pausableExerciseClock.ts`) and have no import relationship between them — they build in
parallel in Wave 1. Docking either into the shipped shell (`StaffHeader.tsx`/`ControllerConsole.tsx`)
is a serial, orchestrator-owned integration step after both land, mirroring the `App.tsx`
composition-root rule used elsewhere in E7.
