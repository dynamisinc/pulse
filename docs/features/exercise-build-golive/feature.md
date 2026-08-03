# Feature: Exercise build & go-live

**Epic:** E1 — Platform Core & Exercise Isolation  ·  **Phase:** 1  ·  **Feature ref:** F1.5
**World:** staff  ·  **Issue:** #42

## Summary
Content development is a first-class phase, not "before." A build workspace to author the whole world
staff-only, preview-as-participant to review the fiction, a readiness dashboard for go-live, the two
distinct gated go-live moments (Staged, then StartEx→Live), content lock at go-live, and exercise
duplication so the build investment compounds.

## Requirements covered
COR-040, COR-041, COR-042, COR-043, COR-044, COR-045 (with COR-009 network readiness, NFR-002 load
rehearsal, INT-003 Cadence MSEL lock — Phase 4).

## Design references
Master decision 9 (Build→Staged→Live lifecycle). Builds on exercise-configuration lifecycle (COR-032)
and the exercise clock (COR-050).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Build workspace (author the world staff-only) | COR-040 | Not Started | #71 |
| 02 | Preview-as-participant | COR-041 | Not Started | #72 |
| 03 | Go-live readiness dashboard | COR-042 | Not Started | #73 |
| 04 | Gated go-live: Staged, then StartEx→Live | COR-043 | Not Started | #74 |
| 05 | Content lock at go-live | COR-044 | Not Started | #75 |
| 06 | Exercise duplication | COR-045 | Not Started | #76 |

## Dependencies
Exercise-configuration lifecycle (COR-032); exercise-clock (StartEx starts the clock, COR-050);
persona-management, and each channel's composers (the content being built). Backend not present yet.
**Story 06 (COR-045, duplication) additionally depends on `exercise-lifecycle-admin/01-exercise-creation.md`
(COR-074, filed 2026-08-01)** — the create path duplication has always presupposed did not exist as
a requirement or endpoint until that story.

## Design notes
Staff world. The two go-live moments are deliberately distinct: **Build → Staged** opens the ambient
world for familiarization; **StartEx (Staged → Live)** starts the clock and scenario delivery
(COR-043). The readiness dashboard aggregates world completeness including network readiness (COR-009)
and a load rehearsal (NFR-002). Duplication clones the world (cast/theming/filler/scheduled content)
but not participant data or conduct history (COR-045).
