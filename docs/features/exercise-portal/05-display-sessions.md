# Story: Display sessions (kiosk link and read-only session)

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-040, PRT-041, NFR-009, XC-001, XC-002, XC-004  ·  **Design decisions:** none (EL-5/7/8/11/16 reused; Master decision 10)  ·  **Issue:** —
**Stack:** backend  ·  **World:** foundation  ·  **Wave:** 2  ·  **Effort:** L  ·  **Review:** Tier-2 (a new anonymous credential endpoint, always-Critical class)

## Context
PRT-040 asks for a "login-free" display view. A kiosk must never be anonymous access to data (XC-001): it is a **revocable bearer link for one exercise**, exchanged for a **read-only session** that cannot write, cannot act as any persona and is attributed to a *display*, not a person (PRT-041; review finding D9). This story is the credential's whole backend life; the display's content state is story 08. It follows easy-login's personal-link design (token primitives, uniform 401, rotate ends sessions) rather than inventing a second one. Fallback if it slips: kiosk-lite (cut order 7).

## Acceptance Criteria
- [ ] **Exchange.** Given an active display link in the host-resolved exercise and an exercise in Staged/Live/Paused/Completed (EL-11, `IsParticipantSignInAllowed`), when `POST /api/auth/display { "token": "…" }` is called, then it answers `200` with the `/api/auth/login` envelope for a **read-only, persona-less** session whose purpose is `display` (`isReadOnly: true`), and sets the display's `LastSeenWallClock`.
- [ ] **Uniform refusal.** Given an unknown, malformed, revoked, superseded (rotated), other-exercise or lifecycle-refused (Build/Archived) token, or an unresolved host, then the answer is the **same bodyless 401** with the same work and timing class (one hash lookup); a missing body or empty `token` is `400`; the route has its own `display-session` rate-limit policy (default 30/min/IP, `429` beyond, config-driven, EL-16).
- [ ] **Read-only is enforced.** Given a display session, when it calls any mutating participant route (post, reply, reaction, DM, follow, upload, telemetry ingest) or any staff route, then the response is `403` (the `ReadOnlySessionWriteFilter` rule extended to the `display` purpose); reads of the host exercise's participant routes work, and a cross-exercise read is the usual 404.
- [ ] **Staff lifecycle.** Given a controller or planner (the `RosterStaffRoleFilter` pattern), when they `POST /api/displays` (name, ≤ 10 per exercise), `GET /api/displays`, `rotate-link` or `revoke`, then create mints a 128-bit base64url token stored as hash + protected copy (EL-5), `GET` returns a reprintable `link` built by the easy-login link builder (staff-only, absolute), **rotate and revoke end every session of that display at once** including a lapsed access token with an open refresh window (EL-8 pattern), and a lost key ring reports `needsReissue`, never a 500.
- [ ] **Unattended lifetime.** Given a display session, then the access token is 60 minutes and the refresh window runs until EndEx or revoke (not the participant day-end, EL-10), so a TV left on all day keeps working without a human.
- [ ] **No person, no double count (PRT-041).** Given a successful exchange, then the server emits `display_session_started` with actor `{ kind: 'display', displayId }`, **no** `actingHumanId`, no person-level field, and the display client emits no telemetry of its own; the event is labeled session-level in E10.
- [ ] **Credential never leaks.** Given the token, then it travels only in the POST body (never in an API URL or log), no response other than the staff `GET` returns it, and the entity and logs never print it.

## Out of Scope
What a display shows and the remote control (08), the SPA route and frame (18), per-display realtime groups (PP-4, parked), per-route allowlisting (a display reads what any participant of that exercise reads), email-delivery of display links.

## Technical Notes
Files: `Features/Portal/Display/Sessions/**`. Reuse `ISessionIssuer`, `SharedReadOnlyLoginService` shape, `SessionTokens`, Data Protection, `ExerciseLifecycleStates.IsParticipantSignInAllowed`, `ParticipantSessionRequests`. **Orchestrator seams:** the `display` session purpose and `TelemetryEnvelopeAuthority` actor kind (**platform prerequisite PP-1**, owned by `identity-auth-roles` + `telemetry`, applied by the orchestrator *before* this story's wave; this story specifies the observable behavior and tests, it does not edit `Features/Identity/**`), the PreAuthAllowlist entry and the pinned anonymous-route counts (EL-17), `AddPortal()/MapPortal()`. Security review required before merge.

## Dependencies
01, 02, F08, **PP-1** (display session purpose / actor kind). Can run with 03, 04, 06, 07.
