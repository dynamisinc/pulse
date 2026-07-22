# Feature: App shell & role-aware navigation

**Epic:** E1 — Platform Core & Exercise Isolation  ·  **Phase:** 1  ·  **Feature ref:** F1.1 (COR-004/005, nav realization)
**World:** both (routing glue — mounts each world's own surfaces; never blurs them)  ·  **Issue:** —

## Summary
The role-aware entry that replaces the five flat hardcoded routes (`/`, `/evaluator`, `/console`,
`/shell`, `*`). Once real sessions/roles/exercise scope exist (Phase B2), navigation finally has
something to route on: a **participant** lands directly in their exercise's landing surface with **no
picker** (COR-004); **staff** reach the console/evaluator surfaces plus the **exercise switcher**
(COR-005). This is the "navigation is a fast-follow, after identity" slice from
`docs/BACKEND_ROADMAP.md` §4 — polishing nav before session/role state exists is polishing a shell with
nothing to drive it.

## Requirements covered
COR-004 (participant no-selection landing), COR-005 (staff cross-exercise entry + switcher). Realizes
the nav consequences of the E1 identity/isolation guarantees; does not introduce new requirements.

## Design references
`docs/design/D0-FOUNDATIONS.md` §2 (the two worlds — the nav must never mount COBRA on a participant
path or a brand skin on a staff path); D7-009 / `App.tsx` (the theme-free composition root — the nav's
route table replacement is the orchestrator-owned edit there). Mounts the **existing** built surfaces —
`participant-shell` / `staffShell` / `console` (controller) / `evaluator` — it does not rebuild them.

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Role-aware global nav (participant landing + staff entry/switcher) | COR-004, COR-005 | Complete | — |

## Dependencies
**Live** `useSession()`/`useRole()` (identity-auth-roles/03) and `useExerciseContext()`
(exercise-isolation/08) — both flipped to real backends in B2 — plus the `StaffAssignment` data source
(identity-auth-roles/05). Composes the participant landing route guard (`exercise-isolation/04`) and the
staff exercise switcher (`exercise-isolation/05`). Mounts the existing `participant-shell`,
`staffShell`/`console`, and `evaluator` surfaces. The `App.tsx` route-table replacement is an
orchestrator-owned composition-root edit (see implementation.md Integration seam).

## Design notes
Pure **routing glue**, world-neutral at its own root and world-specific only where it hands off to a
mounted surface. The two-worlds rule (D0 §2) is the sharpest constraint: the participant entry mounts
`ParticipantShellRoute` (per-brand skin, COBRA-free by construction) and the staff entry mounts
`StaffShellFrame`-based surfaces (COBRA); the nav must never let one leak into the other, and the
switcher (COR-005) is staff-surfaces-only (XC-002). Everything the nav routes on comes from the resolved
session/role/scope — never a user-chosen exercise (COR-004). Accessibility (NFR-001): keyboard-operable
nav, focus management on route change, aria on the switcher, severity never color-only. This feature adds
no participant free-text/upload paths and emits no new telemetry of its own (the login/session events are
owned by identity-auth-roles/02/03/05/06); it consumes the identity layer, it does not extend it.
