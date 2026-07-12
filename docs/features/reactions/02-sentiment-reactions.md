# Story: Sentiment reaction set (per-exercise)

**Feature:** Reactions  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-031  ·  **Design decisions:** none  ·  **Issue:** #105

## Context
An optional per-exercise sentiment-carrying reaction set (e.g. support / anger / fear / skepticism).
When enabled, reactions aggregate into the **public-mood signal** consumed by E8 and E10 — but the
participant-facing presentation must stay **indistinguishable from a normal reaction picker** (SOC-031).

## Acceptance Criteria
- [ ] When the sentiment set is enabled for an exercise, the reaction picker offers the configured
      sentiment reactions; when disabled, only Like (story 01) is available.
- [ ] To participants the picker looks and behaves like an ordinary reaction picker — no analytical
      labels, no "mood" framing (SOC-031).
- [ ] Sentiment reactions aggregate into a per-storyline / exercise-wide mood signal exposed to E8
      (input) and E10 (EVL-014), via telemetry (XC-004).
- [ ] Enablement is an exercise-config prop (not an in-app participant toggle; D1-002).

## Out of Scope
The E8 mood consumption (E8 ADP-012); the E10 sentiment overlays (E10 EVL-014); the analytical
computation itself.

## Technical Notes
Participant world picker + telemetry-side aggregation. Presentation parity with a normal picker is a
hard requirement. See implementation.md (story 02).

## Dependencies
story 01 (reaction infra); exercise-configuration (enablement); telemetry (XC-004). Feeds E8/E10.

## Tests
- Component (RTL): enabled set renders as an ordinary picker; disabled = like only.
- Unit: sentiment reactions aggregate into the mood signal.
