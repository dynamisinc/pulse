# Story: Reach & sentiment trajectory with controller-dial overlay

**Feature:** Response, coverage, reach & sentiment metrics  ·  **Epic:** E10  ·  **Phase:** 4  ·  **Status:** Not Started
**Requirements:** EVL-012, EVL-014  ·  **Design decisions:** D6-008, D6-009  ·  **Issue:** —

## Context
EVL-012 (reach & traction) computes impressions/engagement/amplification for official content over
the audience-magnitude model (SOC-054), answering "did the message land or get drowned out?";
view/dwell-derived metrics are labeled **session-level evidence, not person-level proof**. EVL-014
(sentiment trajectory) overlays participant actions and — critically — controller dial events as a
visually distinct "scenario design input" layer, so an evaluator never misattributes a dialed mood
shift to participant performance; these overlays are **evaluator-facing only**, excluded from
participant-visible hotwash (enforced by `evaluation-timeline/03`'s hotwash toggle). D6-008 is the
"one vocabulary everywhere" answer: amber ◆ + "scenario design input — not participant behavior"
copy, appearing as distinct amber stream rows on Live (`evaluator-tools/01`), STAFF-channel rows on
Timeline (`evaluation-timeline/02`), the staff lane on the replay track (`evaluation-timeline/03`),
and dashed-line ◆ markers + a legend banner on this sentiment chart. D6-009 (the evidence-level chip)
also applies to chart headers here, not only latency rows. See `docs/10-evaluation-aar.md` F10.2 and
`feature.md`.

## Acceptance Criteria
- [ ] Given the Sentiment Trajectory chart, when it renders, then it plots the aggregate sentiment
      line over scenario time with a session-level evidence chip in the header ("SESSION-LEVEL",
      gray, tooltip "no individual identified") — per D6-009 applied to chart headers, and EVL-012's
      session-vs-person labeling rule.
- [ ] Given a controller dial/escalation event occurred during the exercise (CTL-022), when the
      sentiment chart renders, then it draws a dashed vertical line and an amber ◆ marker at that
      scenario moment, labeled (e.g. "◆ dial 45→70"), with a legend banner stating "controller
      inputs are scenario design — mood shifts at these marks are dialed, not participant
      performance" — per D6-008/EVL-014, the defensibility guarantee.
- [ ] Given the sentiment chart, when a scenario-time jump occurred in the exercise, then the chart
      renders the same hazard-hatched seam convention used on the replay track
      (`evaluation-timeline/03`) at the matching x-position — one visual vocabulary for the same
      event across surfaces.
- [ ] Given the Reach & Traction view, when it computes impressions/engagement/amplification for
      official content, then the figures are computed over the audience-magnitude model (SOC-054)
      rather than a literal roster, and view/dwell-derived numbers are labeled **session-level
      evidence**, never claimed as person-level proof — per EVL-012.
- [ ] Given the dial-event overlay layer, when the surface is switched to Hotwash/participant-visible
      mode (`evaluation-timeline/03`'s toggle), then none of these overlays (dial markers, legend
      banner, STAFF-channel rows) render on this chart — EVL-014's participant-visible-hotwash
      exclusion, enforced once at the shared toggle and verified here.
- [ ] Accessibility (NFR-001): the dial marker uses shape (◆) + dashed line + text label together,
      never color alone; the session/person evidence chip is likewise word + color.

## Out of Scope
The misinformation spread tree (story 05, deferred); the pre-E8 fallback presentation of this same
chart (story 04 owns the "engine off" replacement card); the mechanics of the dial event itself
(`world-steering`'s escalation dial, E7).

## Technical Notes
Staff world; `features/evaluator/components/metrics/SentimentChart.tsx` (SVG per the reference DOM:
`sentPath`, `dialMarks`, `axisTicks`, hatched `seamX`), `ReachPanel.tsx`, and the shared
`EvidenceLevelChip` (from story 01). The dial-event data source is shared with
`evaluation-timeline/03`'s staff lane — one read model, two renderings (chart marks vs. track
glyphs), so they can never drift apart. See `implementation.md`.

## Dependencies
`evaluation-timeline` (scenario-time-jump and dial-event data); `world-steering`'s escalation dial
(CTL-022) as the dial-event source; story 01's `EvidenceLevelChip`.

## Tests
- Component (RTL): dial-marker rendering + legend-banner presence.
- Component (RTL): hotwash-mode overlay-suppression test (asserts DOM absence, not CSS-hidden).
- Component (RTL): session-level chip labeling on reach figures.
