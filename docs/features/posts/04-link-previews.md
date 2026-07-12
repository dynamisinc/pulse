# Story: Link previews for in-sim URLs

**Feature:** Posts  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-004  ·  **Design decisions:** none  ·  **Issue:** #95

## Context
Posts support link previews for in-simulation URLs — news articles (E4), press releases (E5), weather
alerts (E6) — rendering title/image cards like real platforms (SOC-004). In Phase 1 (pilot mode) the
in-sim targets are limited; the card mechanism ships now and light up as channels land.

## Acceptance Criteria
- [ ] A post containing an in-simulation URL renders a preview card (title, optional image, source)
      like a real platform.
- [ ] Preview cards resolve **only** in-simulation, exercise-scoped targets (COR-001/002) — no external
      link fetching; a foreign-exercise URL does not preview (403/404).
- [ ] Cards degrade gracefully when the target channel doesn't exist yet (Phase-1 pilot: news/press/
      weather arrive in Phase 3) — a plain link, not a broken card.
- [ ] Card rendering is participant-world styled and sanitized (NFR-004).

## Out of Scope
The target channels themselves (E4/E5/E6); external-URL previews (never — in-sim only); media upload
(story 01).

## Technical Notes
Participant world. Preview resolution is server-side against in-sim, exercise-scoped content; no
outbound fetch. See implementation.md (story 04).

## Dependencies
E1 isolation (scoped resolution); E4/E5/E6 targets (Phase 3, graceful until then).

## Tests
- Unit/component: an in-sim URL renders a scoped preview card; a cross-exercise URL does not preview.
