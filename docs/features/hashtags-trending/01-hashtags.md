# Story: Hashtags (parse / linkify / feed)

**Feature:** Hashtags & trending  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-040  ·  **Design decisions:** none  ·  **Issue:** #106

## Context
Hashtags are parsed from post text, linkified, and searchable; tapping a hashtag shows its feed
(chronological + "top" tab) (SOC-040).

## Acceptance Criteria
- [ ] Hashtags in post text are parsed and rendered as links (participant-world styled).
- [ ] Tapping a hashtag opens its feed with **chronological** and **top** tabs, exercise-scoped
      (COR-001).
- [ ] Hashtags are searchable (feeds-discovery search SOC-082).
- [ ] Timestamps in the hashtag feed render in scenario time (COR-053).

## Out of Scope
Trending computation (story 02); search UI (feeds-discovery SOC-082).

## Technical Notes
Participant world. Hashtag parse in the post render; hashtag-feed route reuses feed rendering. See
implementation.md (story 01).

## Dependencies
posts (text/PostCard); feeds-discovery (feed rendering).

## Tests
- Unit: hashtag parse/linkify; component: tapping a hashtag opens its chrono/top feed scoped to the
  exercise.
