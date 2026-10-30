# Story: The wire, org newsrooms and release page

**Feature:** Press Room  ·  **Epic:** E5  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRS-010, PRS-011, PRS-012, PRS-005 (markers), PRS-003 (author-visible scheduled state)  ·  **Design decisions:** D4-003, D4-008, D4-012 (watermark slot), D4-001  ·  **Issue:** #745
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 5  ·  **Effort:** L

## Context
What citizens, media and officials read: The Wire Room (reverse-chron list with org letterhead, org filter), each org's newsroom ("the county's website newsroom"), and the release page
(letterhead, headline, contact block, the rich body with an optional PDF **attachment** to download, revision markers). Public to **all** participants, citizens included (D4-008). Austere, credible, letterhead-forward — a deliberate contrast
with Social's noise; never a CMS look. Mounts via `registerChannel('press')` on the foundation router (F12).

## Acceptance Criteria
- [ ] **Channel mount.** Given the press channel is enabled, then `/press`, `/press/:outletSlug` and `/press/:outletSlug/:contentSlug` render inside the shell under `OutletSkinScope` for `wire-room`; disabled → the shell's participant-world not-found (F08/F12).
- [ ] **The wire (PRS-010).** Given published releases, then the wire lists them newest-first by `publishedScenarioTime` with each org's letterhead/logo, headline, the non-empty derived dek (`ReleaseDek`, R-P1), the publishing org as the row's source (`outlet.name`), scenario-time dateline (`ScenarioDateline`), an org filter (by newsroom), live-updating via `useChannelStream` (new item announced politely, no jump while reading), and a staged empty state; open to every participant role with no PIO gating on read.
- [ ] **Org newsroom (PRS-012).** Given `/press/:outletSlug`, then only that org's releases show under its letterhead; an unknown or other-exercise slug is the same not-found.
- [ ] **Release page (PRS-011).** Given a release permalink, then it renders letterhead, "FOR IMMEDIATE RELEASE" + dateline, headline, contact block, the sanitized rich body (`SanitizedBody`) and, when present, a **PDF attachment block** (file name, size, a "Download PDF" link to the signed attachment URL — no inline rendering; inline pages are post-December, story 03), the org's attached images with `ExerciseBands` when required, and a "Join the discussion on Pulse" link when `pairedPostId` exists.
- [ ] **Revision markers (PRS-005, COR-053).** Given an `update` revision, then the page shows "Updated 14:32" in scenario time with the optional note; prior versions are not shown to the public (author/staff only, story 11); a `silent_rewrite` shows no marker.
- [ ] **Author-visible embargo (PRS-003, D4-003).** Given an org member views their own embargoed release (wire row and `/press/…` permalink, which 404s from the public route), then the amber "SCHEDULED — releases in 19m" chip (story 07's `ScheduledChip`) shows on the author's wire row and on the permalink, via the author endpoint fallback; a non-member gets the ordinary not-found; the public wire never lists it.
- [ ] **Retracted tombstone (XC-010, Q1).** Given a retracted release, then the permalink shows the in-fiction tombstone in the Wire Room skin (no headline, "This release has been withdrawn" with scenario time), and the wire row disappears live on `ContentRetracted`.
- [ ] **Watermark and chrome (NFR-008, D4-012).** The release page reserves the `WatermarkSlot` (bottom-right chip over imagery) when `isWatermarkRequired`; chrome and watermark are never both off; the platform adds no BREAKING/"exercise"/"sponsored" chrome inside the page (FC-9.5).
- [ ] **Skin (FU-1 resolved).** This story registers the final `wire-room` tokens with `registerSkinTokens('wire-room', …)` (replacing F13's stub) and the `ext.press` schema with `registerSkinExtension('press', …)`; the token file carries institutional letterhead values; per-org logo/letterhead overrides come from the outlet's `SkinOverridesJson`; no COBRA theme, no default MUI look, FontAwesome only.
- [ ] **Telemetry (XC-004).** Opening a release permalink emits the client `article_view` with `payload.kind = 'release'` once per session+item (F15 hook); no event is emitted for list scrolling; nothing is emitted twice for server-side events.
- [ ] **Accessibility (NFR-001, #680, 508).** Landmarks (`main`, newsroom `nav`), logical headings, filters keyboard-operable, new-release announcements in a polite live region, the attachment link has a descriptive accessible name ("Download PDF: {fileName}, {size}"), all text AA contrast, axe clean on wire, newsroom, release and tombstone.
- [ ] **Mobile-first.** At 360px the wire is a single column, letterhead compact, org filter a bottom sheet/select, the attachment block is a full-width tap target.
- [ ] **Isolation (XC-001).** All reads go through the F06/F15 hooks (`useContentList`, `useContentItem`) which carry no exercise id; cross-exercise permalinks 404.

## Out of Scope
The composer (07/08), approval UI (10), the portal's Press Room module (PRT-003, E3), link-preview (F06), search, comments, share buttons beyond the foundation's, the weather/news pages.

## Technical Notes
Files: `features/press/{wire,release,skin}/**`, `features/press/index.ts` (`registerPress()` — one `registerChannel('press', …)` call, wired by the orchestrator). Skin token values are registered from `features/press/skin/` through F13's `registerSkinTokens` / `registerSkinExtension` (no foundation file is edited; F13's `wire-room` stub is the pre-registration fallback). The author-only fallback (author endpoint on a public 404) renders `ChannelNotFound` itself on a final 404 (F12 leaves it to the page). Runs on `features/press/mocks/` + F15 mocks until F06 is live.

## Dependencies
Stories 01; foundation F06, F09, F12, F13, F14, F15; story 07 for `ScheduledChip` (**no longer depends on story 03**). Can run with 08, 10, 11, 12, 13, 14.

## Tests
RTL per page and state (live add, retract, embargoed-author, tombstone); axe sweep; skin-isolation test (no COBRA import — lint check); scenario-time formatting tests.
