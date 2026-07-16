# Story: Misinformation spread tree

**Feature:** Response, coverage, reach & sentiment metrics  ·  **Epic:** E10  ·  **Phase:** 4  ·  **Status:** Not Started · deferred: design pass pending
**Requirements:** EVL-013  ·  **Design decisions:** none — deferred, metrics-v2 design pass  ·  **Issue:** —

## Context
EVL-013 calls for per-rumor (ADP-032) spread-tree size/velocity, time-to-counter, and
post-counter-decay visualization. Per `DECISIONS.md`'s "D6 open / deferred" note: **"Misinformation
spread tree (EVL-013) — rumor reach shows in coverage rows; the tree visualization is a metrics-v2
pass."** No D6 decision resolves the tree's visual anatomy — **this story is a placeholder
documenting what a future design pass must resolve, not a buildable spec.**

In the interim, rumor evidence is not entirely absent: the Coverage list (`02-coverage-provisional-
confirm.md`) already surfaces rumor reach as a coverage row (the reference DOM's `c1` row: `"Toxic
spill" rumor never countered on Pulse` — reach ≈2.1k accounts, no correction posted). The tree is
additive evidence depth, not a blocker for basic rumor evidence reaching the AAR.

## Acceptance Criteria
- [ ] (Design-blocked) A per-rumor spread-tree visualization (size/velocity, time-to-counter,
      post-counter decay) exists once a metrics-v2 design pass resolves its visual anatomy — no D6
      decision covers this yet.
- [ ] Until then, rumor evidence remains available via the Coverage list (`EVL-011`/story 02) — a
      rumor's reach and counter status show as a coverage row; this story is not a blocker for that.
- [ ] When a design pass lands, this story is re-specified with concrete D-series decision
      citation(s) before it is built — do not build ad hoc anatomy against the bare epic text alone.

## Out of Scope
Everything except tracking the gap. No implementation happens in this pass.

## Technical Notes
Not applicable — placeholder. When unblocked: staff world,
`features/evaluator/components/metrics/RumorSpreadTree.tsx` (name reserved, not created).

## Dependencies
A metrics-v2 design pass (tracked as an open design question, not a DAG dependency — this story is
out-of-wave; see `implementation.md`).

## Tests
None — placeholder story.
