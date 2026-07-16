# Story: Ambient background posting

**Feature:** Ambient chatter  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP-005  ·  **Design decisions:** none  ·  **Issue:** #168

## Context
Low-intensity background posting keeps the world alive during lulls (ADP-005), using persona voice
profiles and scenario context. When engine activity drops below the quiet floor
(`minBelievableActivity`, storyline-model story 04), ambient chatter fills it — everyday persona posts
(local color, small talk, unrelated life) so the world reads as an ongoing place, not a stage that
only lights up during a crisis. Generated on the cheap Haiku tier so it doesn't dominate cost.

## Acceptance Criteria
- [ ] Given engine activity below the quiet floor (`minBelievableActivity`), when the loop ticks, then
      ambient chatter is generated to bring activity up toward the floor.
- [ ] Given ambient generation, when it runs, then it uses persona voice profiles + scenario context
      (persona-voice-engine) and reads as ordinary background life, not storyline-driven content.
- [ ] Given the **Haiku tier**, when ambient content is generated, then it uses the cheaper model tier
      (engine-generation-infra story 04) — ambient is the bulk of volume and must not dominate cost.
- [ ] Given the rate cap (`maxEnginePostsPerMinute`), when ambient generates, then it respects the cap
      and yields to storyline-critical generation (ambient is lowest priority).
- [ ] **LLM governance (NFR-005/ADP-024) + content guard (ADP-023):** via the tenant-bounded provider
      with isolation; never breaks fiction. **Scenario time (COR-053):** ambient posts render in
      scenario time. **Telemetry (XC-004):** emitted like any engine post; staff-only origin (SOC-003).

## Out of Scope
The quiet-floor definition (storyline-model story 04 — this consumes it); the model tiering
(engine-generation-infra story 04 — this selects the ambient tier); backdated pre-exercise history
(persona-management COR-023 — related but authored, not live-generated).

## Technical Notes
Staff/backend. Registers a low-priority decide-stage policy triggered by the quiet-floor signal:
generate a small ambient burst on the Haiku tier, yielding to storyline-critical intents. Keeps
profiles feeling continuous (complements COR-023 backdated history). See implementation.md and
architecture §3.2/§6.2.

## Dependencies
storyline-model story 04 (quiet floor + rate cap); persona-voice-engine; engine-generation-infra
story 04 (Haiku tier); reaction-loop (generate/publish).

## Tests
- Unit: below the quiet floor, ambient chatter is generated on the Haiku tier and brings activity up.
- Unit: ambient yields to storyline-critical generation and respects the rate cap.
