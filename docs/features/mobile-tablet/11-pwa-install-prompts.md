# Story: PWA: install prompts (Android and iOS)

**Feature:** Phones and tablets  ·  **Epic:** E1 (shell)  ·  **Phase:** 2  ·  **Status:** Built, pending wiring + real-device check (MT-D7)
**Requirements:** NFR-001, COR-053 (no wall-clock), D0 §2 (no enterprise look)  ·  **Design decisions:** none  ·  **Issue:** #524

## Context
Offer participants a way to add the exercise to their home screen. Android/Chrome fires `beforeinstallprompt`; iOS Safari has
no event, so we show brief instructions. The prompt is part of the fiction's world: branded with the exercise name, never
Pulse/Dynamis, never enterprise styling. Participant world.

## Acceptance Criteria
- [x] Given Chrome on Android with an installable page (stories 09-10), when `beforeinstallprompt` fires, then the event is held and an unobtrusive, exercise-branded banner offers "Add [brand name] to your home screen"; tapping it calls `prompt()`; the banner is at least 44px tall actions and never overlaps the alert bar, composer or bottom tab bar. _(Unit-tested with a synthetic event. Real Android check by Tom.)_
- [x] Given iOS Safari (no event) in a non-standalone session, when the participant has visited at least twice (or opens the in-feed menu entry), then a sheet explains Share -> Add to Home Screen with an inline icon and text steps (FontAwesome, not color-only), dismissible, never auto-reopening within the same exercise after dismissal. _(Visit threshold implemented; the "in-feed menu entry" alternative is NOT built: no such menu exists yet. UA heuristic documented in `install/installEnv.ts`. Real iOS check by Tom.)_
- [x] Given display-mode standalone or the app already installed, then no prompt or banner appears.
- [x] Given dismissal, then it persists per exercise (storage key includes `exerciseId`) and never carries to another exercise or leaks a brand across exercises (XC-001/002).
- [x] Given a staff route or an unresolved brand, then no prompt is shown (two-worlds; brand must be resolved). _(Inherited from PwaRoot gates, plus the prompt needs an exercise id.)_
- [x] Given a screen reader and keyboard, then the banner/sheet is reachable, labelled, dismissible with Escape, and focus is not stolen from the feed. _(Region/dialog labelled, close buttons labelled, Escape dismisses, never autofocuses. Not screen-reader tested on device.)_
- [x] No-enterprise-look: uses the participant brand skin tokens (`--pulse-brand-*`), no COBRA or default MUI components.
- [ ] User guide: `docs/guide/participant-guide.md` "Add to home screen" steps for Android and iOS with screenshots (iOS sheet and Android banner via mock overrides). _(Steps written in `participant-guide.md`; SCREENSHOTS NOT DONE.)_

## Out of Scope
Push notification opt-in, in-app camera, offline, a staff PWA install prompt.

## Technical Notes
Files: `features/pwa/install/*`; one `<InstallPrompt />` line in `PwaRoot.tsx`. iOS detection by UA + `navigator.standalone` is best-effort;
document the heuristic. Resolved by MT-D5: install interactions emit NO telemetry. See `implementation.md` story 11.

## Dependencies
Story 09 (brand + manifest); story 10 for installability on Chrome.

## Tests
`InstallPrompt.test.tsx` (event handling, persistence key, standalone suppression), `e2e/pwa-install.spec.ts` dispatching a synthetic
`beforeinstallprompt`. Manual on real iOS and Android.
