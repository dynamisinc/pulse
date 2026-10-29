# Story: Shell kiosk variant — chrome stripping and the watermark clause (PP-2)

**Feature:** Channels foundation  ·  **Epic:** E3 (platform prerequisite, hosted under E1)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-040 (kiosk-lite subset), PRT-010, NFR-008, COR-031, XC-001, NFR-001  ·  **Design decisions:** D7-008 (kiosk variant), Q-33 (strip banners, chip always on), Q-35 (Tom, 10/29)  ·  **Issue:** #788
**Stack:** frontend  ·  **World:** participant (shell)  ·  **Wave:** 3 (combined **CW3**; must merge by the end of CW4, before portal 18 starts in CW5)  ·  **Effort:** M
**Added by:** the 10/29 follow-up pass (Tom's decision to fold platform prerequisite **PP-2** into the foundation). Previously an unowned prerequisite (portal FU-7 / FU-9) pointing at `participant-shell/06` AC2, "Deferred to Phase 3".

## Context
Portal 18 (kiosk-lite, `/portal?display=1` on the existing shared view-only login) needs the participant shell to render a **kiosk variant**: compliance chrome and channel nav removed, the alert bar kept,
the EXERCISE chip always drawn. The variant flag and `affordancesAvailable('kiosk')` already exist; the chrome stripping (`participant-shell/06` AC2) and the `isWatermarkRequired` kiosk clause do not. This is a
platform change in a Complete shell story, so it is its own story rather than a portal edit: **portal 18 no longer edits `ShellLayout.tsx`**; it consumes `variant: 'kiosk'`. Participant world; no COBRA chrome.
Kiosk-lite scope only: no login-free display, no remote control (post-December, A-13).

## Acceptance Criteria
- [ ] **Chrome stripped.** Given the shell mounted with `variant: 'kiosk'`, when it renders, then the compliance banners and the channel navigation are absent from the DOM and the a11y tree (not hidden by CSS), and content fills the viewport.
- [ ] **Alert bar kept (PRT-010).** Given the kiosk variant and an active alert, when it renders, then the alert bar is present, severity-styled and not color-only, and its live-region behavior is unchanged from the standard variant.
- [ ] **Watermark clause (NFR-008, COR-031, Q-33).** Given `isWatermarkRequired` for `variant === 'kiosk'`, then it returns true, and the EXERCISE chip is always drawn; a test asserts chrome and watermark are never both off in any variant.
- [ ] **No regression.** Given the standard (non-kiosk) variants, when the existing `ShellLayout`/`chromeConfig` suites run, then they pass unchanged, and `ShellLayout.tsx` has no portal-specific code (the kiosk branch is driven only by the variant flag).
- [ ] **Isolation untouched (XC-001).** Given a kiosk-variant render, then no new query, endpoint or storage key is introduced; data access is whatever the shell already does for its session's exercise.
- [ ] **Accessibility and look (NFR-001, D0 §2).** Given the kiosk variant, then axe reports no serious/critical violations, large-type tokens come from the existing brand scope, and no COBRA theme or default MUI look is introduced.

## Out of Scope
The kiosk frame, `KioskGate`, `?display=1` handling and what the screen shows (portal 18/19); a login-free or facilitator-driven display, remote control, per-display credential/realtime group (PP-1/PP-4, post-December); any change to the standard shell variants.

## Technical Notes
Participant world. Files: `features/participant-shell/ShellLayout.tsx`, `features/participant-shell/chromeConfig.ts` and their tests only. Reuse the existing `mountContract` `variant`, `affordancesAvailable('kiosk')`,
`ComplianceChrome` and the alert-bar host. `features/channels/` and `channelRouter/**` are not touched (F12 owns `channelRouter/**`; serialize with F12 only if F12 turns out to touch `ShellLayout.tsx`).
Fallback if it slips: portal 18 still ships the frame with shell chrome visible (a demo-quality regression, not a blocker); the 18/19 cut (DECEMBER-RELEASE § 4 #18) drops this story too. See `implementation.md` § Platform prerequisites.

## Dependencies
None (existing shell). Can run with F05, F06, F07, F11, F12. **Blocks portal 18** (CW5) — must be merged by the end of CW4.
