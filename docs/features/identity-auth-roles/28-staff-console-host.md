# Story: Staff console host (console.<domain> with /o/{slug}: config, DNS, hosting, UAT)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-077, COR-008, COR-009  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §1.2 "Staff console host" (signed off)  ·  **Issue:** #836
**Stack:** backend + infrastructure + frontend hosting  ·  **Review tier:** Tier-2 (isolation, hosting)  ·  **Wave:** A1 follow-up, ahead of A2  ·  **Priority:** High (Jonathan, 2026-11-06)

## Context
The design's signed-off decision is that one platform staff host, `console.<platform-domain>` (config
`StaffConsole:Host`), serves the staff console for every organization, with `/o/{slug}` per org. Per-exercise
hosts keep serving staff routes for now.

None of it exists. There is no `StaffConsole:Host` setting in the backend (it appears only in a realtime test),
no infrastructure parameter, no DNS entry and no frontend deployment on such a host. An organization with no
exercises has no exercise address at all, so without this host its org admin has nowhere to sign in.

Staff world and foundation.

## Acceptance Criteria
- [ ] **Config.** `StaffConsole:Host` is a backend setting, set per environment by infrastructure
      (`infrastructure/parameters/*.bicepparam`). UAT gets a value, for example
      `console-pulse-uat.cobrasoftware.com` (exact name to be agreed).
- [ ] **Hosting.** The SPA is served on the console host (custom domain on the existing Static Web App, or a
      second one), with TLS. `/o/{slug}` routes to the org sign-in page (story 27).
- [ ] **Host resolution.** A request on the console host resolves **no exercise** (it is not an exercise
      host). Participant routes on it fail closed (no participant sign-in or participant world on the console
      host). Staff routes work, with the exercise taken from the session (design §1.2).
- [ ] **Realtime.** Staff SignalR connections from the console host are scoped from the session's
      `ExerciseId`, verified against a live staff enrollment. Org-scope sessions are refused by the hub. Moving
      between exercises moves the connection to the new group. (Design §1.2 "Realtime scope on the shared
      console host"; confirm what story 15 already shipped.)
- [ ] **CORS, cookies and CSP.** The API allows the console origin (and no wildcard); refresh cookies work
      cross-site as they do for exercise hosts (`SameSite=None`); the CSP from channels-foundation 23 applies.
- [ ] **Network readiness (COR-009).** The console host is added to the published allowlist and firewall
      spec, and to the connectivity self-test.
- [ ] **Isolation.** Foreign-org and foreign-exercise tests on the console host: a session from org A can
      never read org B's data through it; a participant token is refused on it.
- [ ] Runbook: `docs/OPERATE.md` and `docs/features/login/06-uat-goLive-config-runbook.md` describe the
      setting, DNS and the post-deploy check. User guide: the staff sign-in address in `getting-started.md`.

## Out of Scope
- Retiring staff routes on per-exercise hosts (a later decision, per the design).
- Production DNS for customer deployments beyond the pattern (documented, not provisioned here).

## Technical Notes
- Design: [`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §1.2, "Staff console host"
  and "Realtime scope on the shared console host".
- Host resolution today: `HostExerciseResolver` and `OrganizationResolutionMiddleware` (exercise-isolation 11).
  The console host must resolve to no exercise rather than fall through to an unknown-host refusal.
- Infrastructure: `infrastructure/modules/webapp.bicep` (app settings), `infrastructure/modules/staticwebapp.bicep`
  (custom domain), and `infrastructure/parameters/uat.bicepparam`.

## Dependencies
- Story 27 (the org sign-in page, #835) for `/o/{slug}` to be useful. They can be built in parallel; story 27
  alone already works on the existing UAT address.
- Story 15 (built), exercise-isolation 11 (`OrganizationResolutionMiddleware`).

## Tests
- Backend: host resolution on the console host (no exercise; staff allowed; participant refused), CORS origin
  list, hub scoping from the session.
- Infra: `what-if` shows the new custom domain and app setting; post-deploy smoke signs in on
  `console…/o/{slug}`.
