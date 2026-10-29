# Story: Resources API

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-022, NFR-004, XC-001, XC-002, XC-010  ·  **Design decisions:** D2-007  ·  **Issue:** —
**Stack:** backend  ·  **World:** foundation (non-fiction content; staff write, participant read)  ·  **Wave:** 2  ·  **Effort:** M

## Context
PRT-022: an optional Resources area for exercise-supplied non-fiction materials (quick-start guide, ground rules), kept visually and structurally separate from fictional content. Resources are **not** `ContentItem`s (they must never enter the fiction pipeline, the alert source or E10 signal/noise); they are `PortalResource` rows with their own small API.

## Acceptance Criteria
- [ ] **Staff CRUD.** Given a controller or planner, when they create, edit, reorder (`/reorder`) or delete a resource, then `Title` (≤ 120), `Summary` (≤ 300), `Visible` and `SortOrder` persist, a stale `version` is `409`, and the exercise holds at most 25 resources (`400` beyond).
- [ ] **Sanitization (NFR-004).** Given `bodyHtml`, then it is sanitized once server-side with the F04 rich-body profile (script, handlers, `javascript:` URLs, forms and iframes stripped; links must be host-relative, so external `https://` links are removed, Q-E3-8); a stored script never executes in another session.
- [ ] **Media.** Given `mediaAssetId`, then it must be an image in this exercise through the existing media pipeline (sniffer, size cap, malware path); a `document` (PDF) asset is accepted only once press 02 lands (a feature flag in this story, default off), otherwise `400`.
- [ ] **Participant read.** Given a participant session, when `GET /api/portal/resources` is called, then only `Visible`, non-deleted rows of **this** exercise return in `SortOrder`, as `PortalResourceDto` (no `version`, no staff fields, no wall clock); `GET /{id}` for a hidden, deleted or other-exercise id is the same 404.
- [ ] **Gate.** Given the `portal` channel is disabled, then participant reads are 404 while staff authoring still works.
- [ ] **Soft delete (XC-010).** Given a delete, then the row is retained and excluded from participant and default staff lists.

## Out of Scope
The shelf UI (15), the console manager (16), external links, versions of a resource, and any in-fiction content.

## Technical Notes
Files: `Features/Portal/Resources/**`. Reuse `PostSanitizer` via the F04 profile mechanism (do not fork), `Features/Media/*`, the staff filter pair from 03. Tests in the standing isolation suite style.

## Dependencies
01, 02, F04 (sanitizer profile), F08. PDF attachments: press 02 (flagged off until then). Can run with 03, 05, 06, 07.
