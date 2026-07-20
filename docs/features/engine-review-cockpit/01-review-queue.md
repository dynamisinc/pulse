# Story: Engine review queue

**Feature:** Engine review cockpit  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** ADP-040  ·  **Design decisions:** none  ·  **Issue:** #34

## Context
The cockpit the adaptive engine (E8, Phase 2) lands into. A review queue of suggested/delayed content
with **approve / edit / veto / re-roll** actions, **batch approve**, and per-item **persona +
storyline context** (ADP-040). It **ships in Phase 1** (engine-first, CTL-022) so the engine arrives
to a ready surface; in Phase 1 it is exercised with mock drafts.

## Acceptance Criteria
- [x] Given engine-drafted (or mock) content, when the console renders the review queue, then each
      item shows its **persona** and **storyline** context and offers **approve / edit / veto /
      re-roll**.
- [x] **Batch approve** applies to a multi-select and reports per-item outcome.
- [x] Approve publishes the draft through the normal channel pipeline (E2) authored by its persona;
      edited drafts are sanitized before publish (NFR-004); veto discards; re-roll requests a new draft.
- [x] The queue is a **continuous-watch** rail surface (console-shell) and exposes its own **inline
      pending/held count** ("N need review / N timers <60s") as the single D5-014/2.1 source of truth;
      console-shell/02's NEEDS-YOU bar (not yet built) and the queue-pressure meter read from it once
      wired, rather than each recomputing it.
- [x] Every queue action is logged with its trigger + storyline (ADP-041/XC-004); the queue is
      staff-only (XC-002) and exercise-scoped (COR-001); keyboard-operable (NFR-001).

## Out of Scope
The engine that generates drafts (E8, Phase 2); the timeout/auto-HOLD behavior (story 02); swamped
mode (story 03); the kill switch (ADP-042, Phase 2).

## Technical Notes
Staff world (COBRA). Continuous-watch rail in console-shell. Approve/edit publishes via the E2 pipeline
(reuse). Pending/held count is this story's own `useReviewQueue()` hook — **not** `useToDos`
(console-shell/02's NEEDS-YOU bar is not built yet; it will consume this hook once it lands). See
implementation.md (story 01).

## Dependencies
console-shell (continuous-watch rail hosting — the permanent-column dock point in
`ControllerConsole`'s work area does not exist yet; wiring it is an orchestrator-owned integration
seam, not this story, see implementation.md); E2 publish pipeline; E8 drafts (Phase 2; mock now);
telemetry / engine-action log (ADP-041).

## Tests
Delivered — AC ↔ test mapping (`src/frontend/src/features/controller/engine/`):
- **AC1** (persona + storyline context, four actions) → `components/ReviewQueue.test.tsx`
  `ReviewQueue — card context + actions` › `'shows persona, storyline context, preview, and a text
  countdown; focus reveals A/V/E/R'`; keyboard actions covered by `ReviewQueue — keyboard actions` ›
  `'approves the focused burst with A...'` / `'vetoes the focused burst with V...'` / `'re-rolls the
  focused burst with R...'` / `'↑ / ↓ move focus between cards (roving tabindex, NFR-001)'`.
- **AC2** (batch approve, per-item outcome) → `components/ReviewQueue.test.tsx`
  `ReviewQueue — batch approve` › `'reports the per-item outcome via the status region'`; and
  `services/reviewActions.test.ts` `describe('batchApprove')` › `'reports a per-item outcome, skipping
  already-resolved items'`.
- **AC3** (approve publishes via persona/E2, edit sanitizes NFR-004, veto discards, re-roll fresh
  draft) → `services/reviewActions.test.ts` `describe('approve')` › `'publishes the burst as its
  persona with origin engine + the approving controller'`; `describe('edit')` › `'publishes with the
  edited lead text (origin engine) and logs action edit'` and `'NEVER publishes an unsanitized edited
  draft: a stored-XSS payload is neutralized (NFR-004)'`; `describe('veto')` › `'marks the burst
  Vetoed, publishes nothing, and logs action veto'`; `describe('reroll')` › `'swaps in a fresh draft,
  resets a Delayed-auto item to counting down, publishes nothing'` and `'resets a Suggest item back to
  queued (no countdown)'`; also `components/ReviewQueue.test.tsx` `'opens the composer slot on E and
  routes the edited text back through the queue'`.
- **AC4** (inline pending/held count, single source of truth) → `components/ReviewQueue.test.tsx`
  `ReviewQueue — card context + actions` › `'surfaces the single-source counts, including a sub-60s
  timer and a held item'` and `'the header pendingCount/heldCount equal the number of rendered
  queued/held cards (D5-014/2.1)'`.
- **AC5** (logging, staff-only/exercise-scoped, keyboard-operable) → `services/reviewActions.test.ts`
  `describe('approve')` › `'logs engine.reviewed (approve) with storyline + trigger, plus the post
  event'` and `describe('published provenance never reaches a participant view (XC-002/SOC-003)')` ›
  `'toParticipantView strips origin, actingHumanId, createdWallClock, and injectId from an approved
  engine post'`; `services/reviewStore.test.ts` `'seeds mock bursts all stamped with the mock exercise
  id (COR-001)'`; keyboard operability re-covered under AC1 above.
- **Underlying policy/store units** → `services/autoHoldPolicy.test.ts` (`autoHoldPolicy.decide —
  precedence`, `autoHoldPolicy.evaluate — transition event to log`, `DelayedAutoCountdown —
  scenario-minute math`) and `services/reviewStore.test.ts` (`reviewStore — seeding & isolation`,
  `reviewStore — snapshot identity & mutation`, `reviewStore — subscription & reset`).
- **Docked-in-console coverage** → `components/ControllerConsole.engineDock.test.tsx`
  `'mounts the control strip + the docked queue alongside the existing console chrome'` and
  `'drives the seeded CountingDown items without crashing (one DraftTimerDriver each)'`.
