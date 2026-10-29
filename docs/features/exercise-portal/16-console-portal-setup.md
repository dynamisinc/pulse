# Story: Console: portal setup

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-002, PRT-003, PRT-022, COR-041, XC-004  ·  **Design decisions:** D5 (console conventions via F17)  ·  **Issue:** #780
**Stack:** frontend (staff)  ·  **World:** staff (COBRA)  ·  **Wave:** 3  ·  **Effort:** L

## Context
The planner's/controller's screen for everything portal-specific that is not content: the masthead (city, name, tagline, logo), which modules show and in what order, and the Resources shelf. Staff world: COBRA, dense, keyboard-first, desktop-first, never confusable with a participant view; the participant rendering is shown only through preview-as-participant (COR-041). The module order/toggle UI is cut-order item 6: without it the layout is fixed and channels still hide via enablement.

## Acceptance Criteria
- [ ] **Masthead form.** Given the surface at `/staff/portal-setup`, when a controller or planner edits city, portal name, tagline and logo (image upload through the media pipeline), then it saves via `PUT /api/portal/config` with `version`; the live default is shown as "Atlanta Today" style from the city; a blank city shows a visible "City not set: participants will see 'Local Today'" notice (text, not color-only; Q-E3-1).
- [ ] **Modules.** Given the five module rows (Top Stories, Social Stream, Press Room, Weather, Trending), then each has an on/off switch and Move up / Move down buttons (keyboard-operable, no drag-only), a row whose source channel is disabled is shown disabled with the reason ("Press Room channel is off"), and order and flags save as one change.
- [ ] **Resources manager.** Given the Resources section, then the user can add, edit (title, summary, rich body, optional image), reorder, hide and delete resources (soft delete with confirm), within the 25 limit, with server validation errors shown inline.
- [ ] **Concurrency.** Given a stale `version` (`409`), then the surface shows the "changed by someone else" conflict with a reload-and-reapply option and loses no typed input.
- [ ] **Preview-as-participant (COR-041).** Given unsaved or saved settings, then a "Preview as participant" action renders the real participant portal in the staff frame's read-only stage; the preview is never restyled by COBRA and never leaks staff chrome into it.
- [ ] **Two worlds and roles.** Given the surface, then every control is a `@/theme/styledComponents` COBRA component, it is registered via the staff route registry (orchestrator seam) for `controller` / `planner` only, and a participant or evaluator cannot reach it; a static test forbids participant-world imports.
- [ ] **A11y.** Given the surface, then every field is labelled, errors are announced, focus order is logical, status chips carry text, and axe is clean (NFR-001; the evaluator/staff-side gate).

## Out of Scope
Display control (20, Deferred post-December), pinning stories (F17, 22), enabling channels (exercise settings), `band`/`grid` layouts and skin editing beyond logo (the token overrides stay API-only in December).

## Technical Notes
Files: `features/controller/portalSetup/**`. COBRA only; React Query against the axios client with the PC-3 guards (fixtures until 03/04 are live); FontAwesome icons; MUI 9 `sx`-only. Orchestrator adds the registry entry.

## Dependencies
03, 04, 07 (module ids), F17 (console conventions, preview frame). Can run with 09-15.
