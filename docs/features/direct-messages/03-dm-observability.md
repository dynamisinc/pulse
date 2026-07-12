# Story: DM observability (evaluators/controllers)

**Feature:** Direct messages  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-062 (NFR-007)  ·  **Design decisions:** none  ·  **Issue:** #116

## Context
DMs are visible to evaluators/controllers in staff surfaces — participants are told observability
applies to the whole environment via exercise ground rules (product-supplied boilerplate, NFR-007)
(SOC-062).

## Acceptance Criteria
- [ ] DMs are visible to controllers/evaluators in staff surfaces (E7 monitoring / E10), read-only for
      evaluators (COR-013).
- [ ] The platform ships **exercise ground-rules boilerplate** (NFR-007) disclosing DM observability;
      no covert monitoring.
- [ ] DM observability is staff-only (XC-002) and exercise-scoped (COR-001); participants never see who
      is observing.
- [ ] DM events feed telemetry (XC-004) for E10.

## Out of Scope
The E7 monitoring board UI (live-monitoring CTL-030); the E10 DM review; the ground-rules content
authoring beyond the supplied boilerplate.

## Technical Notes
Backend/telemetry + staff surface consumption. DMs are part of the observable environment. See
implementation.md (story 03).

## Dependencies
story 01 (DMs); E7 monitoring (CTL-030), E10; NFR-007 boilerplate.

## Tests
- Integration: DMs surface in staff monitoring (evaluator read-only); disclosure boilerplate is present.
