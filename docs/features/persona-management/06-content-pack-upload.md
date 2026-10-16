# Story: Content pack upload and apply (pulse.demopack.v1)

**Feature:** Persona management & cast libraries  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-020, COR-021, COR-023, COR-024  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §6.1, §8.2  ·  **Issue:** #582
**Stack:** fullstack  ·  **Review tier:** Tier-2 (isolation, content security)  ·  **Wave:** A4

## Context
Seeding the world needs Dynamis help (a PowerShell script). A planner uploads the existing `pulse.demopack.v1` zip and applies it in the app ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §6.1). Staff world, build state only.

## Acceptance Criteria
- [ ] **Upload + validate.** `POST /api/staff/content-packs` (planner; exercise in `build` only, else 409 `content-locked`) streams a zip up to 200 MB, stores it and returns a dry-run report: counts, unknown handles, missing media, schema errors. Nothing is written yet.
- [ ] **Apply.** `POST /api/staff/content-packs/{id}/apply` runs as a background job; `GET .../{id}` returns progress and results; the planner sees the report before confirming.
- [ ] **Through the services, never the database:** `MediaUploadService` (with re-encode), the persona create service, post ingest with backdate and baselines, pin, `InjectQueueService`, the noise-pool service. Pack posts become `IsSetupContent`.
- [ ] **Idempotent.** `ContentPackItem(ExerciseId, PackId, ItemKey, EntityType, EntityId)` records each item; re-applying updates in place and never duplicates.
- [ ] **Role.** Controller, evaluator and others are refused; foreign-exercise and foreign-org pack ids return the bare 404.
- [ ] **Content security (NFR-004):** zip-slip, zip-bomb and size checks, MIME sniffing, HTML sanitization of post text, malware-scan hook; a stored script never executes in another session.
- [ ] Isolation (XC-001/002, COR-001/002/007; brief C5): every new route has a foreign-exercise test **and** a foreign-org test; a cross-tenant id returns the same bare 404 as a missing id (the bare-404 pattern, design doc §7.2); id-taking org routes join the `CompositionRootWiringTests` allow-list.
- [ ] Telemetry (XC-004): the action emits an event (wall + scenario time, acting `PersonId` and role, channel `system`) per the v0 schema, in the same unit of work as the mutation.
- [ ] Two worlds (D0 §2): the surface uses COBRA (`@/theme/styledComponents`), is desktop-first, FontAwesome only, MUI 9 `sx`-only, and is never confusable with a participant view.
- [ ] Accessibility (NFR-001): WCAG 2.1 AA; keyboard-operable; status/error states are never color-only; async results announced via a live region.
- [ ] User guide (C5 docs-as-done): `docs/guide/planner-guide.md` (loading a content pack; "ask Dynamis" line removed); `Seed-DemoContent.ps1` becomes a thin zip-and-upload client.

## Out of Scope
Pack authoring UI; other formats; applying to a staged/live exercise (unstage first); templates marketplace.

## Technical Notes
Staff world. Paths: `Features/ContentPacks/*`, `ContentPackApplier`, planner build workspace upload panel. Migration A4: `ContentPack`, `ContentPackItem`, persona archive column. Orchestrator clearance for the migration and route-group lines.

## Dependencies
Wave A4, after A1, A3 (IsSetupContent), identity 24 (re-encode) and persona-management 01 (persona create service).

## Tests
Applier idempotency test; validation-report test; build-only gate; zip hostile fixtures; isolation tests; RTL for upload/report.
