# Story: Browser e2e harness and viewport kit

**Feature:** Phones and tablets  ·  **Epic:** cross-cutting  ·  **Phase:** 2  ·  **Status:** In Review
**Requirements:** NFR-001, XC-001  ·  **Design decisions:** none  ·  **Issue:** —

## Context
Pulse has no browser e2e today (Brief A3). jsdom cannot measure layout, so 44px targets, horizontal overflow and
wrapped alert text cannot be verified in Vitest. This foundation story adds the first Playwright harness (counts toward
Brief track 7) running against the frontend mock seams, with a viewport matrix and layout assertion helpers that
stories 02-07 and 16 consume. World: tooling, exercises both worlds.

## Acceptance Criteria
- [ ] Given a clean checkout with `npm ci`, when `npm run e2e` runs in `src/frontend`, then Playwright starts the Vite dev server on a dedicated port (not 5198, not 5199) with mock seams active and no backend, and a smoke spec passes in Chromium.
- [ ] Given the fixtures, when a spec calls `loginAs('participant' | 'controller' | 'evaluator' | 'planner')`, then the mock session role is set through the existing guide-shots `localStorage` override seam (reused or extracted, not forked) and the matching world loads.
- [ ] Given `VIEWPORTS`, then it exports exactly: phone 360x740, phone 390x844, tablet-portrait 768x1024, console tablets 1024x768, 768x1024, 1180x820, 820x1180, with touch and mobile emulation on for sub-900px widths.
- [ ] Given a page, `expectNoHorizontalScroll(page)` fails when `document.scrollingElement.scrollWidth > clientWidth`, and `expectTouchTargets(page, locator, 44)` fails listing every interactive element under 44x44 CSS px (excluding inline text links inside running prose, documented).
- [ ] Given a participant page, `expectNoWallClock(page)` fails if a visible timestamp matches the real current wall-clock date/time (scenario time only, COR-053).
- [ ] Isolation (XC-001): a smoke spec asserts a participant session cannot load `/staff/console` content (lands on the participant world), proving the role seam is not leaking.
- [ ] User guide: no guide impact (test tooling); `tools/guide-screenshots/README.md` gains a one-paragraph pointer to the e2e harness.

## Out of Scope
Wiring e2e into `.github/workflows/ci.yml` (separate decision, see feature open questions); cross-browser (WebKit/Firefox)
matrix beyond a documented optional run; visual regression screenshots; any real backend.

## Technical Notes
Adds `@playwright/test` to `src/frontend` devDependencies (flag in the PR: `tools/guide-screenshots` intentionally keeps
its own `playwright-core`, pinned 1.56.1; pick a compatible version). Chromium path: honor `CHROMIUM_PATH` and
`/opt/pw-browsers/chromium` like `capture.mjs`. Exclude `e2e/` from the Vitest `include` (already `src/**`) and from
ESLint app config as needed. Cite `implementation.md` story 01.

## Dependencies
none.

## Tests
The smoke specs themselves; `npm run lint` and `npm run type-check` stay clean with the new directory.
