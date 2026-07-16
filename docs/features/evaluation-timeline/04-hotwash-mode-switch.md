# Story: Hotwash mode switch (participant-visible replay)

**Feature:** Evaluation timeline & replay foundation  ·  **Epic:** E10  ·  **Phase:** 4  ·  **Status:** Not Started
**Requirements:** EVL-014 (hotwash-exclusion clause), EVL-033, COR-054  ·  **Design decisions:** D6-007  ·  **Issue:** —

## Context
**Design-introduced story (D6-007).** The epic asks (EVL-014) that engine/controller-dial overlays
be "evaluator-facing only and excluded from any participant-visible hotwash replay" — *don't show
trainees the puppet strings mid-lesson* — and (EVL-033) that replay + core metrics be available
≤15 minutes after EndEx so the hotwash can start ~30 minutes later, not the next morning. D6-007 is
the concrete mechanism the design introduced to satisfy both: **one explicit, deliberate segmented
switch** — `EVALUATOR VIEW ⇄ HOTWASH · PARTICIPANT-VISIBLE` — that lives in the Replay header.

This is split out of `03-replay-player` (which owns the player mechanics and honest-fidelity chrome)
because it is a distinct, safety-critical behavior: what the projector shows a room of trainees. The
switch is the single control that governs whether staff-only signal is on screen, so it earns its own
story, ACs, and test. The `hotwash` exercise state (post-EndEx, projector-in-30-min) opens the
dashboard directly into this mode.

## Acceptance Criteria
- [ ] Given the Replay view, when it renders, then a large two-state segmented control labeled
      "EVALUATOR VIEW ⇄ HOTWASH · PARTICIPANT-VISIBLE" is present in the header; the active side is
      encoded by word + position + color together (never color-only), so a presenter can read the
      current mode across the room — per D6-007 / NFR-001.
- [ ] Given Evaluator view is active, when the evaluator switches to Hotwash, then the control renders
      **amber-active**, the "ORDER EXACT · COUNTS ≈ SNAPSHOT" fidelity chip is swapped for a persistent
      "HOTWASH — STAFF OVERLAYS HIDDEN" tag, and the presenter always has an on-screen statement of
      what the projector is showing — per D6-007.
- [ ] Given Hotwash mode is active, when the replay track and stream render, then the staff lane
      (inject ▸ / controller-dial ◆ markers) and every per-post origin line are **absent from the DOM**,
      not grayed or hidden-via-CSS — satisfying EVL-014's participant-visible-hotwash exclusion so no
      dialed mood shift can be read as participant performance.
- [ ] Given Hotwash mode is active, when the evaluator switches back to Evaluator view, then it takes
      the same deliberate click — there is **no keyboard shortcut and no hover path** to the toggle —
      so a presenter never flips it by accident mid-hotwash (D6-007).
- [ ] Given the exercise state is `hotwash` (post-EndEx), when the dashboard opens, then it lands
      directly on the Replay view in Hotwash mode — the projector-in-30-min scenario D6-007 names.
- [ ] Given an exercise has just reached EndEx (COR-054), when the evaluator opens Replay and the core
      latency/coverage/sentiment metrics, then they are available within **15 minutes** — the EVL-033
      hotwash-latency target, verified here as the surface's readiness contract (the full AAR export
      job's own runtime is validated separately in `aar-export`).
- [ ] Accessibility (NFR-001): the segmented control is keyboard-operable and its two states are
      distinguishable without color (label text + selected position), and the mode tag carries text,
      not just the amber treatment.

## Out of Scope
The replay player mechanics, track lanes, and honest-fidelity chrome (owned by `03-replay-player`);
the dial-overlay vocabulary on the sentiment chart (`evaluation-metrics/03`); a fully facilitated,
standalone participant-visible hotwash *presentation* mode beyond this dashboard toggle (E10 §5 open
question 3 — "needs a controlled design pass"). Computing the ≤15-min readiness itself is a
backend/telemetry concern; this story verifies the surface honors it.

## Technical Notes
Staff world; `features/evaluator/components/replay/HotwashToggle.tsx` plus a `replayMode`
('eval' | 'hotwash') field on the evaluator runtime state that `ReplayPlayer`, `StaffLane`, and the
per-post origin rendering all read. In the reference DOM the mode is derived from the `hotwash`
exState and the `replayMode` state (`curMode()`); reimplement as real runtime state, not a demo prop.
The overlay-hiding must be **conditional rendering** (element not emitted), not visibility styling —
the test asserts absence from the DOM. See `implementation.md`.

## Dependencies
Story 03 (the replay player this toggle lives in and governs); the runtime `replayMode`/`exState`
state model; `evaluation-metrics/03` shares the dial-event vocabulary the hotwash mode suppresses.

## Tests
- Component (RTL): toggling to Hotwash swaps the fidelity chip for the "STAFF OVERLAYS HIDDEN" tag and
  removes the staff lane + origin lines **from the DOM** (queryBy… returns null), not merely hides them.
- Component (RTL): no `keydown` and no hover interaction changes the mode — only the explicit click does.
- Component (RTL): `exState = 'hotwash'` mounts the dashboard on Replay in Hotwash mode.
