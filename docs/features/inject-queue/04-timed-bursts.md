# Story: Timed bursts — a bundle fires as a paced sequence

**Feature:** Inject queue & conduct timeline  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-014  ·  **Design decisions:** none  ·  **Issue:** #22

## Context
The Looking Glass "repeated voices" pattern, automated: a single queue item can be a **bundle** — e.g.
12 citizen posts across 8 personas over 10 minutes — that fires as a **naturally-paced sequence**, not
a simultaneous dump (CTL-014). One controller action produces a believable trickle of public reaction.

## Acceptance Criteria
- [ ] Given a bundle item (a set of persona posts with a duration/pacing), when the controller fires
      it, then its posts publish spread across the configured window with natural jitter — not all at
      the same instant.
- [ ] The bundle shows progress on the timeline (e.g. "4 of 12 fired") and can be **held/paused**
      mid-sequence; pausing the world (world-steering CTL-023) suspends an in-flight bundle.
- [ ] Each post in a bundle is authored by its assigned persona and logged individually (XC-004),
      with scenario-time stamps (COR-053).
- [ ] Firing a bundle stays within engine/queue rate expectations so it never floods the feed past
      legibility (NFR-002 / SOC-071 burst targets).
- [ ] The bundle is staff-only (XC-002) and scoped to the active exercise (COR-001).

## Out of Scope
Engine-generated (non-authored) bursts (E8 amplification, ADP-004); single-item firing (story 02);
time-jump backfill of bundles (story 05).

## Technical Notes
Staff world (COBRA). A bundle is a queue item type with child posts + a pacing profile; the pacing
runs against the scenario clock and honors world-pause. Publishes via the E2 pipeline. See
implementation.md (story 04).

## Dependencies
Story 01 (timeline), story 02 (fire mechanics); E1 clock; world-steering CTL-023 (pause suspends
in-flight bundles); E2 pipeline.

## Tests
- Unit: a bundle schedules its child posts across the window with jitter (not simultaneous).
- Unit: pausing the world halts an in-flight bundle; resume continues it.
- Component (RTL): the timeline shows bundle progress ("N of M fired").
