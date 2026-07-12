# Story: "Who to follow" suggested follows

**Feature:** Profiles & social graph  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-053  ·  **Design decisions:** D1-R1  ·  **Issue:** #112

## Context
Suggested follows surfaced on social onboarding (and the portal, Phase 3), seeded by planners and
adjustable live by controllers as an attention-steering lever (SOC-053). Per the adversarial review
(D1-R1), the module is titled **"Who to follow"** — the platform must **never** label accounts
"official" or authoritative. The verified mark (and its absence) is the only credibility signal.

## Acceptance Criteria
- [ ] A **"Who to follow"** module suggests accounts; it carries **no** authority/"official" labels
      (D1-R1) — only identity + the verified mark where applicable (story 03).
- [ ] Suggestions are planner-seeded and adjustable live by controllers (E7 CTL-021) as an
      attention-steering lever, exercise-scoped (COR-001).
- [ ] An impersonator can appear in the module (a legitimate controller lever) — the module does not
      vouch for anyone (D1-R1/D1-008).
- [ ] Observer mode: Follow actions within the module are **absent** (D1-011).

## Out of Scope
The E7 control to adjust suggestions (world-steering CTL-021); the portal placement (E3, Phase 3);
follow mechanics (story 02).

## Technical Notes
Participant world. Module renders identity only; no authority chrome. Seeded config + E7-adjustable.
See implementation.md (story 04).

## Dependencies
story 02 (follow), story 03 (verified mark); E7 CTL-021 (adjust). Portal reuse in E3.

## Tests
- Component (RTL): the module titled "Who to follow" shows no authority labels; an unverified account
  can appear with no platform vouch.
