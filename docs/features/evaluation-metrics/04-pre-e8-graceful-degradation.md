# Story: Pre-E8 graceful degradation

**Feature:** Response, coverage, reach & sentiment metrics  ·  **Epic:** E10  ·  **Phase:** 4  ·  **Status:** Not Started
**Requirements:** EVL-015  ·  **Design decisions:** D6-011  ·  **Issue:** #228

## Context
EVL-015 requires pre-E8 exercises to degrade gracefully: metrics that depend on engine constructs
(storylines, rumors, sentiment) compute from controller-tagged equivalents or are marked
unavailable — no fake numbers. **Design-introduced presentation pattern (flagged for the
reviewer):** D6-011 resolves the concrete UI beyond the bare epic text — in the `pre-e8` exercise
state, the storyline-board tile's intensity/sentiment rows (`evaluator-tools/01`) collapse to a
single dashed note "engine off — event-log signals only"; the sentiment chart (story 03) is replaced
by a dashed card stating nothing was synthesized; latency (story 01) and coverage (story 02) — both
event-log-derived — remain fully usable. The specific "dashed card" copy and tile-row collapse are
D6-011's contribution, not literal epic text. See `docs/10-evaluation-aar.md` F10.2 and `feature.md`.

## Acceptance Criteria
- [ ] Given an exercise that ran without the adaptive engine (pre-E8), when the Metrics view's
      Sentiment Trajectory section would normally render, then it is replaced by a dashed-bordered
      card stating "Engine metrics not available for this exercise... Nothing was synthesized in
      their place (EVL-015)" — per D6-011, no fake chart, no empty-chart shame.
- [ ] Given a pre-E8 exercise, when the Response Latency and Coverage tables render (stories 01/02),
      then they remain fully usable — both are event-log-derived, not engine-dependent — per
      D6-011's explicit carve-out.
- [ ] Given a pre-E8 exercise, when the Live storyline board tiles render (`evaluator-tools/01`),
      then the intensity bar and sentiment word/arrow rows are replaced by a single dashed note
      "engine off — event-log signals only (EVL-015)" rather than a zero or blank value.
- [ ] Given a pre-E8 exercise, when any metric that would depend on an engine construct (rumor
      spread, storyline auto-intensity) has no controller-tagged equivalent recorded, then it is
      marked unavailable rather than computed as zero or omitted silently — no fake numbers, per
      EVL-015's literal text.
- [ ] Accessibility (NFR-001): the "engine off" state is communicated as a text card/note, never a
      merely empty chart region a screen-reader user would perceive as broken.

## Out of Scope
Defining which controller-tagged equivalents substitute for which engine construct in a pre-E8
exercise (a per-metric modeling question resolved metric-by-metric as each is built — this story
only owns the presentation contract: unavailable-and-honest vs. faked).

## Technical Notes
Staff world; a shared `EngineOffCard` component and one exercise-level `engineEnabled: boolean` flag
(sourced from `exercise-configuration`/E8) gate all three render branches — story 03's chart,
`evaluator-tools/01`'s tiles, and any future engine-dependent metric — rather than three separate
implementations. See `implementation.md`.

## Dependencies
`exercise-configuration` (the flag indicating whether E8 is enabled for this exercise); story 03
(the chart it replaces); `evaluator-tools/01` (the tile rows it replaces).

## Tests
- Component (RTL): pre-E8 flag renders the dashed `EngineOffCard`, not the sentiment chart.
- Component (RTL): latency/coverage remain fully interactive under the pre-E8 flag.
- Unit: engine-dependent metrics render "unavailable," never a fabricated zero.
