# Story: Tiered pause (injects / engine / freeze)

**Feature:** World steering  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-023  ·  **Design decisions:** D5-014/1.3, D7-004 (pause/EndEx pages → `participant-shell`), D7-010 (state pill → `staff-shell` header)  ·  **Issue:** #26

## Context
"Pause" is not one thing. The D5 review **amended** CTL-023 into **three tiers** so a controller can
hold the right amount of the world: **Pause injects** (world keeps living), **Pause engine** (no new
AI content), **Freeze world** (guarded; participants notice; safety-stop only). The **scenario clock
stops only on Freeze**. Break Fiction (story 04) implies world-freeze.

> **Amendment (D5-014/1.3).** Before: single pause action. After: three tiers with a state pill
> (INJECTS PAUSED / ENGINE PAUSED / WORLD FROZEN); scenario clock stops only on Freeze; Freeze is
> guarded.
>
> **Amendment (D7-004 / D7-010).** The participant-facing **pause + EndEx pages** (in-fiction /
> out-of-fiction registers) are **rendered by `participant-shell`** (the overlay layer,
> `participant-shell/05-overlay-layer.md`). The **state pill** lives in the **`staff-shell` header**
> (`staff-shell/01`, D7-010) — the R-006 interim tag is **resolved**. **This story owns the control:**
> the tier state machine (Pause injects / Pause engine / Freeze), the guard on Freeze, the clock-stop-
> on-Freeze, and pushing `overlayState` for the shell to render.

