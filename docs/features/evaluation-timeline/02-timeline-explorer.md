# Story: Timeline explorer (filters, per-human attribution, deep-link)

**Feature:** Evaluation timeline & replay foundation  ·  **Epic:** E10  ·  **Phase:** 4  ·  **Status:** Not Started
**Requirements:** EVL-001, EVL-002, COR-018, CTL-026  ·  **Design decisions:** D6-004  ·  **Issue:** #231

## Context
EVL-001 wants a complete, ordered exercise timeline of every information-environment event — content
published, participant/persona actions (attributed to the individual human incl. behind shared org
accounts, COR-018), controller actions, engine actions, alerts, and storyline state changes — each
with dual time and actor. EVL-002 makes it filterable (channel, actor, origin, storyline, hashtag,
time range) and searchable, with every item deep-linking to the content in-situ. D6-004 is the
concrete anatomy: chip filters for CHANNEL / ORIGIN / STORYLINE / RANGE plus an actor/handle search,
working live on the event list; rows behind shared org accounts carry a visible (not hover) "⌨ D.
Reyes" attribution chip; off-platform responses (CTL-026) appear as first-class rows tagged
"☎ OFF-PLATFORM · CTL-026"; and every row's "View in situ →" deep-links into Replay at that scenario
moment. See `docs/10-evaluation-aar.md` F10.1 and `feature.md`.

## Acceptance Criteria
- [ ] Given the Timeline view, when it loads, then it lists every information-environment event —
      content on any channel, participant/persona actions (incl. attributed shared-org-account
      actions), controller actions (fire/steer/veto/takedown/off-platform marker), engine actions,
      alerts, and storyline state changes — each row showing dual time (scenario time primary) and
      actor, ordered chronologically (EVL-001).
- [ ] Given the Timeline view, when the evaluator applies the CHANNEL / ORIGIN / STORYLINE / RANGE
      chip filters or types an actor/handle query, then the row list narrows live and the event
      count reflects the filtered set — per D6-004's chip-filter anatomy.
- [ ] Given a row for an action taken behind a shared org account, when it renders, then it carries
      a visible, non-hover "⌨ {human name}" attribution chip naming the individual behind the
      handle — per D6-004 and COR-018 ("every action behind a shared handle records the individual
      human in telemetry").
- [ ] Given a controller logged an off-platform response (CTL-026), when the Timeline renders that
      event, then it appears as a first-class row tagged "☎ OFF-PLATFORM · CTL-026" with its own
      OFF-PLATFORM channel styling, not a footnote on another row — per D6-004.
- [ ] Given any timeline row, when the evaluator clicks "View in situ →", then the app navigates to
      the Replay view with the playhead set to that row's scenario moment (and the relevant channel
      selected) — the deep-link contract of EVL-002, built per D6-004.
- [ ] Isolation (XC-001/COR-001): timeline events are scoped to the evaluator's exercise; a
      cross-exercise query returns 403/404 and is covered by the standing isolation suite.
- [ ] Scenario time (COR-053): each row's primary displayed time is scenario time in the exercise's
      configured time zone; wall-clock is retained as telemetry (XC-004) but is not the row's
      primary display.
- [ ] Accessibility (NFR-001): channel/origin chips carry text labels (never color-only); the filter
      row and event rows are keyboard-operable and screen-reader labelled.

## Out of Scope
The Replay player itself (story 03 — this story only sets its entry point); computed
response-latency/coverage metrics (`evaluation-metrics` feature) — this story surfaces raw timeline
rows and their filters only.

## Technical Notes
Staff world; `features/evaluator/components/timeline/` (`TimelineExplorer.tsx`, `FilterChips.tsx`,
`TimelineRow.tsx`). Shares its row renderer with the Live view's stream (`evaluator-tools/01`) so the
two never drift in anatomy. "View in situ" sets the Replay route's playhead/channel state consumed by
story 03. React Query against a (future) timeline-events endpoint; mock data behind the shared axios
client until the backend contract exists. MUI 9 `sx`-only; FontAwesome icons. See `implementation.md`.

## Dependencies
Story 01 (staff-only shell); E1 telemetry (`XC-004`); `world-steering`'s off-platform marker
(CTL-026, E7) as an event source.

## Tests
- Component (RTL): filter-chip narrowing test (channel/origin/storyline/range + actor search).
- Component (RTL): attribution-chip visibility test (asserts always-visible, not hover-gated).
- Component (RTL): off-platform row tagging test.
- Integration: "View in situ" navigation sets Replay's playhead/channel correctly.
