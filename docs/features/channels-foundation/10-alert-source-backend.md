# Story: Alert source — raise, clear, history (backend)

**Feature:** Channels foundation  ·  **Epic:** E3 (with E6/E4/E7)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-010, PRT-011, PRT-012, WX-011, NWS-012 (flash), SOC-072 (pilot bridge), CTL-021 (raise path), XC-001, XC-004  ·  **Design decisions:** D4-010, D7-002  ·  **Issue:** #706
**Stack:** backend  ·  **World:** participant read / staff write  ·  **Wave:** 2  ·  **Effort:** M

## Context
The shell already renders the alert bar and a history page, but `GET /api/alerts` returns `[]`. This story makes it real: one **alert source** all channels raise into. A weather
warning, a controller flag (CTL-021) and a news flash are the same thing with different `sourceChannel`. The shell stays the container; this is the data.

## Acceptance Criteria
- [ ] **Active alerts.** Given active alerts, when a participant calls `GET /api/alerts`, then it returns `{ alerts: AlertDto[] }` for the resolved exercise: issued, not cleared, not expired against the exercise's scenario time, highest severity first then newest; an empty set returns `[]` (zero-height bar, D7).
- [ ] **History.** `GET /api/alerts/history` returns all alerts for the exercise (including cleared/expired) reverse-chron with a cursor, so a late joiner catches up (PRT-012).
- [ ] **Raise (`IAlertRaiser`).** Given `RaiseAsync({ severity, headline, href?, sourceChannel, sourceContentId?, expires? })`, then a `ChannelAlert` is stamped with server scenario time, `message` = the **headline verbatim** (D4-010: the same string appears on the bar, the post, the widget and the product page — no paraphrase), `href` must be host-relative or null (FC-9.3), and `AlertsChanged` is broadcast (story 09).
- [ ] **Clear and expiry.** Given `ClearAsync(id)` or an `expires` that passes (scenario time), then the alert drops from `GET /api/alerts` and `AlertsChanged` carries the new active set; a sweep service expires alerts across exercises with the scoped-background pattern.
- [ ] **Staff API.** `POST /api/alerts` and `POST /api/alerts/{id}/clear` are staff-only (controller role); a participant/anonymous caller gets 401/403; severity is one of `info|advisory|emergency`; headline is 1..200 chars, sanitized text (no HTML).
- [ ] **Real-world content never enters.** The raise path has no "real-world" flag: a real-world message is only the break-fiction overlay (SHELL-CONTRACT §2), so a test asserts the API offers no way to mark an alert out-of-fiction.
- [ ] **Pilot bridge (SOC-072, Q5).** Given the platform-alert notification path is enabled, when an alert is raised, then the same alert also produces the platform notification (one logical alert, two renderings); with the portal-era bar on, the alert bar is authoritative and no duplicate toast is shown for the same alert id.
- [ ] **Telemetry (XC-004).** Raise and clear emit `alert_issued` / `alert_cleared` (FC-6) in the same unit of work with the acting human; participants never see who raised it (XC-002).
- [ ] **Isolation.** Alerts are `IExerciseScoped`; another exercise's alert id is indistinguishable from unknown.

## Out of Scope
The alert bar UI and live wiring (11); the controller "flag as alert" control (world-steering CTL-021 calls `IAlertRaiser`); weather-severity mapping rules (E6 — D4-010 says every warning type forces `emergency` for now; E6 passes the severity); portal alert-history page styling (E3).

## Technical Notes
Files: `Features/Channels/Alerts/**` (`AlertService`, endpoints, expiry sweeper); `ParticipantShellConfigService.GetAlertsAsync` becomes a one-line delegate (see implementation.md seam note 2). Stable wire: `AlertDto` is a superset of the shell's `Alert` (`id, severity, message, scenarioTime`).

## Dependencies
01, 02. 09 for the real push (a no-op default until it lands). Blocks 11.
