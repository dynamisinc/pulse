# Story: Press Room latest module

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-003, PRT-006, COR-053, XC-001, NFR-001  ·  **Design decisions:** D2-005  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 3  ·  **Effort:** S

## Context
PRT-003 lists "Press Room latest (E5)". A compact list of the most recent public releases on the wire, each linking to the release page. It is the "what are organizations saying" counterpart to Top Stories, and the proof that participant-authored releases (E5 is the only participant-authored channel) show up in the public front door.

## Acceptance Criteria
- [ ] **List.** Given `useContentList({ channelId: 'press', limit: 5 })`, when the module renders, then it shows up to five rows, each with the publishing organization (outlet name, as text), headline, dek (R-P1) and scenario dateline, newest first.
- [ ] **Links.** Given a row, when activated, then it goes to the release's host-relative `permalink` (`/press/{org}/{slug}`), and "See all →" goes to `/press` only when `press` is enabled.
- [ ] **Never early (PRS-003).** Given an embargoed or scheduled release, then it never appears (a fixture test asserts the list contains only `published` items); a retracted release disappears on `ContentRetracted`; a revised release shows its current headline after `ContentRevised`.
- [ ] **Live (PRT-006).** Given `ContentPublished` on the press channel, then the new row appears at the top without a refresh, coalesced to at most one polite announcement per 5 s, and the list never reflows under the reader's focus.
- [ ] **Letterhead restraint.** Given the module, then it renders text rows only (no org logos or letterhead art, which belong on the release page) in the portal's own tokens, with no platform label such as "official" or "verified".
- [ ] **Empty, mobile, a11y.** Given no releases, `press` disabled or a fetch error, then the module hides cleanly; at 320 px rows are single-column with ≥ 44 px targets; axe is clean.

## Out of Scope
Authoring (E5), org newsroom pages, filters, the release page itself.

## Technical Notes
Files: `features/portal/modules/pressLatest/**` (+ `register.ts`). Reuse F15 hooks and F09 stream. R-P1 is **applied in press stories 01/04/09/15**: every release summary has a non-empty derived `dek` and `outlet.name` = the publishing org, and scheduled/embargoed releases never appear in any list, so rows are never headline-only and this story has no fallback path.

## Dependencies
02, 07, F06, F15, press 01. Can run with 08-10, 12-16.
