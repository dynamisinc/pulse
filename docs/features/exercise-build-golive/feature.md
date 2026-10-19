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
| 04 | Gated go-live: Staged, then StartEx→Live | COR-043 | Partially built (roles/transition/telemetry via identity 16/17); clock start + content hold blocked on engine-runtime dependency | #74 |
| 05 | Content lock at go-live | COR-044 | Not Started | #75 |
| 06 | Exercise duplication | COR-045 | Not Started | #76 |
| 07 | Reset, reopen, unstage, unarchive (A3, Tier-2) | COR-043, COR-032 | Not Started | #580 |
| 08 | Delete an exercise that never ran (A3, Tier-2) | COR-032, COR-074 | Not Started | #581 |
| 09 | Participant-facing exercise name, no fallback (#180/#376) (A3, Tier-2) | COR-032, COR-053, SOC-001 | Not Started | #376 |
| 10 | Lifecycle gate for the hub and reaction loop (#375) (A5) | COR-032, COR-043, CTL-023 | Not Started | #375 |
| 11 | Refuse participant writes in Freeze/pause (#379) (A5) | CTL-023, COR-032, SOC-001 | Not Started | #379 |
| 12 | Push lifecycle changes to connected clients (#390) (A5) | COR-032, CTL-023, NFR-002 | Not Started | #390 |

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

## Scope update 2026-10-16 (ADMIN-IDENTITY-MODEL)

Source: [`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md). Stories **01, 03, 04, 05, 06** are amended (setup content stamped in build; readiness checklist with 8 blocking items; StartEx controller-only and stage planner-only; content packs build-only; duplicate per §5.5 incl. setup posts, cleared participant-media avatars and needs-repair reply items). New 07-09 are wave A3; 10-12 are wave A5 (#375, #379, #390); #376 is covered by 09; #389 and #485 live in `identity-auth-roles` 25 and 26.
