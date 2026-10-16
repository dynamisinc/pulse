# Story: Avatars (participant self-upload, staff set, staff avatars, moderation)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-017, SOC-001, COR-024, NFR-004  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §4.1, §4.2  ·  **Issue:** #578
**Stack:** fullstack  ·  **Review tier:** Tier-2 (isolation, content security)  ·  **Wave:** A2

## Context
A participant's avatar is their persona's avatar, per exercise; staff avatars live in the staff world only ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §4). Depends on the re-encode pipeline (story 24).

## Acceptance Criteria
- [ ] **Self-upload.** `PUT /api/me/avatar` (participant session, multipart, images only, `media-upload` limiter) sets `Persona.AvatarMediaId` on the caller's own bound persona only when it is personal (`PersonaAutoCreated`, or bound to exactly one account). Org, shared and cast personas return 403.
- [ ] **Staff set.** `PUT /api/staff/roster/{accountId}/avatar` (planner or controller) does the same on behalf of a participant; evaluator refused; foreign-exercise accountId is the bare 404.
- [ ] **Moderation.** Participant-uploaded assets are tagged `UploadedByAccountId`, appear in the media library under a "Participant uploads" filter, and a controller can **revert to default** (audited, soft: asset retained for AAR).
- [ ] **Staff avatars.** Stored at `org/{orgId}/people/{personId}.webp` (outside every exercise prefix), served only by `GET /api/org/people/{id}/avatar` and `/api/me/staff-avatar` to staff sessions.
- [ ] **No leak.** The XC-002 projection test asserts no staff avatar field on any participant DTO; `MediaScopeGuard` never serves the org prefix to a participant.
- [ ] **No watermark band on avatars** (32-96 px); recorded so review does not flag it (NFR-008 note).
- [ ] **Content security (NFR-004):** MIME/size validation, magic-byte sniff, re-encode + EXIF strip (story 24), CSP; a stored image can execute nothing.
- [ ] Isolation (XC-001/002, COR-001/002/007; brief C5): every new route has a foreign-exercise test **and** a foreign-org test; a cross-tenant id returns the same bare 404 as a missing id (the bare-404 pattern, design doc §7.2); id-taking org routes join the `CompositionRootWiringTests` allow-list.
- [ ] Telemetry (XC-004): the action emits an event (wall + scenario time, acting `PersonId` and role, channel `system`) per the v0 schema, in the same unit of work as the mutation.
- [ ] Two worlds / no-enterprise-look (D0 §2): the participant surface uses the exercise brand skin; no COBRA theme, no default MUI look; mobile-first. (participant upload UI)
- [ ] Two worlds (D0 §2): the surface uses COBRA (`@/theme/styledComponents`), is desktop-first, FontAwesome only, MUI 9 `sx`-only, and is never confusable with a participant view. (staff library/roster UI)
- [ ] Accessibility (NFR-001): WCAG 2.1 AA; keyboard-operable; status/error states are never color-only; async results announced via a live region. Avatars carry alt text.
- [ ] User guide (C5 docs-as-done): `docs/guide/participant-guide.md` is updated in the same PR (and `tools/guide-screenshots` if a screen changed), or the PR states "no guide impact". and `planner-guide.md`.

## Out of Scope
Cast/library avatars (persona-management 05); watermarking avatars; video.

## Technical Notes
Both worlds. Paths: `Features/Media/*`, `Features/Identity/Avatars/*`, participant profile edit (brand skin), roster row action (COBRA). Uses `MediaUploadService`. **Orchestrator clearance first:** the wave EF migration, `Program.cs` route-group lines, and `App.tsx` / `staffRouteRegistry.tsx` additive lines go through the orchestrator's end-of-wave wiring commit; builders export one `Add*()`/`Map*()` line and do not edit them.

## Dependencies
Wave A2, **after 24** (re-encode first).

## Tests
Endpoint tests per persona type; projection test; scope-guard test; RTL for upload + moderation filter.
