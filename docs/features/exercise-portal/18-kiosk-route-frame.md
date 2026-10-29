# Story: Kiosk-lite — display mode on `/portal?display=1` and the kiosk frame

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21); **re-scoped 10/29 (Q-35: kiosk-lite only)**  ·  **Status:** Not Started
**Requirements:** PRT-040 (kiosk-lite subset), PRT-041, COR-053, NFR-001, NFR-008, XC-001  ·  **Design decisions:** D2 brief ("the newsroom wall display"), D7-008 (kiosk variant), Q-35 (Tom, 10/29)  ·  **Issue:** #782
**Stack:** frontend  ·  **World:** participant (display)  ·  **Wave:** 4 (E3-local; combined **CW5**, after PP-2)  ·  **Effort:** M (was L)

## Context
The customer scenario: a TV in a basement (or a back-of-room projector) showing the simulated world during a tabletop. Tom decided on 10/29 (Q-35) that December ships **portal first and kiosk-lite only**:
the facilitator signs a browser in with the **existing shared view-only login** and opens **`/portal?display=1`**. This story builds the **frame**: the shell's `kiosk` variant (chrome-free, nav-free, alert bar kept,
large type, EXERCISE chip always on) wrapped around the portal, kept alive unattended. **There is no new credential, no `/display/:token` route, no `POST /api/auth/display`, no remote control and no per-display state**
(those are story 05, 08 and 20, Deferred post-December). What the screen shows is story 19.

**Does kiosk-lite need an identity change? No — verified against the code (so PP-1 is no longer a December prerequisite).** The existing `SharedReadOnlyLoginService` (`POST /api/auth/shared`) already issues a
`readonly`-kind, `isReadOnly: true`, persona-less session with a freshly generated ephemeral identity and `actor.kind: 'system'` login telemetry; `ReadOnlySessionWriteFilter` already returns 403 for every
participant write; `TelemetryEnvelopeAuthority` already special-cases `readonly`; readonly sessions use the sliding access/refresh windows (default refresh window 12 h; they are not day-capped like participant sessions).
The shell's `kiosk` variant flag and `affordancesAvailable('kiosk')` already exist; the chrome stripping and the watermark clause are **PP-2** (participant-shell/06 AC2 pulled forward), which stays a December prerequisite.
What kiosk-lite loses versus the Deferred design: per-display revoke (rotating the shared view-only code ends **every** view-only session, including the TV), per-display attribution/`display_session_started`, remote control,
and "refresh until EndEx" (a screen left past the refresh window needs the code re-entered).

## Acceptance Criteria
- [ ] **Entry without a new credential.** Given a session from the existing shared view-only login (`isReadOnly`), when it opens `/portal?display=1`, then a `KioskGate` (an element the orchestrator wires at the `/portal` route above `PortalChannel`) mounts the shell in `variant: 'kiosk'` around `KioskFrame` containing the portal; without `display=1` the gate is a no-op; and `display=1` is **honored only for read-only sessions** — a participant or staff session carrying the parameter renders the normal portal with normal chrome. No new endpoint, credential, anonymous route, `PreAuthAllowlist` entry or identity/telemetry-authority change is introduced (a diff-scope test asserts nothing under `Features/Identity/**` or `Telemetry/**` changed).
- [ ] **Kiosk variant (PP-2 consumed).** Given the frame, then the shell (PP-2) renders it: compliance chrome and channel nav are **removed**, the **alert bar persists** (PRT-010), the content fills the viewport, there is no scroll, no pointer cursor, and no focusable control; `affordancesAvailable('kiosk')` stays false; the shell overlays (pause, EndEx, break-fiction) still render over the screen.
- [ ] **Watermark forced (NFR-008, PP-2 clause, Q-33).** Given chrome is stripped, then `isWatermarkRequired` is true for `kiosk` (the helper clause ships with PP-2; this story adds the test over the frame) and a permanent EXERCISE chip is drawn in the bottom-right of the frame on every render (text, AA contrast); a test fails if chrome and the chip are ever both off.
- [ ] **Legible from the back of the room.** Given 1920×1080, then base type is ≥ 28 CSS px and headlines ≥ 56 px, text/background contrast is ≥ 7:1 in the frame's own tokens, and the layout holds at 1280×720 and 3840×2160 without clipping (a viewport matrix test).
- [ ] **Unattended.** Given the screen is left on, then the session refreshes silently before expiry, a dropped connection retries with backoff while **keeping the last content on screen** (no error chrome on the TV), a `navigator.wakeLock` is requested best-effort, and when the refresh window ends the screen shows a neutral, fiction-safe "This screen needs to be signed in again" with a link to the standard sign-in (view-only code) — never a stack trace, never a request loop.
- [ ] **Read-only and attribution (PRT-041).** Given the frame, then it performs no writes and emits no client telemetry; any attempt to call a mutating route is a `403` from the existing write filter; the session counts as the existing view-only `login` event (ephemeral identity, no person).
- [ ] **Scenario time.** Given the frame's dateline, then it is the large scenario-time dateline through `ScenarioDateline`, never wall clock (COR-053).

## Out of Scope
The slide/portal board content (19); **Deferred (post-December, Q-35): the per-display credential and `/display/:token` route (05), display state and remote control (08), the console display control (20), `PortalDisplay`, PP-1, the `/display/*` hosting headers, per-display revoke and telemetry**; fullscreen API control (needs a user gesture; the operator presses F11), audio.

## Technical Notes
Files: `features/portal/kiosk/frame/**` only (`KioskGate`, `useKioskMode`, `KioskFrame`); the `ShellLayout.tsx` kiosk branch and the `isWatermarkRequired` kiosk clause are PP-2, built under `participant-shell/06`. Publish `kiosk/frame/types.ts` (the `KioskFrame` props) first so 19 can start. Reuse `mountContract` `variant`, `OverlayLayer`, `tokenStore`, the existing read-only session flag from the login envelope. The login page already has the "View-only code" tab (`signInWithSharedCode`); no login UI change.

## Dependencies
06, 07 (skin, layout), **PP-2** (participant-shell/06 AC2 + watermark clause), F11 (bar), F12 (landing). **No longer depends on 05 or 08 (Deferred) or PP-1.** Can run with 17, 19, 21, 22.
