# Story: Release kind, press contracts and org newsrooms

**Feature:** Press Room  ·  **Epic:** E5  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRS-010, PRS-012, PRS-001 (org identity), PRS-005 (model), XC-004 (vocabulary)  ·  **Design decisions:** D4-008, D4-005  ·  **Issue:** —
**Stack:** fullstack  ·  **World:** data + participant contracts  ·  **Wave:** 3  ·  **Effort:** M

## Context
E5's registration with the shared pipeline: the `release` kind descriptor (FC-1 additive registry, FC-7 `IContentKindDescriptor`), the E5-owned contracts PC-1..PC-5
(`implementation.md`), and one child `Outlet` per publishing org under The Wire Room (foundation Q2 default; FC-2 `ParentOutletId`, skin inherited). Everything later in E5 imports this story's names.

## Acceptance Criteria
- [ ] **Descriptor registered.** Given the app starts, when the funnel (F04) resolves kind `release`, then `ReleaseKindDescriptor` answers with `ChannelId = press`, `AllowedMediaKinds = image + document`, `BodyPolicy` = F04's built-in **`rich-tables`** profile (no new profile; press FU-5 resolved), and an unregistered kind elsewhere is still a 400.
- [ ] **Payload validation (PC-1).** Given a release payload, when validated, then `orgPersonaId` must be a persona in the same exercise (another exercise's id answers exactly like an unknown id), `document.mediaId` must be an exercise-owned `document` asset, contact fields are length-capped plain text, and an invalid payload is a readable 400.
- [ ] **Participant-safe projection.** Given a stored release, when `ProjectPayload` runs, then the output contains only org name/letterhead ref, `contact`, `dateline` and `document { mediaId, fileName, pageCount }`, and never `crossPost`, `approval` or `inputPath` (XC-002) — pinned by a leak test over the serialized JSON.
- [ ] **Org newsrooms (PRS-012, Q2).** Given an exercise with The Wire Room outlet and N publishing org personas, when `OrgNewsroomProvisioner` runs (exercise setup and on org grant), then exactly one child outlet per org exists with `ParentOutletId` = The Wire Room, `PairedPersonaId` = the org persona, the org logo as `LogoMediaId`, and running it twice creates no duplicates.
- [ ] **Letterhead defaults.** Given an org outlet, then its default contact block and address live in `SkinOverridesJson.ext.press.letterhead` (size-capped, F03 allowlist permits `ext.press`), and an org without them gets a neutral letterhead, never a platform-branded one.
- [ ] **Contracts and fixtures.** PC-2 C# records and TS types + runtime guards + mock fixtures exist (published, embargoed, returned, pending-approval, retracted tombstone) and the guards reject a payload carrying staff-only keys.
- [ ] **Summary guarantees for portal rows (R-P1).** Given a published release, then its `ChannelContentSummaryDto` always has `outlet.name` = the **publishing organization's** name (the child newsroom outlet's name, never "The Wire Room"), and a **non-empty `dek`**: a pure `ReleaseDek.Derive(headline, bodyText, orgName)` returns the first sentence of the body text (≤ 160 chars, whole words) or, for a headline-only release, `"News release from {orgName}"`; a test covers body, headline-only, body that starts with a list/table, and an HTML-only body. Embargoed (scheduled) releases never appear in any list (restated F05/F06 invariant, proven in 15).
- [ ] **Telemetry vocabulary (XC-004).** `PressTelemetry` emits every PC-5 event (the `eventType` strings are registered once by foundation story 02, FC-6b; this story declares the payload shapes) with the v0 envelope (wall + scenario time, actor incl. `actingHumanId` and `orgPersonaId`, `channel: 'press'`); emitting an undeclared type fails a test.
- [ ] **Gate seam.** `IReleaseApprovalGate` ships with a pass-through default so stories 04/05 do not depend on story 06.
- [ ] **Isolation (XC-001).** All new reads/writes go through `PulseDbContext`; a cross-exercise persona/outlet/media id in any payload is rejected as unknown.

## Out of Scope
Endpoints (04/05/06), the approval implementation (06), the wire UI (09), skin values (09), the document media kind itself (02), the group-wide outlet admin (F03/F17).

## Technical Notes
Participant-world contracts; no UI. Files: `Features/Press/{Contracts,Kind,Outlets}/**`, `features/press/{contract,mocks}/**`. Uses F03 `OutletService` (child outlets), F02 interfaces, F04's built-in `rich-tables` profile (FU-5 resolved). Never edits `ContentItem` or foundation files. `Program.cs` `AddPress()` is orchestrator-owned; ship the wiring test.

## Dependencies
Foundation F02, F03, F04. Can run with 04, F05, F06, F07, F11, F12.

## Tests
Descriptor validation + projection leak tests; provisioner idempotence; `WebApplicationFactory<Program>` wiring test; TS guard tests over fixtures.
