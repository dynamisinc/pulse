# Story: Compliance chrome (configurable banners)

**Feature:** Exercise configuration  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-031 (XC-003, NFR-008)  ·  **Design decisions:** none  ·  **Issue:** #68

## Context
Government exercises require classification/exercise markings. Compliance chrome is configurable
top/bottom banners (text, e.g. "UNCLASSIFIED // FOR EXERCISE PURPOSES ONLY"; colors) rendered as
**persistent environment chrome outside the simulated app frame**, consistently on every channel — the
Looking Glass green-bar precedent. It can be disabled per exercise, but **never simultaneously with
in-content watermarks off** (COR-031, XC-003, NFR-008).

## Acceptance Criteria
- [ ] Compliance chrome renders as thin top/bottom banners **outside** the simulated app frame,
      consistently across every enabled channel (XC-003), with configurable text and colors.
- [ ] Chrome is configurable per exercise and can be disabled — but the platform **prevents** chrome
      and in-content watermarks (NFR-008) from both being off at once.
- [ ] The banner text/state is not conveyed by color alone (NFR-001) and does not break in-app
      immersion (it's framing, not part of the fiction).
- [ ] Chrome renders on participant surfaces from platform-open.

## Out of Scope
The in-content EXERCISE watermark itself (NFR-008 fast-follow, participant-content concern); per-channel
skins (channel epics); the real-world Break-Fiction overlay (E7 CTL-024 — a different, alien mechanism).

## Technical Notes
Participant world framing. Rendered by the app shell outside each channel's skin subtree. The
chrome-off↔watermark-off mutual guard is enforced centrally. See implementation.md (story 02).

## Dependencies
Story 01 (settings); the participant app shell; NFR-008 watermark slot (fast-follow) for the guard.

## Tests
- Component: chrome renders outside the app frame on every channel; disabling chrome while watermark is
  off is blocked.
