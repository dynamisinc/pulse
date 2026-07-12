# Feature: Exercise isolation

**Epic:** E1 — Platform Core & Exercise Isolation  ·  **Phase:** 1  ·  **Feature ref:** F1.1
**World:** platform/foundation  ·  **Issue:** #38

## Summary
The platform's worst-possible failure is a participant seeing another exercise's content — this
feature makes that impossible. Every content and social-graph entity is exercise-scoped, enforced
centrally; per-exercise hostnames scope the session; and a standing test suite attacks isolation on
every participant-facing path. Everything else in Pulse builds on the guarantees here.

## Requirements covered
COR-001, COR-002, COR-003, COR-004, COR-005, COR-006, COR-007, COR-008, COR-009 (with the
cross-cutting XC-001/002 and NFR-004 stored-XSS surface).

## Design references
`docs/design/D0-FOUNDATIONS.md` (the two worlds; participant-visible surfaces never expose exercise
selection). COR-005's conduct-time behavior is amended by D5-012(g) (static identity badge during
conduct) — see `docs/features/console-shell/03-static-identity-badge.md`.

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Every entity is exercise-scoped (central query filter) | COR-001 | Not Started | #44 |
| 02 | Scoped surfaces & non-guessable media URLs | COR-002 | Not Started | #45 |
| 03 | Same persona template, independent instances per exercise | COR-003 | Not Started | #46 |
| 04 | Participants have no exercise-selection concept | COR-004 | Not Started | #47 |
| 05 | Staff cross-exercise switcher (staff-only) | COR-005 | Not Started | #48 |
| 06 | Archived exercises fully separable | COR-006 | Not Started | #49 |
| 07 | Standing cross-exercise isolation test suite | COR-007 | Not Started | #50 |
| 08 | Per-exercise hostname (subdomain) | COR-008 | Not Started | #51 |
| 09 | Network readiness (self-test, allowlist, GFE guidance) | COR-009 | Not Started | #52 |

## Dependencies
The Exercise / Organization entities and the exercise-context resolution (which exercise a session
belongs to). Blocks every channel epic (E2–E6), E7, E8. Backend not present yet — the query-filter
layer is the first backend contract; the frontend consumes a scoped API.

## Design notes
This is the hard dependency under the whole platform (XC-001). Isolation is enforced **centrally**
(a query filter/interceptor), never per-endpoint, so new endpoints inherit it. Media URLs are
non-guessable and access-checked. Participant sessions never expose exercise selection, simulation
status, or admin (XC-002). The standing test suite (COR-007) grows as endpoints are added and
includes stored-XSS attempts (NFR-004).
