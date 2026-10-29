# Story: Kiosk route, session and display frame

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-040, PRT-041, COR-053, NFR-001, NFR-008, XC-001  ·  **Design decisions:** D2 brief ("the newsroom wall display"), D7-008 (kiosk variant)  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant (display)  ·  **Wave:** 4  ·  **Effort:** L

## Context
The customer scenario: a TV in a basement (or a back-of-room projector) showing the simulated world during a tabletop. This story builds the **frame**: a login-free route that exchanges a display link for a read-only session, then renders the shell's `kiosk` variant (chrome-free, nav-free, alert bar kept, large type), and keeps itself alive unattended. What the screen shows is 19. The shell's kiosk rendering that participant-shell/06 deferred to Phase 3 is **platform prerequisite PP-2** (owner `participant-shell`, AC2 pulled forward and merged before this story starts); this story consumes `variant: 'kiosk'` and does not edit `ShellLayout.tsx`. Kiosk-lite (cut order 7) uses this same frame with the existing shared read-only login on `/portal?display=1`.

## Acceptance Criteria
- [ ] **Route and exchange.** Given `/display/:token` (outside the participant session shell, orchestrator seam), when it loads, then it reads the token, immediately rewrites the address bar to `/display` (EL-7), sends it once in the body of `POST /api/auth/display`, stores the resulting session for the display only, and the host serves `Referrer-Policy: no-referrer` and `Cache-Control: no-store` for `/display/*`.
- [ ] **Uniform failure.** Given a 401 (revoked, rotated, wrong exercise, lifecycle-refused), then the screen shows a neutral, fiction-safe "This page isn't available" in participant world with no exercise language and no reason; it never reveals which condition applied and does not loop requests.
- [ ] **Kiosk variant (PP-2 consumed).** Given a display session, then the frame mounts the shell in `variant: kiosk` and the shell (PP-2) renders it: compliance chrome and channel nav are **removed**, the **alert bar persists** (PRT-010), the content fills the viewport, there is no scroll, no pointer cursor, and no focusable control; `affordancesAvailable('kiosk')` stays false; the shell overlays (pause, EndEx, break-fiction) still render over the screen.
- [ ] **Watermark forced (NFR-008, PP-2 clause, Q-E3-2).** Given chrome is stripped, then `isWatermarkRequired` is true for `kiosk` (the helper clause ships with PP-2; this story adds the test over the frame) and a permanent EXERCISE chip is drawn in the bottom-right of the frame on every slide (text, AA contrast); a test fails if chrome and the chip are ever both off.
- [ ] **Legible from the back of the room.** Given 1920×1080, then base type is ≥ 28 CSS px and headlines ≥ 56 px, text/background contrast is ≥ 7:1 in the frame's own tokens, and the layout holds at 1280×720 and 3840×2160 without clipping (a viewport matrix test).
- [ ] **Unattended.** Given the screen is left on, then the session refreshes silently before expiry, a dropped connection retries with backoff while **keeping the last content on screen** (no error chrome on the TV), a `navigator.wakeLock` is requested best-effort, and a stale-token refresh failure shows the neutral unavailable page rather than a login prompt.
- [ ] **Read-only and attribution.** Given the frame, then it performs no writes and emits no client telemetry (the server counted the display session, PRT-041); any attempt to call a mutating route is a `403` (05).
- [ ] **Scenario time.** Given the frame's dateline, then it is the large scenario-time dateline through `ScenarioDateline`, never wall clock (COR-053).

## Out of Scope
Slides, the player and polling the display state (19), the console (20), the credential and state APIs (05, 08), fullscreen API control (needs a user gesture; the operator presses F11), audio.

## Technical Notes
Files: `features/portal/kiosk/{session,frame}/**` only (the `ShellLayout.tsx` kiosk branch and the `isWatermarkRequired` kiosk clause are PP-2, built under `participant-shell/06`). Publish `kiosk/frame/types.ts` (the `KioskFrame` props) first so 19 can start. Reuse `mountContract` `variant`, `OverlayLayer`, the easy-login `/join` token handling, `tokenStore` (display sessions in `localStorage`, they have no human to re-enter).

## Dependencies
05, 08 (state contract), **PP-2** (participant-shell/06 AC2 + watermark clause), F11 (bar). Can run with 17, 19-22.
