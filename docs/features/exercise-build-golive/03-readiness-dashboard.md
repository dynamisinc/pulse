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
