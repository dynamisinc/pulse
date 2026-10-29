# Story: Weather site home — conditions, forecast, alerts panel, zone selector

**Feature:** Weather source  ·  **Epic:** E6  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** WX-001, WX-003, WX-004, WX-011, COR-053  ·  **Design decisions:** D4-009, D4-010, D7-002  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 5  ·  **Effort:** L

## Context
The Weather Desk's front door: current conditions, the multi-day forecast, an active-alerts panel and the per-zone selector, in weather.gov anatomy. Reads the site endpoint (03) — on mock fixtures behind
the axios client until that route is live — and updates on foundation realtime events. This is a **read/consume** surface only: there is no participant weather composer (D4-011 #9).

## Acceptance Criteria
- [ ] **Anatomy.** Given the default zone, then the page shows (top to bottom on mobile; two columns >= 900 px) the active-alerts panel, current conditions (temperature, condition + icon, wind, humidity, "Observed {scenario time}"), and the forecast periods (label, hi/lo, condition icon + text, precip %, detail), with the forecast's "Issued {scenario time}" and a link to its permalink; condition is always icon **and** text.
- [ ] **Zone selector (WX-004).** Given multiple zones, then a zone selector (keyboard-operable select/listbox, deep-linkable as `/weather/zones/:zoneSlug`) switches conditions, forecast and the alert panel per zone; the selection persists for the session; one zone hides the selector; an unknown zone slug renders the participant-world not-found.
- [ ] **Alerts panel.** Given active/pending products for the zone, then each shows `SeverityChip`, the headline verbatim as a link to its permalink, effective/expires, and state; warnings sort before watches before advisories; zero active shows an explicit "No active alerts for {zone}" state (not an empty box); the same headline string as the alert bar and the post (D4-010).
- [ ] **Live and scenario-clocked.** Given `ContentPublished` / `ContentRevised` / `ContentRetracted` for the weather channel (`useChannelStream`) or a `ScenarioClockChanged`, then the view refetches/updates without losing the zone or scroll; product states tick over from `scenarioNow` (a watch expiring flips to EXPIRED); new alerts are announced once through `LiveRegionAnnouncer` (polite) and the alert bar keeps emergency announcements (WCAG live-region behaviour, no double announce).
- [ ] **Forecast evolution (WX-003).** Given a newer forecast replaces an earlier one, then the page shows the new one and an unobtrusive "Updated {scenario time}" line, with the earlier forecast reachable through its permalink — the model never hides that the outlook changed.
- [ ] **Scenario time, isolation (COR-053, XC-001/002).** All instants render via `ScenarioDateline`; data comes only through the host-resolved session; a disabled channel is unreachable; the page never shows draft/scheduled items.
- [ ] **Accessibility and look (NFR-001, #680).** WCAG 2.1 AA/508: landmarks, heading order, severity never color-only, visible focus, axe clean at 320 px and 1280 px; skin only, no COBRA, no default MUI look.
- [ ] **User guide.** Updates the participant-visible weather page in `docs/guide/` (and screenshot list) or states "no guide impact".

## Out of Scope
Interactive maps, radar loops as live data (imagery is on products only, 09), hourly graphs, location search, unit toggles, saved locations, notifications/subscriptions, kiosk mode.

## Technical Notes
Files: `src/frontend/src/features/weather/{pages/WeatherHomePage.tsx, components/site/**, hooks/useWeatherSite.ts*}`. React Query over `GET /api/weather/site` via the shared axios client; stream merge via `features/channels/data/useChannelStream`; telemetry for page view via F15 hooks (`article_view`, `payload.kind: forecast`).

## Dependencies
06 (mount), 07 (components), 03 (DTO types/fixtures; route may be mock), F15 (hooks, telemetry), F09 (stream). Can run with 09, 10, 11, 12, 13.
