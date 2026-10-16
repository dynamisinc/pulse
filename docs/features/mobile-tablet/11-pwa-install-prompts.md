# Story: PWA: install prompts (Android and iOS)

**Feature:** Phones and tablets  ·  **Epic:** E1 (shell)  ·  **Phase:** 2  ·  **Status:** Not Started
**Requirements:** NFR-001, COR-053 (no wall-clock), D0 §2 (no enterprise look)  ·  **Design decisions:** none  ·  **Issue:** #524

## Context
Offer participants a way to add the exercise to their home screen. Android/Chrome fires `beforeinstallprompt`; iOS Safari has
no event, so we show brief instructions. The prompt is part of the fiction's world: branded with the exercise name, never
Pulse/Dynamis, never enterprise styling. Participant world.

## Acceptance Criteria
- [ ] Given Chrome on Android with an installable page (stories 09-10), when `beforeinstallprompt` fires, then the event is held and an unobtrusive, exercise-branded banner offers "Add [brand name] to your home screen"; tapping it calls `prompt()`; the banner is at least 44px tall actions and never overlaps the alert bar, composer or bottom tab bar.
- [ ] Given iOS Safari (no event) in a non-standalone session, when the participant has visited at least twice (or opens the in-feed menu entry), then a sheet explains Share -> Add to Home Screen with an inline icon and text steps (FontAwesome, not color-only), dismissible, never auto-reopening within the same exercise after dismissal.
- [ ] Given display-mode standalone or the app already installed, then no prompt or banner appears.
- [ ] Given dismissal, then it persists per exercise (storage key includes `exerciseId`) and never carries to another exercise or leaks a brand across exercises (XC-001/002).
- [ ] Given a staff route or an unresolved brand, then no prompt is shown (two-worlds; brand must be resolved).
- [ ] Given a screen reader and keyboard, then the banner/sheet is reachable, labelled, dismissible with Escape, and focus is not stolen from the feed.
- [ ] No-enterprise-look: uses the participant brand skin tokens (`--pulse-brand-*`), no COBRA or default MUI components.
- [ ] User guide: `docs/guide/participant-guide.md` "Add to home screen" steps for Android and iOS with screenshots (iOS sheet and Android banner via mock overrides).

## Out of Scope
Push notification opt-in, in-app camera, offline, a staff PWA install prompt.

## Technical Notes
Files: `features/pwa/install/*`; one `<InstallPrompt />` line in `PwaRoot.tsx`. iOS detection by UA + `navigator.standalone` is best-effort;
document the heuristic. Open question for Tom: whether install interactions should emit an XC-004 event (not an in-fiction action; default is no). See `implementation.md` story 11.

## Dependencies
Story 09 (brand + manifest); story 10 for installability on Chrome.

## Tests
`InstallPrompt.test.tsx` (event handling, persistence key, standalone suppression), `e2e/pwa-install.spec.ts` dispatching a synthetic
`beforeinstallprompt`. Manual on real iOS and Android.
