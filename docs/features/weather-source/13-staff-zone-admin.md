# Story: Staff zone admin

**Feature:** Weather source  ·  **Epic:** E6  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** WX-004  ·  **Design decisions:** D4-009  ·  **Issue:** —
**Stack:** frontend  ·  **World:** staff (COBRA)  ·  **Wave:** 5  ·  **Effort:** S

## Context
Controllers define the exercise's named locations (city/county zones) before authoring weather. A small admin panel over the zone API (02): list, add, rename, reorder, set default, delete.

## Acceptance Criteria
- [ ] **List and create.** Given a controller, then the zone panel lists zones in order (name, slug, kind, default marker as icon + text) and "Add zone" creates one with name + kind (slug auto-derived, editable until first use); an empty state explains that weather products need at least one zone.
- [ ] **Edit, reorder, default.** Given a zone, then rename, change kind/description, reorder (keyboard-operable up/down controls, not drag-only) and "Make default" work, with `version` conflicts (409) prompting a reload.
- [ ] **Delete with consequence.** Given a zone referenced by published items, then delete shows how many it affects and requires one explicit confirmation; after delete it disappears from participant selectors but historic products keep their zone names (XC-010, per story 02).
- [ ] **Access and staff world.** Controllers can mutate; read-only roles see the list only; every control uses `@/theme/styledComponents` + FontAwesome, is keyboard-operable with visible focus, never color-only, axe clean.
- [ ] **Placement.** The panel is reachable from the weather timeline panel (12) and the product editor's "add a zone first" prompt (11) without leaving the console; it is also a staff-registry entry the orchestrator adds.
- [ ] **User guide.** Adds a zone-setup section to the weather guide page or states "no guide impact".

## Out of Scope
Geometry, import, per-zone styling, zone templates by scenario (parked; see story 15 stretch for a seeded sample).

## Technical Notes
Files: `src/frontend/src/features/weather/staff/zones/**`. `useZones` (read) is owned by story 03; this story owns only `useZoneAdmin.ts*` (mutations).

## Dependencies
02 (API; mock until live), 03 (`useZones`), F17 (staff registry). Can run with 08, 09, 10, 12.
