# Story: Post rendering & author identity (verified mark)

**Feature:** Posts  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-002  ·  **Design decisions:** D1-003  ·  **Issue:** #93

## Context
A post renders author identity — avatar, display name, handle, verified checkmark when applicable —
and **no platform-added editorial badges** (no "OFFICIAL", no "BREAKING" chrome). Authority lives in
the author's identity and their own words (SOC-002). The verified mark is a **fixed seal-blue
`#2D9CDB`**, independent of the per-exercise accent — rebranding never alters the trust signal (D1-003).

## Acceptance Criteria
- [ ] A post card renders avatar, display name, handle, relative scenario-time (COR-053), text, optional
      media/link card, and an action row (reply / repost / like / share with counts).
- [ ] A qualifying persona (E1 verification flag) renders a verified check in **fixed seal-blue
      `#2D9CDB`**, unchanged by the exercise accent theme (D1-003, COR-030).
- [ ] There are **no** platform-added editorial badges ("OFFICIAL"/"BREAKING") on any post (SOC-002).
- [ ] The verified/unverified state is discernible without relying on color alone where it conveys
      trust (NFR-001) — the mark is a shape+color seal, and its absence is meaningful (D1-008).
- [ ] Participant-world styling only (Pulse skin, no COBRA/default MUI; D0).

## Out of Scope
Composition (story 01); provenance/telemetry internals (story 03); the impersonation search pairing
(profiles-social-graph SOC-052 / search); verification eligibility rules (E1).

## Technical Notes
Participant world. The verified-mark color is a fixed token separate from `--pulse-ac`. Post card is the
most-reused component in E2. See implementation.md (story 02).

## Dependencies
E1 verification flag (SOC-052 source); scenario-time utility (COR-053); persona identity. Reused
everywhere in E2.

## Tests
- Component (RTL): a verified persona shows the seal-blue mark; changing the accent does not change the
  mark color; no editorial badges render.
