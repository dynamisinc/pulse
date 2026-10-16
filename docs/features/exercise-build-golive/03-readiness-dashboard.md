# Story: Go-live readiness dashboard

**Feature:** Exercise build & go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-042 (COR-009, NFR-002)  ·  **Design decisions:** none  ·  **Issue:** #73

## Context
A go-live checklist aggregating world completeness: personas seeded, channels themed, scheduled content
counts by channel, participant accounts provisioned, shared credential set, hostname active + network
readiness verified (COR-009), compliance chrome configured, load rehearsal done (NFR-002) — with
per-item status (COR-042).

## Acceptance Criteria
- [ ] The dashboard aggregates readiness items with per-item status: personas seeded, channels themed,
      scheduled-content counts by channel, accounts provisioned, shared credential set, hostname active
      + network readiness (COR-009), compliance chrome configured, load rehearsal done (NFR-002).
- [ ] Item status is conveyed by label/icon, not color alone (NFR-001).
- [ ] The dashboard is exercise-scoped, staff-only (XC-002), and reflects live state as build progresses.
- [ ] Incomplete critical items are visible so a Director can judge go-live readiness (story 04).

### Orchestrator review fold (2026-10-16, ADMIN-IDENTITY-MODEL §5.3)
- [ ] Warning, not blocking: **no lead controller**. Swamped mode and autonomy raises are unavailable until a planner sets a lead.

## Out of Scope
The go-live action itself (story 04); the underlying items' own features (network readiness
exercise-isolation/09, provisioning identity-auth-roles, etc.) — this story aggregates their status.

## Technical Notes
Staff world (COBRA). Reads status from each contributing subsystem. See implementation.md (story 03).

## Dependencies
Stories 01/02; exercise-isolation/09 (network readiness); identity-auth-roles (provisioning, shared
cred); persona-management (seeding); exercise-configuration (chrome). Gates story 04.

## Tests
- Component: the dashboard reflects each item's status; incomplete items surface (not color-only).

## Scope update 2026-10-16 (ADMIN-IDENTITY-MODEL)

Source: [`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §5.3, §5.4a, §3.4, §8.4 (Tier-2 signed off by Tom, 2026-10-16). Wave A3. The readiness checklist (§5.3) is now defined; stage is refused with 409 and the list while any **blocking** item is open.
- [ ] **Blocking items:** (1) at least one controller enrollment; (2) a participant-facing name is set (story 09); (3) at least one participant `Account`, or the view-only code is enabled; (4) every participant account is bound to a persona; (5) at least one participant sign-in method is on, if participant accounts exist (identity 22); (6) time zone and scenario start time set; (7) chrome and watermark valid (`ComplianceChromeGuard`); (8) no run-sheet item is `needs-repair` (§5.4a).
- [ ] **Warnings (shown, not blocking):** no run sheet items; no opening feed; empty noise pool; personas missing avatars; participants with no sign-in issued yet; no evaluator enrolled.
- [ ] Each item has a label and icon (never color-only), links to the fixing screen, and is exercise-scoped and planner/controller/evaluator-readable.
- [ ] Foreign-exercise and foreign-org readiness reads return the bare 404.
- [ ] User guide (C5 docs-as-done): `docs/guide/planner-guide.md` is updated in the same PR, or the PR states "no guide impact".
