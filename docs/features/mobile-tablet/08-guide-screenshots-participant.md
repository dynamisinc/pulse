# Story: Phone/tablet guide screenshots and participant guide

**Feature:** Phones and tablets  ·  **Epic:** cross-cutting  ·  **Phase:** 2  ·  **Status:** In Review
**Requirements:** docs-as-done (Brief C5)  ·  **Design decisions:** none  ·  **Issue:** #524

## Context
`tools/guide-screenshots` captures participant shots at a single 390x844 phone viewport and decides mobile emulation by
comparing the viewport object to `MOBILE`. Extend it with 360 and 768 variants, recapture the participant shots after the
B1 fixes, and add a short phone/tablet section to the participant guide. Kept as one tiny docs-and-tools story rather than
a line in every story, because `capture.mjs` is one file.

## Acceptance Criteria
- [x] Given `capture.mjs`, when viewports are declared, then mobile and touch emulation is driven by a flag on the viewport, not object identity, and `--list` prints shot names including size suffixes. *(Viewports moved to `viewports.mjs` with a `mobile` flag and a `suffix`; a shot's `variants` list expands into `<name>-<suffix>` jobs. A base name on the command line selects the shot and its variants.)*
- [x] Given `node capture.mjs participant-feed participant-alert-bar participant-composer participant-thread`, then each is produced at 390 (existing file names unchanged) and the new `-360` / `-tablet` (768x1024) variants, with no spinner, empty state or wrong page (visually opened). *(12/12, all opened. The other four participant shots, join / sign-in / alerts / holding page, were recaptured too so the guide matches the B1 fixes.)*
- [x] Given the alert-bar shot, then it shows the wrapped full message and the Details link, replacing the pre-fix image.
- [x] Given `docs/guide/participant-guide.md` and its printable one-pager, then they state supported phones/tablets, how to add the exercise to the home screen (after stories 09-11 land, link only), and use the new images with alt text. *(An "On a phone or tablet" section with the `-360` and `-tablet` feed images and alt text, plus "Add it to your home screen" for Android and iPhone now that B2 (#605) is on main; it mentions the iOS sign-in-again step from #606. There is no separate participant one-pager; the guide itself is the keep-it-handy page. Device wording is kept to "your normal browser" until WebKit/real-device checks land.)*
- [x] Given the mock-only rule, then no shot contains real data and any tokens are `MockTkn...` placeholders. *(All shots use the Coastal Surge mock; none shows a token.)*

## Out of Scope
Controller tablet shots and controller guide (story 16), a visual-regression pipeline, CI wiring.

## Technical Notes
Files: `tools/guide-screenshots/capture.mjs`, `docs/guide/participant-guide.md`, `docs/guide/img/*`. Participant roles only. Do
not add dependencies. Exports `TABLET`/`PHONE_SMALL` constants for story 16. See `implementation.md` story 08.

## Dependencies
Stories 02, 03, 04, 05 (so the shots show fixed screens).

## Tests
Manual: run the capture and open every PNG. README updated with the new viewports.

Note: run the capture from a checkout with its own `src/frontend/node_modules`. A symlinked `node_modules` (e.g. a git worktree) sits outside Vite's serving allow-list, so the brand font is blocked and the shots fall back to a system font.
