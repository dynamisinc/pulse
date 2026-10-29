# Story: Alerts entry and RIP Alerts absorption

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-012, PRT-010, PRT-011, SOC-072 (consumer), NFR-001  ·  **Design decisions:** D2-005 (right-aligned Alerts link), D7-002  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 3  ·  **Effort:** S

## Context
Master §2 absorbs the Looking Glass **RIP Alerts** role into the Portal and Social notifications: an alert is a capability, not a channel. The capability is delivered by pieces that already exist or are foundation stories: the alert source (F10), the live bar (F11), the history page `/alerts` (F11) and the SOC-072 platform notification (F10 bridge, notifications/03). E3's contribution is (a) the portal **entry point** to catch up (PRT-012 "bell icon / alerts page") and (b) the acceptance that the *whole* absorption holds from the participant's side. It builds no alert UI beyond the entry.

## Acceptance Criteria
- [ ] **Entry.** Given the masthead `alertsEntry` slot (06), then `AlertsEntry` renders a bell icon, the visible text "Alerts" and the count of active alerts as **text** (e.g. "Alerts (2)"), right-aligned, linking to the shell's `/alerts` history; it is a real link, keyboard-operable, ≥ 44 px on coarse pointers, and the count is never conveyed by color or the icon alone.
- [ ] **Late joiner.** Given a participant who logs in after an alert was raised, when they open the portal, then the bar shows the active alerts (F11) and the entry shows the right count, and `/alerts` lists history reverse-chron with severity icon + text + scenario time (the page is F11's; this story verifies the path from the portal).
- [ ] **Count follows push.** Given `AlertsChanged`, then the count updates within one render and is announced only by the shell's live region (the entry has no live region of its own, to avoid double announcement).
- [ ] **One alert, two renderings (SOC-072).** Given an alert raised through `IAlertRaiser`, then the participant sees the bar on the portal **and** the platform notification in the Social notifications list with the **same headline string**, and the entry's count matches the bar; a Playwright path in 23 proves it across portal, news and social.
- [ ] **Link-through.** Given an alert with `href`, when "Details →" on the bar is activated, then the participant reaches that host-relative content or the history entry (F11 rule); the portal entry itself always goes to history.
- [ ] **Hidden when moot.** Given zero active alerts, then the entry still renders (history stays reachable) with no count, never an empty badge.

## Out of Scope
Raising or clearing alerts (E7), the bar's styling, the history page, notification rendering, a standalone alerts product (decided: not a channel).

## Technical Notes
Files: `features/portal/alerts/AlertsEntry*`. Reuse the shell's `useAlerts`, `alertsRoute` helpers. FontAwesome bell. No telemetry of its own beyond `portal_module_click` through 17's masthead wiring.

## Dependencies
02, F10, F11. Can run with 08-13, 15, 16.
