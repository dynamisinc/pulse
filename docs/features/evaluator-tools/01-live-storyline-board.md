# Story: Live storyline board

**Feature:** Live evaluator tools — storyline board & annotation capture  ·  **Epic:** E10  ·  **Phase:** 4  ·  **Status:** Not Started
**Requirements:** EVL-022, NFR-001  ·  **Design decisions:** D6-001  ·  **Issue:** #234

## Context
EVL-022 wants a live evaluator dashboard mirroring the controller's CTL-030 situational-awareness
board: storyline board, response-latency tickers, unaddressed-concern alerts. D6-001 is the concrete
**inversion of D5-019**: on the console, storylines earned only a badged toolstrip flyout because the
engine review queue is the decision surface — an evaluator has no queue, **the board IS the job**. So
it becomes the primary surface: four large tiles full-width at eye-top; live stream (left) + read-only
world view (right) below. **Tile hero = state × time-in-state** ("AMBER · 40 MIN", ~30px, 46px in
projector mode) — duration of neglect, not instantaneous intensity, is the across-the-room signal
(E10 §3's `#WaterIssues`-amber-for-40-minutes narrative). State is word + shape + color (● CALM /
▲ ELEVATED / ■ HOT), never color-only (NFR-001, the D5-009 heritage rule). Below the hero: intensity
bar, response-latency ticker ("No official post — 40m"), unaddressed-concern count, sentiment word +
arrow. Tile click → Timeline pre-filtered to that storyline. See `docs/10-evaluation-aar.md` F10.3
and `feature.md`.

## Acceptance Criteria
- [ ] Given the Live view, when it renders, then four storyline tiles occupy a full-width row at
      eye-top, each showing the storyline name, a state word+shape+color badge (● CALM / ▲ ELEVATED
      / ■ HOT), and a large hero readout of **state × time-in-state** ("AMBER · 40 MIN") — per
      D6-001.
- [ ] Given a tile in projector mode, when the surface is placed on a display for room-wide viewing,
      then the hero numeral scales to the larger projector size (~46px vs. ~30px) with no other
      layout change — per D6-001's `projector` runtime state.
- [ ] Given a tile's state badge, when it renders, then the state is conveyed by word + shape + color
      together, never color alone — per NFR-001/the D5-009 heritage rule.
- [ ] Given a tile, when it renders below the hero, then it shows an intensity bar (when the engine
      is enabled — `evaluation-metrics/04` owns the pre-E8 fallback), a response-latency line (e.g.
      "No official post — 40m"), an unaddressed-concern count, and a sentiment word + arrow — per
      D6-001's full tile anatomy.
- [ ] Given a storyline tile, when the evaluator clicks it, then the app navigates to the Timeline
      view pre-filtered to that storyline — per D6-001's "tile click → Timeline pre-filtered."
- [ ] Given the Live view's stream and world-view panels, when they render below the tile row, then
      the live stream sits left (everything entering the world, newest first, with a ⚑/B bookmark
      affordance on each item) and the read-only world view sits right (participant surfaces
      rendered live, channel-tabbed) — matching the reference DOM's Live-view layout.
- [ ] Accessibility (NFR-001): tile state, hero, and every ticker line are readable by a screen
      reader as text (never conveyed by bar height/color alone); the tile row is keyboard-navigable
      to support the click-through to Timeline.

## Out of Scope
The annotation ⚑/B capture flow itself (story 02); the intensity/sentiment computation
(`evaluation-metrics`); the read-only world-view stage's full replay fidelity chrome (that is
Replay's job, `evaluation-timeline/03` — this live view is a simpler "now" render, not a scrubbable
reconstruction).

## Technical Notes
Staff world; `features/evaluator/components/live/StorylineBoard.tsx`, `LiveStream.tsx`,
`WorldViewPanel.tsx`. Reuses the D1/D2 participant skins for the read-only world view — the same
reuse as `evaluation-timeline/03`'s replay stage, at lower fidelity ("now," not scrubbable).
`projector` is a real runtime display-mode toggle (shell/settings-level), not a demo prop, per the
handoff README's "Demo states are component props... implement as real runtime states." See
`implementation.md`.

## Dependencies
`evaluation-timeline` (the Timeline pre-filter target for tile click; the live stream shares its row
renderer with Timeline's rows); `evaluation-metrics` (intensity/latency/concern/sentiment figures)
and its story 04 pre-E8 fallback.

## Tests
- Component (RTL): hero renders state × time-in-state, scales in projector mode.
- Component (RTL): word+shape+color assertion (never color-only) on the state badge.
- Integration: tile click navigates to Timeline pre-filtered to that storyline.
