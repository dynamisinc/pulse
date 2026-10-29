# Story: Release author API — orgs, drafts, autosave, edit timeline

**Feature:** Press Room  ·  **Epic:** E5  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRS-001, PRS-004, COR-018 (per-human attribution)  ·  **Design decisions:** D4-005, D4-006  ·  **Issue:** —
**Stack:** backend  ·  **World:** participant write path  ·  **Wave:** 3  ·  **Effort:** L

## Context
The foundation's write API (F07) is staff-only. E5 is participant-authored, so this story adds the participant's half: who I can release as, create/autosave a draft, keep the full edit timeline,
and list my org's releases. It calls `IContentPublishService` (`CreateDraftAsync`/`UpdateDraftAsync`) and never writes `ContentItem` rows. The funnel accepts participant-origin callers (foundation F04, press FU-2 resolved); authorization stays in this story's endpoints.

## Acceptance Criteria
- [ ] **Orgs I can release as (PRS-001).** Given a signed-in participant with the `pio` role, when `GET /api/press/orgs` is called, then it returns the orgs from `IReleaseOrgResolver` (letterhead, default contact, paired handle, `approvalRequired`); a participant without the role or grant gets 403 and sees none; the resolver is the only place this is decided.
- [ ] **Draft create.** Given an allowed org, when `POST /api/press/releases` is called, then a `release` draft is created through the funnel with `origin: participant`, `ActingHumanId` = the human, org outlet = the org's child newsroom, the contact block prefilled from the letterhead defaults, and one `press_draft_created` event; a persona the human may not release as is rejected like an unknown id.
- [ ] **Autosave and edit timeline (PRS-004).** Given a draft, when `PUT /api/press/releases/{id}` is called with the current `version`, then the change is saved with an `edit` revision (snapshot, scenario + wall time, acting human) and a blank `Dek` is (re)derived with `ReleaseDek.Derive` (story 01, R-P1) so every release has a non-empty dek; a stale version is 409 with the current state; repeated saves within the debounce window coalesce into one revision per ≥ N seconds so the timeline stays readable.
- [ ] **Per-human attribution.** Given two humans operating one org, when each edits, then each `edit` revision and event records the individual human (shared handle, per-human evidence); the author DTO exposes only `lastEditedBy.displayName` to same-org members.
- [ ] **Org-mate visibility and no leaks (XC-002).** Given a release, then every human who may release as its org can list/read/edit it, no one else can (404, not 403), and `ReleaseAuthorDto` never contains `origin`, `injectId`, `featuredRank`, `background`, wall clock, `actingHumanId`, or another org's data — pinned by a serialized-JSON leak test.
- [ ] **Sanitization (NFR-004).** Given pasted Word HTML (styles, `mso-` classes, scripts, event handlers, `javascript:` links, data URIs), when saved, then `BodyHtml` is sanitized by the kind's policy once at write; headings/lists/tables/bold/italic and safe links survive; a stored script never executes in another session.
- [ ] **Document attach.** Given `POST /api/press/documents`, then `IDocumentUploadAuthorizer` allows only a human who may release as an org, the file goes through story 02, the response returns `{ mediaId, fileName, pageCount, suggestedHeadline }`, and the first attach is recorded as an explicit `edit` revision (the "drop" timestamp for the drop→publish bench).
- [ ] **Delete own draft only.** Given a draft, when `DELETE` is called by an org member, then it is soft-deleted (XC-010, revisions retained); a scheduled, pending, returned or published release cannot be deleted by a participant (409/403).
- [ ] **No retract route (Q6).** There is no participant endpoint that retracts a published release; a request to the staff retract route with a participant session is 403.
- [ ] **Isolation and gating (XC-001/002).** Routes sit behind `RequireChannelEnabled('press')`; exercise scope comes only from the session; a release/persona/media id from another exercise is 404; the standing isolation suite includes every new route.

## Out of Scope
Publish/schedule/revise/cross-post (05), approval (06), UI (07), telemetry projection (12), the multi-org grant model itself (`identity-auth-roles/09`).

## Technical Notes
Files: `Features/Press/Authoring/**`. `ReleaseOrgResolver` today = the human's bound persona (`Account.PersonaId`) when role = `pio`; swappable later. Rate-limit mutating routes. Reuse F04's `rich-tables` sanitizer profile (FU-5 resolved), F04 revision writer, `ReleaseDek.Derive` from story 01. Wiring test on the real `Program`.

## Dependencies
Story 01, 02; foundation F04. Can run with F05, F06, F07, F11, F12.

## Tests
Service + endpoint tests (authz matrix, version conflicts, coalescing), leak test, sanitizer corpus, isolation additions, wiring test.
