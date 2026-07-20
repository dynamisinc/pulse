# Story: Timed-draft expiry auto-HOLDs (never auto-sends)

**Feature:** Engine review cockpit  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** ADP-040  ·  **Design decisions:** D5-014/1.1 (supersedes D5-005)  ·  **Issue:** #35

## Context
Safety-critical. When a delayed/timed engine draft's countdown expires without a controller decision,
it must **auto-HOLD**, not auto-send. The D5 review reversed the original "inaction = approval"
behavior: **silence is never approval.** An expired draft holds ("timer expired — held for you") and
surfaces in the NEEDS-YOU bar for an explicit decision.

> **Amendment (D5-014/1.1, supersedes D5-005).** Before: expired timed drafts auto-**send**. After:
> expired drafts **auto-HOLD** and surface in NEEDS YOU; auto-send exists only via swamped mode
> (story 03). Automation never escalates its own autonomy.

## Acceptance Criteria
- [x] Given a delayed/timed draft, when its countdown reaches zero **without** a controller decision,
      then the draft moves to **HELD** (not published) with a "timer expired — held for you" state.
- [x] The held-on-expiry draft appears in story 01's **inline pending/held indicator**
      (`useReviewQueue`) as an outstanding to-do — console-shell/02's NEEDS-YOU bar is not built yet
      and will surface it once it lands; it publishes only on an explicit later Approve.
- [x] **No draft is ever auto-published on timeout** in the default configuration (verified — the only
      path to timeout auto-send is swamped mode, story 03).
- [x] The expiry→HOLD transition is logged with its trigger/storyline (ADP-041/XC-004).
- [x] Countdown + expiry state are conveyed by text/number, not color alone (NFR-001).

## Out of Scope
Swamped-mode auto-send (story 03); the base queue actions (story 01); the engine's countdown
generation (E8, Phase 2 — mock the timer now).

## Technical Notes
Staff world (COBRA). `useDraftTimer` calls story 01's `autoHoldPolicy.decide()` (the TS mirror of the
backend `AutoHoldPolicy.Decide`) against the current scenario minute; the terminal action is HOLD
unless the caller passes `swampedMode: true` (an **input parameter**, not an import of story 03 — keeps
the two files disjoint). Held-on-expiry items feed story 01's `useReviewQueue()` inline indicator, not
`useToDos` (console-shell/02's NEEDS-YOU bar is not built yet). See implementation.md (story 02). Ticks
STORY-UPDATES.md §A **ADP-040** and §C RECONCILE (D5-005 superseded).

## Dependencies
Story 01 (queue + HELD state + inline indicator + `autoHoldPolicy`); story 03 (supplies the
`swampedMode` boolean — the only auto-send path). E8 timers (Phase 2). console-shell/02's NEEDS-YOU
bar is not built yet (will surface this state once it lands).

## Tests
Delivered — AC ↔ test mapping (`src/frontend/src/features/controller/engine/`):
- **AC1** (expiry with no decision → HELD, not published) → `hooks/useDraftTimer.test.ts`
  `useDraftTimer — expiry with no decision auto-HOLDS (default config)` › `'resolves Hold (never
  Publish), labels it "timer expired — held for you", and does not auto-send'`; also
  `services/autoHoldPolicy.test.ts` `'SILENCE IS NEVER APPROVAL: expired + no decision + not swamped →
  hold'`.
- **AC2** (held item surfaces in story 01's inline indicator, publishes only on later Approve) →
  `hooks/useDraftTimer.test.ts` `useDraftTimer — held-on-expiry marks the item as needing the
  controller` › `'feeds story 01\'s EngineReviewItem.needsController via the same frozen contract (not
  a re-derived copy)'`; cross-checked against `components/ReviewQueue.test.tsx`
  `'surfaces the single-source counts, including a sub-60s timer and a held item'` and `'marks the
  held item with a text label + priority border (never colour-only)'`.
- **AC3** (no auto-publish on timeout in default config; swamped mode is the only exception) →
  `hooks/useDraftTimer.test.ts` `useDraftTimer — swamped mode is the ONLY auto-send path` (all four
  cases) and `useDraftTimer — an explicit human decision is not a timeout transition`; plus
  `services/autoHoldPolicy.test.ts` `'a full stop holds everything, even a standing approval'`,
  `'an explicit approval publishes regardless of the countdown'`, `'an explicit veto holds regardless
  of the countdown'`, `'swamped mode is the ONLY auto-send: expired + no decision + swamped +
  Delayed-auto → publish'`, `'swamped mode still holds when a safety clamp lowered the level below
  Delayed-auto'`. Integration-level proof of the same guarantee under the real kill-switch/degrade
  composition: `console/DraftTimerDriver.test.tsx` `DraftTimerDriver — default config (swamped off):
  auto-HOLD, never publish` and `DraftTimerDriver — the clamp-suspends-swamped composition (REAL
  useEngineControl)` (STOP / Suggest-only / degraded-clamp all hold, never `autoPublish`).
- **AC4** (expiry→HOLD transition logged with trigger/storyline) → `hooks/useDraftTimer.test.ts`
  `useDraftTimer — expiry with no decision auto-HOLDS (default config)` › `'logs EXACTLY ONE
  engine.reviewed transition (action hold-on-expiry) with storyline + scenario time'`, and
  `useDraftTimer — the transition fires exactly once across ticks` › `'resolves + logs once even as
  the clock keeps ticking past expiry'`; policy-level coverage in `services/autoHoldPolicy.test.ts`
  `autoHoldPolicy.evaluate — transition event to log` (all four cases).
- **AC5** (countdown/expiry conveyed by text/number, not color alone) → `components/ReviewQueue.test.tsx`
  `'shows persona, storyline context, preview, and a text countdown; focus reveals A/V/E/R'` and
  `'marks the held item with a text label + priority border (never colour-only)'`.
- **Delegation guarantee** (the hook computes nothing itself — it defers to `autoHoldPolicy`) →
  `hooks/useDraftTimer.delegation.test.ts` `useDraftTimer — delegates to autoHoldPolicy.decide/evaluate
  (no re-derived copy)` (all three cases), plus the scenario-time-driven countdown mechanics in
  `hooks/useDraftTimer.test.ts` `useDraftTimer — counting down (not yet expired)` and `useDraftTimer —
  scenario-time countdown decreases as scenario minute advances`.
