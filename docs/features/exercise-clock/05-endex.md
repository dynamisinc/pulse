# Story: EndEx

**Feature:** Exercise clock & scenario-time model  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-054  ·  **Design decisions:** none  ·  **Issue:** #81

## Context
Completing an exercise presents participants a configurable EndEx state (out-of-fiction
thank-you/hotwash-instructions page); shared credentials expire per policy (immediate or +N hours for
hotwash); the world remains accessible **read-only** to staff and (optionally, facilitated)
participants for hotwash — "go find the post I mean" is a real hotwash need. Replay and core metrics
are available ≤15 min after EndEx (COR-054, EVL-033).

## Acceptance Criteria
- [ ] Completing an exercise (EndEx) presents participants a **configurable out-of-fiction** EndEx page
      (thank-you / hotwash instructions).
- [ ] Shared credentials expire per policy at EndEx (immediate or +N hours for hotwash);
      identity-auth-roles lifecycle (COR-016) enforces it.
- [ ] The world remains **read-only** accessible to staff and (optionally facilitated) participants for
      hotwash after EndEx.
- [ ] Replay and core metrics are available **≤15 minutes** after EndEx (EVL-033, E10).

## Out of Scope
The replay UI + metrics computation (E10); the AAR export (E10); the lifecycle transition to
Completed/Archived (exercise-configuration COR-032).

## Technical Notes
Foundation. EndEx transitions the lifecycle, expires credentials, and opens read-only hotwash. See
implementation.md (story 05).

## Dependencies
Story 01; exercise-configuration lifecycle (COR-032); identity-auth-roles (credential expiry COR-016);
E10 (replay/metrics ≤15 min).

## Tests
- Integration: EndEx shows the out-of-fiction page, expires shared credentials per policy, and leaves
  the world read-only for hotwash.
