# Story: Composer shows persona context while writing

**Feature:** Persona operation  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-003, COR-020, SOC-054  ·  **Design decisions:** none  ·  **Issue:** #16

## Context
So a persona stays in character across controllers, the composer shows the persona's context while
writing (CTL-003): voice/personality notes (COR-020), a few recent posts, and audience magnitude
(SOC-054). This is what lets a controller pick up "Darco Tripp — mildly grumpy, short sentences" and
reply in-voice within seconds without having authored the persona themselves.

## Acceptance Criteria
- [ ] Given an active persona, when the composer is open, then it displays the persona's
      voice/personality notes (COR-020), its recent posts, and its audience magnitude band (SOC-054).
- [ ] Changing the active persona (story 02) updates the context panel to the new persona without a
      full reload.
- [ ] The panel is read-only reference (it does not let the controller edit the persona template
      here) and does not obstruct the fire path.
- [ ] The context data is scoped to the active exercise's persona instance (COR-001/003) — recents
      reflect this exercise's history, not another exercise's.
- [ ] Accessible: the panel is reachable and legible via keyboard/screen reader alongside the
      composer (NFR-001).

## Out of Scope
Editing the persona template (E1 persona management); audience-magnitude math itself (defined with
SOC-054 in E2); the picker (story 02).

## Technical Notes
Staff world (COBRA). Reads the persona via `personaService`; reuses the E1 persona fields. Audience
magnitude is displayed from SOC-054, not recomputed here. See implementation.md (story 03).

## Dependencies
E1 persona voice notes (COR-020) + audience magnitude (SOC-054); story 02 (active persona). Feeds
in-character quality of story 01.

## Tests
- Component (RTL): the panel renders voice notes, recents, and audience magnitude for the active
  persona and updates when the active persona changes.
- Unit: recents query is scoped to the active exercise instance.