> **Phase 0 reconciliation (done) — the clock-freeze mechanism.** `@/core/clock`'s `IExerciseClock`
> contract (SHIPPED, Wave-0 foundation seam) has **no pause primitive** — only `scenarioNow()` and an
> optional `subscribe()`. This story owns a small, feature-local **pausable exercise clock**
> (`features/controller/services/pausableExerciseClock.ts`), a second `IExerciseClock`
> implementation: it tracks accumulated-frozen wall-time via an offset — `scenarioNow()` returns
> `wallNow − accumulatedFrozenMs` while running, or the held freeze-instant while frozen — and
> implements `subscribe()` so `useScenarioTime` (which already polls + subscribes generically) re-
> reads promptly on a tier change. On **Freeze**, `usePauseState` installs it via the SHIPPED
> `setExerciseClock()` and notifies subscribers, so the `staff-shell` header's SCENARIO clock stops
> immediately; on **Resume**, it keeps advancing with no scenario time lost (the accumulated-frozen
> offset preserves the frozen span exactly). **Injects-paused and engine-paused never touch the
> clock** — `scenarioNow()` keeps advancing under both. This is the mock stand-in for story 01's
> native pause-aware clock provider / the backend reaction-loop pause (`BACKEND_ROADMAP` B3); the
> later flip swaps which `IExerciseClock` is installed — a contract-only change, no consumer edits
> (`getExerciseClock()`/`setExerciseClock()`/`resetExerciseClock()` is documented "not for
> production" precisely because this is its sanctioned mock use until then). The dependency
> direction stays one-way and legal: `features/controller` imports `@/core/clock`; `@/core/clock`
> must never import back into a feature.

## Acceptance Criteria
- [ ] Given the console, when no pause tier is active, then the pause state is **`running`** (the
      unpaused baseline) and the `staff-shell` header's existing RUNNING/LIVE state-pill behavior is
      untouched.
- [ ] Given the console, when the controller selects a pause tier, then the correct scope pauses —
      **Pause injects** halts queued inject/burst firing (world/engine keep running); **Pause
      engine** halts new E8 content (injects/world continue); **Freeze world** halts everything.
      Only one tier is active at a time; selecting a new tier (or Resume) replaces the prior one.
- [ ] `usePauseState()` exposes the active tier as INJECTS PAUSED / ENGINE PAUSED / WORLD FROZEN /
      RUNNING; `<PausePill>` renders it as **dot + text**, never color-only (NFR-001) — this is the
      tier state the `staff-shell` header state pill overrides its label with while paused
      (integration seam, orchestrator-owned; this story does not edit `StaffHeader.tsx`).
- [ ] The **scenario clock stops only on Freeze** (per the DECISION above, COR-050): `scenarioNow()`
      holds at the freeze instant while frozen and resumes with no time lost on Resume; under
      Pause-injects and Pause-engine, `scenarioNow()` keeps advancing exactly as when `running`.
- [ ] **Freeze is guarded** — selecting it requires a deliberate confirm step (per D5's "Pause
      popover": 3 radio tiers, Freeze styled amber, Cancel/Pause; the button reads "Resume" while
      paused) — because participants notice it. This is a confirm-step guard, **not** a Director
      role-gate (that pattern belongs to Break Fiction, story 04, deferred).
- [ ] `usePauseState()` exposes an **overlay-register selection** (`'in-fiction'` |
      `'out-of-fiction'`) alongside the tier, as the seam `participant-shell`'s (deferred) trigger
      wiring will read — this story does not call `OverlayLayer/overlayState.ts` itself; it only
      exposes the value.
- [ ] Each tier change (including the transition back to `running`) emits a `steering_action`
      telemetry event (XC-004) — `channel: 'system'`, `actor: { kind: 'system', actingHumanId, role
      }`, `target: { entityType: 'exercise', entityId }`, `payload` naming the tier transition — and
      is scoped to the active exercise (COR-001) and staff-only (XC-002).
- [ ] The tier control is **fully keyboard-operable** (NFR-001) — tab to each tier option, activate
      with Enter/Space, and the Freeze confirm step is reachable and dismissable by keyboard alone.

## Out of Scope
Break Fiction (story 04, which implies Freeze); the exercise-clock's native/production mechanics
(E1 COR-050 — this story's `pausableExerciseClock` is an explicitly-mock stand-in); the holding-page
content authoring (E1 lifecycle COR-032); **wiring the seam's consumers** — `DraftTimerDriver`/
inject-queue reading `usePauseState()` to actually suspend bursts/timers, and
`participant-shell`'s `OverlayLayer` reading the overlay-register selection to render the pause/EndEx
page, are both **deferred**; this story exposes the primitives only. Mounting `<PausePill>` into
`StaffHeader.tsx` (orchestrator-owned integration seam).

## Technical Notes
Staff world (COBRA). Owns `features/controller/hooks/usePauseState.ts`,
`features/controller/components/steering/PausePill.tsx`, and
`features/controller/services/pausableExerciseClock.ts` (kept disjoint from story 02's
`storylineMock.ts`/`useStorylineTarget.ts`/`EscalationDial.tsx`). `usePauseState()` is the primitive
other surfaces will read once built — `DraftTimerDriver` (engine-review-cockpit) and inject-queue's
burst-suspend/jump-gating are documented follow-ups, not built here. See `implementation.md`
(story 03) for the pausable-clock mechanics, the reuse map, and the Wave Plan.

## Dependencies
`@/core/clock` (shipped `IExerciseClock`/`setExerciseClock`/`resetExerciseClock` seam),
`useControllerIdentity()` and `@/core/telemetry` (both shipped) for attribution/logging. Deferred
follow-ups (not blocking this story): inject-queue (bursts/jump reading pause), engine-review-cockpit
(`DraftTimerDriver` suspending on Pause engine/Freeze), `participant-shell`'s `OverlayLayer` (reading
the register to render the pause/EndEx page). The orchestrator-owned mount into `StaffHeader.tsx`
lands after this story and story 02 both merge. Ticks STORY-UPDATES.md §A **CTL-023**.

## Tests
- Unit: each tier pauses the correct scope (tier value only — suspension of injects/engine content is
  a deferred consumer concern, not exercised here); only Freeze changes `scenarioNow()`'s behavior.
- Unit: Freeze installs the pausable clock (via `setExerciseClock`) such that `scenarioNow()` holds
  at a fixed instant across repeated calls; Resume restores advancement with the frozen span
  preserved (no scenario time lost) — assert via the accumulated-offset math, not wall-clock timing.
- Unit: Pause injects and Pause engine leave `scenarioNow()` advancing identically to `running`.
- Unit: each tier transition (including back to `running`) emits exactly one `steering_action`
  telemetry event with the correct actor/target/payload.
- Component (RTL): `<PausePill>` shows the active tier with text+icon (not color-only); selecting
  Freeze requires an explicit confirm step before the tier takes effect; the control is operable via
  keyboard alone (tab/Enter/Space).
