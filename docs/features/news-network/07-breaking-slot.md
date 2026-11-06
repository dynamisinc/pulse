# Story: Breaking-news slot (authorial, empty by default)

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-012, NWS-002, NFR-001  ·  **Design decisions:** D3-P4, D3-P1 (slot 3), D3-P2  ·  **Issue:** #724
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** E4-1  ·  **Effort:** S

## Context
NWS-012 sharpened by D3-P4: breaking is a **slot**, empty by default, that fills only by controller/authorial action (the article's `payload.breaking.text`, story 01). The outlet screams
BREAKING, Pulse never does: banner style and vocabulary are skin tokens ("BREAKING NEWS" / "News Alert" / "EXCLUSIVE!!"), and the platform adds no badge (SOC-002 parity; FC-9.5).

## Acceptance Criteria
- [ ] **Empty by default.** Given an article with `payload.breaking = null`, then no element, spacing or landmark is rendered for the slot in any skin (the head block is not pushed down); given a breaking text, the banner renders above the kicker.
- [ ] **Skin vocabulary + style.** Given `payload.breaking.text` and a skin, then the label comes from `skin.breaking.vocabulary` and the banner treatment from `skin.breaking.style` (e.g. Newsline 7 red full-width bar with ● LIVE, Courier-Ledger understated rule + small caps, National Wire "URGENT"-style slug line, The Scoop rotated "EXCLUSIVE!!" flag); text is the controller's `breaking.text` verbatim, never rewritten or uppercased by the platform beyond the skin's declared case.
- [ ] **Zero platform chrome.** A test greps the rendered DOM for any platform-authored breaking/alert/exercise string; the only breaking strings present are `skin.breaking.vocabulary` and `payload.breaking.text`. Setting breaking on one article never alters the alert bar (the bar is shell-owned; an alert is a separate explicit publish option, story 01/foundation 17).
- [ ] **Not color-only (NFR-001).** The banner carries its label text and a shape/weight cue in addition to color; contrast of banner text over `palette.breaking` is ≥ 4.5:1 or the foundation skin scope clamps it; a rotated Scoop flag is a static tilt (never animated) and stays legible at AA.
- [ ] **Live change.** Given the controller sets or clears breaking while a participant reads (`ContentRevised`, foundation 09/15), then the slot appears/clears without page reload, and a polite live-region announcement reads the banner text once (coalesced via `LiveRegionAnnouncer`); it does not use assertive.
- [ ] **Same banner on home.** The exported `BreakingBanner` is reused by the outlet home (15) for the lead story's breaking state; skins render identically in both places.

## Out of Scope
Raising an alert-bar entry (foundation 10/17); a controller control to toggle breaking (17); a sitewide "breaking ticker" (not in the epic); push notifications.

## Technical Notes
Participant world. Files: `src/frontend/src/features/news/breaking/{BreakingSlot,BreakingBanner}.tsx` + tests. Props `{ item, skin }`. Setting or clearing the banner after publish is a payload-only `revise` with `touchUpdatedStamp: false` (F04/F07, FC-1 Updated stamp rule), so it does not move the "Updated" stamp; the controller may choose a visible `update` instead.

## Dependencies
Foundation 13, 14 (`LiveRegionAnnouncer`), 02; E4 01 (payload shape). Can run with 03, 05, 06, 08–14.
