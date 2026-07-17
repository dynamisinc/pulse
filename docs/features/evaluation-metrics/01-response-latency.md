# Story: Response latency with evidence-level chip

**Feature:** Response, coverage, reach & sentiment metrics  ·  **Epic:** E10  ·  **Phase:** 4  ·  **Status:** Not Started
**Requirements:** EVL-010, CTL-026  ·  **Design decisions:** D6-009  ·  **Issue:** #225

## Context
EVL-010 measures, for each storyline/inject with an expected response, emergence → first official
acknowledgment → substantive response (posts and/or releases, **including off-platform responses
recorded via CTL-026**), in both wall and scenario time; approval-gate latency (PRS-021) is measured
separately when that gate is enabled. D6-009 is the concrete UI resolution for this metric's
epistemic-honesty problem: every latency row carries an **evidence-level chip** — **PERSON-LEVEL**
(navy, tooltip naming the human per COR-018) vs **SESSION-LEVEL** (gray, "no individual identified")
— "at chip weight, not footnote weight." See `docs/10-evaluation-aar.md` F10.2 and `feature.md`.

## Acceptance Criteria
- [ ] Given a storyline/inject with an expected response, when the Response Latency table renders
      its row, then it shows the prompt (with its own timestamp), the first official response (or
      "No counter-messaging observed" when none exists), and the latency as both a bar and a labeled
      duration — per the reference DOM's `latRows` anatomy (EVL-010).
- [ ] Given a response that was logged as off-platform (CTL-026), when it satisfies a prompt's
      latency row, then the row's response cell carries a "☎ OFF-PLATFORM · CTL-026" badge and
      counts toward the measured latency exactly as an on-platform response would — per D6-009's
      chip context and CTL-026's "annotates E10 latency/coverage metrics so the AAR never reports a
      false unaddressed."
- [ ] Given a latency row, when it renders, then it carries an evidence-level chip — **PERSON-LEVEL**
      (navy, tooltip naming the responsible human per COR-018) when attributable to a named
      individual/persona action, or **SESSION-LEVEL** (gray, "no individual identified") otherwise —
      per D6-009.
- [ ] Given an exercise with the approval gate enabled (PRS-021), when a gated storyline's latency is
      computed, then approval-gate latency is measured and displayed as a figure separate from the
      emergence-to-response latency (EVL-010), never folded into one number.
- [ ] Given a latency row, when its timestamps are available, then both wall-clock and scenario-time
      values exist for evaluator use (EVL-010's "in wall and scenario time"); this is a staff-only
      chart so COR-053's participant-visible-time rule does not apply, but the dual-time pairing
      itself is required.
- [ ] Isolation (XC-001): latency rows are computed only from the evaluator's own exercise's
      telemetry; cross-exercise leakage is covered by the standing isolation suite.
- [ ] Accessibility (NFR-001): the evidence-level and off-platform chips carry text labels, never
      color-only; the latency bar pairs color with a numeric label.

## Out of Scope
The coverage/missed-opportunities workflow (story 02); the sentiment/dial overlay (story 03);
computing the off-platform marker itself (owned by `world-steering`, E7 — this story only consumes
it).

## Technical Notes
Staff world; `features/evaluator/components/metrics/LatencyTable.tsx`, `hooks/useLatencyRows.ts`.
The evidence-level chip is a shared `EvidenceLevelChip` component reused by story 03's chart headers
— build it once here. Mock data behind the shared axios client until the backend
latency-aggregation contract exists. See `implementation.md`.

## Dependencies
`evaluation-timeline` (the event stream feeding emergence/response detection); `world-steering`'s
off-platform marker (CTL-026) and Press Room's approval-gate data (PRS-021, Phase 3 — degrade
gracefully to "not enabled" when the gate doesn't exist yet for this exercise).

## Tests
- Component (RTL): off-platform badge renders and counts toward the displayed latency.
- Unit: evidence-level derivation (person- vs session-level) from the underlying action record.
- Component (RTL): approval-gate latency renders as a separate figure when PRS-021 is enabled.
