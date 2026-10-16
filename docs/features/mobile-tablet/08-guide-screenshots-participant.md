# Story: Phone/tablet guide screenshots and participant guide

**Feature:** Phones and tablets  ·  **Epic:** cross-cutting  ·  **Phase:** 2  ·  **Status:** Not Started
**Requirements:** docs-as-done (Brief C5)  ·  **Design decisions:** none  ·  **Issue:** —

## Context
`tools/guide-screenshots` captures participant shots at a single 390x844 phone viewport and decides mobile emulation by
comparing the viewport object to `MOBILE`. Extend it with 360 and 768 variants, recapture the participant shots after the
B1 fixes, and add a short phone/tablet section to the participant guide. Kept as one tiny docs-and-tools story rather than
a line in every story, because `capture.mjs` is one file.

## Acceptance Criteria
- [ ] Given `capture.mjs`, when viewports are declared, then mobile and touch emulation is driven by a flag on the viewport, not object identity, and `--list` prints shot names including size suffixes.
- [ ] Given `node capture.mjs participant-feed participant-alert-bar participant-composer participant-thread`, then each is produced at 390 (existing file names unchanged) and the new `-360` / `-tablet` (768x1024) variants, with no spinner, empty state or wrong page (visually opened).
- [ ] Given the alert-bar shot, then it shows the wrapped full message and the Details link, replacing the pre-fix image.
- [ ] Given `docs/guide/participant-guide.md` and its printable one-pager, then they state supported phones/tablets, how to add the exercise to the home screen (after stories 09-11 land, link only), and use the new images with alt text.
- [ ] Given the mock-only rule, then no shot contains real data and any tokens are `MockTkn...` placeholders.

## Out of Scope
Controller tablet shots and controller guide (story 16), a visual-regression pipeline, CI wiring.

## Technical Notes
Files: `tools/guide-screenshots/capture.mjs`, `docs/guide/participant-guide.md`, `docs/guide/img/*`. Participant roles only. Do
not add dependencies. Exports `TABLET`/`PHONE_SMALL` constants for story 16. See `implementation.md` story 08.

## Dependencies
Stories 02, 03, 04, 05 (so the shots show fixed screens).

## Tests
Manual: run the capture and open every PNG. README updated with the new viewports.
