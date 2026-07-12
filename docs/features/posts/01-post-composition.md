# Story: Post composition (text / media / hashtags / mentions)

**Feature:** Posts  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-001  ·  **Design decisions:** D1-R5  ·  **Issue:** #92

## Context
A participant composes a post: text (280-char default, per-exercise configurable), 0–4 images or 1
video (inline playback — the Utube replacement path), hashtags, @mentions, and an optional location tag
(SOC-001). The composer feels like X — an X-style depleting ring character counter, count text
appearing at ≤20 remaining (D1-R5).

## Acceptance Criteria
- [ ] A participant can compose and publish a post with text up to the configured limit (280 default),
      0–4 images **or** 1 video (inline playback), parsed hashtags/@mentions, and an optional location.
- [ ] The composer shows an X-style depleting **ring counter**; count text appears at ≤20 chars
      remaining and an amber low state near the limit (D1-R5).
- [ ] Post text and media are **sanitized/validated** before publish (HTML sanitization, MIME/size,
      NFR-004) — a script in a post never executes in another session.
- [ ] Publishing emits a telemetry event (XC-004) and the post renders in scenario time (COR-053,
      story 03/02).
- [ ] The composer is a **participant surface** — Pulse skin, no COBRA/default-MUI look (D0); in
      **observer mode** the composer/Post is **absent** (not disabled; D1-011).

## Out of Scope
Author-identity rendering (story 02); provenance capture detail (story 03); link-preview cards (story
04); the "Posting as" org chip (story 06); quote-post/media-rich composer states (D1 backlog).

## Technical Notes
Participant world (Pulse skin). Reuse the shared compose pipeline; sanitize on the publish path. The
composer exists inline (feed) + as a modal (D1). See implementation.md (story 01).

## Dependencies
E1 isolation/session; scenario clock (COR-053); telemetry (XC-004); NFR-004 sanitization. Feeds every
other E2 surface.

## Tests
- Unit: char-limit + ring-counter thresholds; sanitizer strips a stored-XSS payload.
- Component (RTL): compose+publish a post with hashtags/mentions/media; observer mode renders no composer.
