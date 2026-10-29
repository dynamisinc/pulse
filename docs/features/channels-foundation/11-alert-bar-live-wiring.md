# Story: Alert bar live wiring (frontend)

**Feature:** Channels foundation  ·  **Epic:** E3 (shell: E1)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-010, PRT-011, PRT-012, WX-011 (headline verbatim), NFR-001  ·  **Design decisions:** D4-010, D7-002  ·  **Issue:** #707
**Stack:** frontend  ·  **World:** participant (shell)  ·  **Wave:** 3  ·  **Effort:** S

## Context
The alert bar host, severity chip, ticker, multi-alert stack and history page are built (participant-shell/02). `useAlerts()` still reads a canned seam. This story points it at the
live source and the push, so the bar persists across **every** enabled channel with real data. The shell remains the container; channels never render their own bar.

## Acceptance Criteria
- [ ] **Live read.** Given the real `GET /api/alerts`, when the shell mounts, then `useAlerts()` returns the active alerts with the same signature as today; an out-of-shape response fails closed (existing `isAlert` guard) and the bar stays hidden.
- [ ] **Live push.** Given `AlertsChanged`, when it arrives, then the active set is replaced (not merged) so a reconnecting client converges; an emergency alert appears in the full band immediately and never collapses (SHELL-CONTRACT §2).
- [ ] **Details link-through.** Given an alert with `href`, when "Details →" is activated, then the participant goes to `/alerts` with the alert focused **or** straight to `href` per the existing `AlertDetailsLink` rule; `href` is host-relative; an alert with no `href` goes to history.
- [ ] **History.** `AlertsHistory` reads `GET /api/alerts/history` and lists reverse-chron with severity icon + text label + scenario-time stamp (never color-only, NFR-001).
- [ ] **Multiple active alerts (D4-010 #7, weather FU-5).** Given two or more active alerts (e.g. a warning at `emergency` and a watch at `advisory`), then they stack/rotate in the **one** bar in severity-then-recency order, a warning forces the emergency band while a watch is still listed, an emergency never collapses, rotation pauses on focus/hover and respects reduced motion, and each alert's severity is icon + text + color; a test over the real hook covers two and five alerts.
- [ ] **Persists across channels.** Given news, press, weather and social mounted in turn, then the same bar instance is visible above each (mounted once in the shell; verified by an integration test over two channels).
- [ ] **Announcements.** A newly arrived alert is announced once via the bar's `role="status"` live region (emergency assertive, others polite); a push that changes nothing announces nothing; paused/EndEx overlays keep the existing inert-bar behaviour.
- [ ] **Mock path preserved.** With the mock flag on, the canned alerts still work so the shell's existing tests do not need a backend.

## Out of Scope
Raising alerts (10, controller console); alert styling changes (design is final: ticker default, D7-002); a participant "dismiss" (alerts are never dismissable); portal-era alert hero treatment (E3 reads the same hook).

## Technical Notes
Files: `features/participant-shell/components/AlertBar/useAlerts*.ts*`, `alertTypes.ts` (additive optional `href`, `sourceChannel`, `contentId`). Reuse `useChannelStream`'s connection subscription pattern from story 09 via the shared `realtimeConnection`. Scenario time through `formatScenarioTime`.

## Dependencies
09 (stream), 10 (live source). Can run with 05, 06, 07, 12.
