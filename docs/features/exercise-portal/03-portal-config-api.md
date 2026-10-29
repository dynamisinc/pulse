# Story: Portal config API (masthead and modules)

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-002, PRT-003, COR-030, COR-066, XC-001, XC-002, XC-004  ·  **Design decisions:** D2-001, D2-005  ·  **Issue:** #769
**Stack:** backend  ·  **World:** foundation (serves the participant portal; staff write)  ·  **Wave:** 2  ·  **Effort:** M

## Context
PRT-002: a configurable masthead with a templated default ("[City] Today"); PRT-003: a planner-configurable module list where sections for disabled channels hide cleanly. This story serves `GET /api/portal` to
participants and `GET|PUT /api/portal/config` to staff. Per-exercise branding is by construction: the name, logo and bounded token overrides are all exercise-scoped rows (COR-066); no fixed trademark exists.

## Acceptance Criteria
- [ ] **Defaults without a row.** Given an exercise with no `PortalConfig`, when a participant calls `GET /api/portal`, then it returns the default masthead (`"{CityName} Today"` when a city is set, otherwise the neutral `"Local Today"`, Q-E3-1), layout `anchor`, and the default module order `topStories, socialStream, pressLatest, weather, trending`, without writing a row.
- [ ] **Clean hiding (PRT-003, D2-005).** Given `modules` stored in any order, when the participant reads, then the response lists only modules whose source channel is enabled by `IChannelEnablement` (F08) and `enabled: true` in config, in stored order; a module for a disabled channel is absent from the payload, not flagged.
- [ ] **Gate.** Given the `portal` channel is disabled, when a participant calls `GET /api/portal`, then it is the same 404 as an unknown route; a staff session can still `GET|PUT /api/portal/config` (planners prepare before enabling, like F08).
- [ ] **Staff write.** Given a controller or planner, when `PUT /api/portal/config` carries `version`, then a stale version is `409`; an evaluator or participant is `403`; `layoutKey` outside the PC-1 allowlist, a name over 60 characters or `ModulesJson` over 4 KB is `400`.
- [ ] **Logo and overrides are isolated.** Given `logoMediaId` from another exercise or a non-image asset, then the write is refused (`400`, no existence leak); given `skinOverrides`, then they pass F03's public `ISkinOverridesValidator` (allowlist, `ext.portal` namespace, 4 KB cap, CANNOT-list structurally unreachable; FU-4b resolved) — no private or stricter copy of the allowlist.
- [ ] **No leakage and no exercise id.** Given the participant response, then it carries no `version`, `actingHumanId`, wall clock or staff-only field (XC-002) and no route or body accepts an `exerciseId`; a cross-exercise attempt cannot name another exercise.
- [ ] **Audit and telemetry.** Given a successful staff write, then `portal_config_changed` is emitted in the same unit of work with the staff actor and `payload.fields` (names only, no values).

## Out of Scope
The console UI (16), the portal skin tokens themselves (06), resources (04), enabling or disabling channels (exercise-configuration).

## Technical Notes
Files: `Features/Portal/Config/**`. Pattern: `OutletService` + `ParticipantShellConfigService` projection style; the `EngineCockpitStaffAuthorizationFilter` + role filter from the `InjectEndpoints` pattern. Wiring test via `WebApplicationFactory<Program>`. Orchestrator adds `AddPortal()/MapPortal()`.

## Dependencies
01, 02, F03 (`ISkinOverridesValidator`), F08. Can run with 04, 06, 07.
